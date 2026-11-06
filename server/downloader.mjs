import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export const exists = async (file) => !!(await stat(file).catch(() => null));
export async function atomicJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + '.tmp', JSON.stringify(value));
  await rename(file + '.tmp', file);
}
export async function readJSON(file, fallback = null) {
  return JSON.parse(await readFile(file, 'utf8').catch(() => JSON.stringify(fallback)));
}

/** Resume only bytes from the same source and representation; never publish a partial file. */
export async function download({
  urls,
  target,
  previous = {},
  validate = async () => {},
  expectedHash,
  maxBytes = 64 * 1024 * 1024,
  progress = () => {},
  fetcher = fetch,
  attempts = 3,
  timeout = 45000,
}) {
  await mkdir(path.dirname(target), { recursive: true });
  const partial = target + '.part',
    sidecar = partial + '.json';
  const failures = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const statuses = [];
    for (const url of urls) {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(new Error('下载超时')), timeout);
      let invalidContent = false;
      try {
        let resume = await readJSON(sidecar).catch(() => null);
        let offset =
          resume?.url === url && resume.validator
            ? (await stat(partial).catch(() => null))?.size || 0
            : 0;
        const headers = { 'User-Agent': 'YGO-Dragon/0.1', 'Accept-Encoding': 'identity' };
        if (offset) {
          headers.Range = `bytes=${offset}-`;
          headers['If-Range'] = resume.validator;
        } else if (previous.url === url && (await exists(target))) {
          if (previous.etag) headers['If-None-Match'] = previous.etag;
          else if (previous.modified) headers['If-Modified-Since'] = previous.modified;
        }
        const response = await fetcher(url, { headers, signal: controller.signal });
        statuses.push(response.status);
        if (response.status === 304 && (await exists(target))) {
          await response.body?.cancel();
          return { ...previous, unchanged: true, checked: Date.now() };
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        let rangeTotal = 0;
        if (response.status === 206) {
          const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
          if (
            !offset ||
            !match ||
            Number(match[1]) !== offset ||
            Number(match[2]) + 1 !== Number(match[3])
          ) {
            await response.body?.cancel();
            invalidContent = true;
            throw new Error('断点范围不一致');
          }
          rangeTotal = Number(match[3]);
        } else offset = 0; // Server ignored Range or representation changed: truncate and restart.
        const total = rangeTotal || Number(response.headers.get('content-length') || 0) + offset;
        if (total > maxBytes) {
          await response.body?.cancel();
          invalidContent = true;
          throw new Error('文件超过大小上限');
        }
        const etag = response.headers.get('etag'),
          modified = response.headers.get('last-modified');
        const validator = etag && !etag.startsWith('W/') ? etag : modified;
        if (offset && validator && validator !== resume.validator) {
          await response.body?.cancel();
          invalidContent = true;
          throw new Error('断点对应的文件版本已改变');
        }
        await atomicJSON(sidecar, { url, validator });
        const output = await open(partial, offset ? 'a' : 'w');
        let received = offset;
        try {
          if (!response.body) throw new Error('空响应');
          for await (const chunk of response.body) {
            received += chunk.length;
            if (received > maxBytes) {
              invalidContent = true;
              controller.abort();
              throw new Error('文件超过大小上限');
            }
            await output.write(chunk);
            progress({ received, total, url });
          }
          await output.sync();
        } finally {
          await output.close();
        }
        if (total && received !== total) throw new Error('下载字节数不匹配');
        invalidContent = true;
        await validate(partial);
        const hash = await sha256(partial);
        if (expectedHash && hash !== expectedHash) throw new Error('SHA-256 校验失败');
        const unchanged = previous.hash === hash && (await exists(target));
        if (unchanged) await rm(partial, { force: true });
        else await rename(partial, target);
        await rm(sidecar, { force: true });
        return { url, etag, modified, hash, size: received, checked: Date.now(), unchanged };
      } catch (error) {
        failures.push({ url, reason: error.message });
        if (invalidContent) {
          await rm(partial, { force: true });
          await rm(sidecar, { force: true });
        }
      } finally {
        clearTimeout(timer);
      }
    }
    // A mixture of 404 and network/5xx is a failure, never a cached "missing" result.
    if (statuses.length === urls.length && statuses.every((status) => status === 404)) {
      throw Object.assign(new Error('所有来源均返回 404'), { missing: true, failures });
    }
    if (attempt + 1 < attempts) await delay(Math.min(4000, 400 * 2 ** attempt));
  }
  throw Object.assign(
    new Error(failures.map((x) => `${new URL(x.url).host}: ${x.reason}`).join('；')),
    { failures },
  );
}
