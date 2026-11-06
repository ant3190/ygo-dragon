import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { atomicJSON, download, exists, readJSON } from './downloader.mjs';

export function validateDatabase(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
      throw new Error('SQLite 完整性校验失败');
    if (Number(db.prepare('SELECT count(*) AS n FROM datas JOIN texts USING(id)').get().n) < 1000)
      throw new Error('卡库内容不完整');
    db.prepare(
      'SELECT id, type, atk, def, level, race, attribute, setcode FROM datas LIMIT 1',
    ).get();
    db.prepare('SELECT id, name, desc, str1 FROM texts LIMIT 1').get();
  } finally {
    db.close();
  }
}
export async function validateImage(file) {
  const image = sharp(file, { failOn: 'error', limitInputPixels: 20000000 });
  const meta = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format) || meta.width < 80 || meta.height < 100)
    throw new Error('卡图格式或尺寸无效');
  await image.raw().toBuffer(); // Decode the whole image, so a valid header cannot hide a truncated payload.
}
const validateText = async (file) => {
  const text = await readFile(file, 'utf8');
  if (text.length < 100 || /<html/i.test(text)) throw new Error('配置文件内容无效');
};

export class Resources extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.data = config.data;
    this.records = {};
    this.scripts = null;
    this.running = null;
    this.images = new Map();
    this.queue = [];
    this.active = 0;
    this.status = {
      phase: 'idle',
      ready: false,
      cards: 0,
      images: 0,
      done: 0,
      total: 0,
      errors: [],
      updated: null,
      current: '',
      downloadedBytes: 0,
    };
    this.bulkRunning = false;
  }
  async init() {
    await mkdir(this.data, { recursive: true });
    await mkdir(path.join(this.data, 'images'), { recursive: true });
    this.meta = new DatabaseSync(path.join(this.data, 'resources.sqlite'));
    this.meta.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS files (key TEXT PRIMARY KEY, record TEXT NOT NULL)',
    );
    this.records = Object.fromEntries(
      this.meta
        .prepare('SELECT key, record FROM files')
        .all()
        .map((r) => [r.key, JSON.parse(r.record)]),
    );
    this.scripts = await readJSON(path.join(this.data, 'scripts-current.json'));
    this.status.images = (await readdir(path.join(this.data, 'images'))).filter((f) =>
      /^\d+\.jpg$/.test(f),
    ).length;
    this.refreshReady();
    return this;
  }
  record(key, value) {
    this.records[key] = value;
    this.meta.prepare('INSERT OR REPLACE INTO files VALUES (?,?)').run(key, JSON.stringify(value));
  }
  publish() {
    this.emit('status', {
      ...this.status,
      errors: this.status.errors.slice(-30),
      queued: this.queue.length,
      active: this.active,
    });
  }
  refreshReady() {
    try {
      const db = new DatabaseSync(path.join(this.data, 'cards.cdb'), { readOnly: true });
      this.status.cards = Number(db.prepare('SELECT count(*) AS n FROM texts').get().n);
      db.close();
      this.status.ready =
        !!this.scripts?.path &&
        ['constant.lua', 'utility.lua'].every((file) =>
          existsSync(path.join(this.scripts.path, file)),
        );
    } catch {
      this.status.ready = false;
    }
    this.publish();
  }
  get snapshot() {
    return {
      database: path.join(this.data, 'cards.cdb'),
      scripts: this.scripts?.path,
      version: this.scripts?.sha,
    };
  }
  async sync(force = false, manual = false) {
    if (this.running) return this.running;
    this.running = this.performSync(force, manual).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async performSync(force, manual) {
    Object.assign(this.status, {
      phase: 'checking',
      errors: [],
      done: 0,
      total: 4,
      downloadedBytes: 0,
    });
    this.publish();
    const tasks = [
      ['cards.cdb', this.config.database, validateDatabase],
      ['strings.conf', this.config.strings, validateText],
      ['lflist.conf', this.config.banlist, validateText],
    ];
    for (const [key, urls, validate] of tasks) {
      this.status.current = key;
      this.publish();
      const old = this.records[key] || {};
      try {
        if (
          force ||
          manual ||
          !old.checked ||
          Date.now() - old.checked > this.config.interval ||
          !(await exists(path.join(this.data, key)))
        ) {
          if (force && (await exists(path.join(this.data, key)))) {
            try {
              await validate(path.join(this.data, key));
            } catch {
              old.etag = null;
              old.modified = null;
              old.hash = null;
            }
          }
          const result = await download({
            urls,
            target: path.join(this.data, key),
            previous: old,
            validate,
            progress: (p) => {
              this.status.phase = 'downloading';
              this.status.current = key;
              this.status.received = p.received;
              this.status.fileTotal = p.total;
              this.publish();
            },
          });
          this.record(key, result);
          if (!result.unchanged) {
            this.status.downloadedBytes += result.size;
            if (key === 'cards.cdb') this.emit('database');
          }
        }
      } catch (e) {
        this.status.errors.push({ file: key, reason: e.message });
      }
      this.status.done++;
      this.refreshReady();
    }
    this.status.current = '规则脚本';
    this.publish();
    try {
      await this.syncScripts(force, manual);
    } catch (e) {
      this.status.errors.push({ file: 'CardScripts', reason: e.message });
    }
    this.status.done++;
    this.status.updated = Date.now();
    this.status.phase = this.status.errors.length ? 'partial' : 'ready';
    this.status.current = '';
    this.refreshReady();
    return this.status;
  }
  async syncScripts(force, manual) {
    const valid = (directory) =>
      !!directory &&
      ['utility.lua', 'constant.lua'].every((name) => existsSync(path.join(directory, name)));
    if (
      !force &&
      !manual &&
      this.scripts?.checked &&
      Date.now() - this.scripts.checked < this.config.interval &&
      valid(this.scripts.path)
    )
      return;
    const response = await fetch(this.config.scriptsRef, {
      headers: {
        'User-Agent': 'YGO-Dragon',
        ...(!force && valid(this.scripts?.path) && this.scripts?.etag
          ? { 'If-None-Match': this.scripts.etag }
          : {}),
      },
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === 304 && valid(this.scripts?.path)) {
      this.scripts.checked = Date.now();
      await atomicJSON(path.join(this.data, 'scripts-current.json'), this.scripts);
      return;
    }
    if (!response.ok) throw new Error(`GitHub 脚本版本检查 HTTP ${response.status}`);
    const { sha } = await response.json();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('脚本版本无效');
    // Manual repair installs a fresh generation; never delete scripts a live duel may still read.
    const destination = path.join(this.data, 'scripts', force ? `${sha}-${Date.now()}` : sha);
    if (!valid(destination)) {
      const target = path.join(this.data, 'work', `scripts-${sha}.zip`);
      await download({
        urls: this.config.scriptsArchives
          ? this.config.scriptsArchives.map((url) => url.replaceAll('{sha}', sha))
          : [this.config.scriptsArchive(sha)],
        target,
        maxBytes: 100 * 1024 * 1024,
        validate: (file) => {
          const zip = new AdmZip(file);
          if (!zip.getEntries().some((e) => e.entryName.endsWith('/utility.lua')))
            throw new Error('脚本包缺少 utility.lua');
        },
        progress: (p) => {
          this.status.phase = 'downloading';
          this.status.received = p.received;
          this.status.fileTotal = p.total;
          this.publish();
        },
      });
      const staging = destination + '.staging';
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      const zip = new AdmZip(target);
      let total = 0;
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName.split('/').slice(1).join('/');
        if (!name || name.includes('..') || path.isAbsolute(name))
          throw new Error('脚本包路径无效');
        if (!name.endsWith('.lua') && name !== 'COPYING') continue;
        total += entry.header.size;
        if (total > 300 * 1024 * 1024) throw new Error('脚本包解压大小超限');
        const file = path.join(staging, name);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, entry.getData());
      }
      for (const file of ['constant.lua', 'utility.lua'])
        if (!(await exists(path.join(staging, file)))) throw new Error(`缺少 ${file}`);
      await mkdir(path.dirname(destination), { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
      await rm(target, { force: true });
    }
    this.scripts = {
      sha,
      path: destination,
      checked: Date.now(),
      etag: response.headers.get('etag'),
    };
    await atomicJSON(path.join(this.data, 'scripts-current.json'), this.scripts);
  }
  image(code, force = false) {
    code = Number(code);
    if (!Number.isSafeInteger(code) || code < 1 || code > 0xffffffff)
      return Promise.reject(new Error('卡号无效'));
    if (this.images.has(code)) return this.images.get(code);
    const promise = new Promise((resolve, reject) => {
      this.queue.push({ code, force, resolve, reject });
      this.pump();
    });
    this.images.set(code, promise);
    promise.finally(() => this.images.delete(code)).catch(() => {});
    return promise;
  }
  pump() {
    while (this.active < this.config.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      this.fetchImage(job.code, job.force)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--;
          this.publish();
          this.pump();
        });
    }
  }
  async fetchImage(code, force) {
    const target = path.join(this.data, 'images', `${code}.jpg`),
      key = `image:${code}`;
    if ((await exists(target)) && !force) return target;
    const old = this.records[key] || {};
    if (old.retryAfter > Date.now() && !force)
      throw Object.assign(new Error(old.reason || '等待重试'), { missing: old.missing });
    if (this.config.legacy && !force) {
      const source = path.join(
        this.config.legacy,
        'files',
        'images',
        'ygopro-images-zh-CN',
        `${code}.jpg`,
      );
      if (await exists(source)) {
        try {
          await validateImage(source);
          await copyFile(source, target);
          this.status.images++;
          return target;
        } catch {
          /* A corrupt legacy file falls back to remote sources. */
        }
      }
    }
    try {
      const had = await exists(target);
      if (force && had) {
        try {
          await validateImage(target);
        } catch {
          old.etag = null;
          old.modified = null;
          old.hash = null;
        }
      }
      const result = await download({
        urls: this.config.images.map((base) => `${base.replace(/\/$/, '')}/${code}.jpg`),
        target,
        previous: old,
        validate: validateImage,
        maxBytes: 6 * 1024 * 1024,
        attempts: 2,
        timeout: 20000,
      });
      this.record(key, result);
      if (!had) this.status.images++;
      return target;
    } catch (e) {
      this.record(key, {
        ...old,
        missing: !!e.missing,
        reason: e.message,
        retryAfter: Date.now() + (e.missing ? 3600000 : 60000),
      });
      if (await exists(target)) return target;
      throw e;
    }
  }
  async prefetch(codes, force = false) {
    if (this.bulkRunning) throw new Error('已有卡图任务正在进行');
    this.bulkRunning = true;
    this.status.bulk = { total: codes.length, done: 0, failed: 0, errors: [] };
    this.publish();
    const workers = Array.from({ length: this.config.concurrency }, async () => {
      while (codes.length) {
        const code = codes.shift();
        try {
          await this.image(code, force);
        } catch (e) {
          this.status.bulk.failed++;
          if (this.status.bulk.errors.length < 100)
            this.status.bulk.errors.push({ code, reason: e.message });
        }
        this.status.bulk.done++;
        this.publish();
      }
    });
    try {
      await Promise.all(workers);
    } finally {
      this.bulkRunning = false;
      this.publish();
    }
  }
}
