import { useEffect, useState } from 'react';
import {
  Check,
  Database,
  Download,
  Folder,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { api, post } from '../lib';
import type { Deck, ResourceStatus, Settings } from '../types';

export function SettingsPage({
  settings,
  onChange,
  resources,
  decks,
  notify,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  resources: ResourceStatus;
  decks: Deck[];
  notify: (t: string) => void;
}) {
  const [detail, setDetail] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });
  useEffect(() => {
    void api('/resources/status')
      .then(setDetail)
      .catch((e) => notify(e.message));
  }, []);
  const task = async (path: string, data: unknown, text: string) => {
    setBusy(true);
    try {
      await post(path, data);
      notify(text);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const syncing = ['checking', 'downloading'].includes(resources.phase),
    bulk = resources.bulk;
  const codes = [...new Set(decks.flatMap((d) => [...d.main, ...d.extra, ...d.side]))];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            偏好设置<span className="title-dot">.</span>
          </h1>
          <p>让界面和操作，贴合你的习惯。</p>
        </div>
      </div>
      <div className="settings-layout">
        <div className="settings-main">
          <section className="settings-section">
            <div className="section-heading">
              <h2>个人与外观</h2>
            </div>
            <div className="setting-row">
              <div>
                <b>决斗者名称</b>
                <p>在联机房间中显示。</p>
              </div>
              <label>
                <span className="visually-hidden">决斗者名称</span>
                <input
                  maxLength={20}
                  value={settings.name}
                  onChange={(e) => update('name', e.target.value)}
                />
              </label>
            </div>
            <div className="setting-row">
              <div>
                <b>强调色</b>
                <p>深色基底保持一致，只调整重点操作。</p>
              </div>
              <div className="accent-options" role="group" aria-label="强调色">
                {[
                  ['jade', '青绿'],
                  ['blue', '冰蓝'],
                  ['amber', '暖金'],
                ].map(([color, label]) => (
                  <button
                    key={color}
                    className={`accent-swatch ${color}`}
                    aria-label={label}
                    aria-pressed={settings.accent === color}
                    onClick={() => update('accent', color as Settings['accent'])}
                  >
                    {settings.accent === color && <Check size={17} />}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <div>
                <b>动态效果</b>
                <p>影响界面过渡和对战反馈。</p>
              </div>
              <label>
                <span className="visually-hidden">动态效果</span>
                <select
                  value={settings.motion}
                  onChange={(e) => update('motion', e.target.value as Settings['motion'])}
                >
                  <option value="normal">标准</option>
                  <option value="quick">快速</option>
                  <option value="none">减少动态效果</option>
                </select>
              </label>
            </div>
          </section>
          <section className="settings-section">
            <div className="section-heading">
              <h2>对战操作</h2>
            </div>
            <div className="setting-row">
              <div>
                <b>结束回合前确认</b>
                <p>避免误触阶段按钮。</p>
              </div>
              <button
                role="switch"
                aria-checked={settings.confirmEnd}
                aria-label="结束回合前确认"
                className={`switch ${settings.confirmEnd ? 'on' : ''}`}
                onClick={() => update('confirmEnd', !settings.confirmEnd)}
              >
                <span />
              </button>
            </div>
            <div className="setting-row">
              <div>
                <b>连锁询问</b>
                <p>可在对战中随时切换。强制发动的效果始终询问。</p>
              </div>
              <label>
                <span className="visually-hidden">连锁询问</span>
                <select
                  value={settings.chain}
                  onChange={(e) => update('chain', e.target.value as Settings['chain'])}
                >
                  <option value="auto">自动</option>
                  <option value="all">全部询问</option>
                  <option value="off">跳过可选连锁</option>
                </select>
              </label>
            </div>
          </section>
          <section className="settings-section">
            <div className="section-heading">
              <h2>本地卡库与资源</h2>
              <span className={`badge ${resources.ready ? 'success' : ''}`}>
                {resources.ready ? (
                  <ShieldCheck size={13} />
                ) : (
                  <LoaderCircle className="spin" size={13} />
                )}
                {resources.ready ? '可以开始决斗' : '正在准备'}
              </span>
            </div>
            <div className="resource-summary">
              <div>
                <span>卡片信息</span>
                <strong>{resources.cards.toLocaleString()}</strong>
              </div>
              <div>
                <span>已保存卡图</span>
                <strong>{resources.images.toLocaleString()}</strong>
              </div>
              <div>
                <span>更新状态</span>
                <strong className="resource-phase">
                  {syncing
                    ? '同步中'
                    : resources.errors.length
                      ? '部分完成'
                      : resources.ready
                        ? '已就绪'
                        : '等待资源'}
                </strong>
              </div>
            </div>
            {syncing && (
              <div className="resource-progress">
                <div>
                  <span>{resources.current || '检查资源'}</span>
                  <span>
                    {resources.done} / {resources.total}
                  </span>
                </div>
                <progress
                  max={resources.fileTotal || resources.total || 4}
                  value={resources.fileTotal ? resources.received || 0 : resources.done}
                />
              </div>
            )}
            <div className="button-group resource-buttons">
              <button
                className="button secondary"
                disabled={busy || syncing}
                onClick={() => void task('/resources/sync', {}, '已开始检查更新')}
              >
                <RefreshCw size={16} className={syncing ? 'spin' : ''} />
                检查更新
              </button>
              <button
                className="text-button"
                disabled={busy || syncing}
                onClick={() =>
                  void task('/resources/sync', { verify: true }, '已开始检查资源完整性并重新验证')
                }
              >
                <ShieldCheck size={16} />
                校验与重试
              </button>
            </div>
            <p className="small muted">
              自动检查间隔为 {Math.round((detail?.interval || 21600000) / 3600000)}{' '}
              小时。相同版本复用本地记录；更新失败时保留可用文件。
            </p>
            <div className="image-download">
              <div className="section-heading">
                <h3>卡图管理</h3>
                <span className="small muted">本地保存 · 按需读取</span>
              </div>
              <p className="muted">
                使用时自动下载并保存卡图，也可以提前下载出战卡组，或在后台补全全部卡图。
              </p>
              <div className="button-group">
                <button
                  className="button secondary"
                  disabled={busy || !resources.ready || (!!bulk && bulk.done < bulk.total)}
                  onClick={() => void task('/resources/images', { codes }, '已开始准备卡组卡图')}
                >
                  <Download size={16} />
                  下载卡组卡图
                </button>
                <button
                  className="button secondary"
                  disabled={busy || !resources.ready || (!!bulk && bulk.done < bulk.total)}
                  onClick={() =>
                    void task(
                      '/resources/images',
                      { all: true },
                      '后台卡图补全已启动，可继续使用其他功能',
                    )
                  }
                >
                  后台补全全部
                </button>
              </div>
              {bulk && (
                <div className="resource-progress">
                  <div>
                    <span>
                      {bulk.done < bulk.total ? '后台下载中' : '任务完成'} · {bulk.done} /{' '}
                      {bulk.total}
                    </span>
                    <span>{bulk.failed ? `${bulk.failed} 张暂未成功` : '正常'}</span>
                  </div>
                  <progress value={bulk.done} max={bulk.total} />
                  {bulk.failed > 0 && bulk.done === bulk.total && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void task(
                          '/resources/images',
                          { codes: bulk.errors.map((e) => e.code), retry: true },
                          '已重新尝试失败的卡图',
                        )
                      }
                    >
                      <RefreshCw size={14} />
                      重试失败项目
                    </button>
                  )}
                </div>
              )}
            </div>
            {resources.errors.length > 0 && (
              <div className="resource-errors" role="status">
                <h3>以下资源需要重试</h3>
                {resources.errors.map((error, i) => (
                  <p key={i}>
                    <b>{error.file}</b>
                    <span>{error.reason}</span>
                  </p>
                ))}
              </div>
            )}
            {detail?.dataDir && (
              <div className="resource-location">
                <Folder size={16} />
                <div>
                  <span>本地资源目录</span>
                  <code>{detail.dataDir}</code>
                </div>
              </div>
            )}
          </section>
        </div>
        <aside className="settings-aside">
          <Database size={25} strokeWidth={1.3} />
          <h3>你的卡库，就在本地。</h3>
          <p>卡库、规则脚本和卡图独立于程序保存，升级项目不会要求重新下载。</p>
          <div className="aside-rule" />
          <ShieldCheck size={22} strokeWidth={1.3} />
          <h3>完成校验，才替换文件。</h3>
          <p>支持断点恢复与备用来源。失败后可重试；暂未提供的卡图会显示卡名占位。</p>
          <a
            href="https://github.com/ant3190/ygo-dragon"
            target="_blank"
            rel="noreferrer"
            className="text-button"
          >
            项目源码
          </a>
        </aside>
      </div>
    </>
  );
}
