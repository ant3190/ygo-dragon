import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  Info,
  Layers3,
  LoaderCircle,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  api,
  cacheCards,
  cachedCard,
  downloadFile,
  post,
  sectionLabel,
  useCard,
  useDebounce,
  ydk,
} from '../lib';
import { CardDetail, CardImage, DeckTile, EmptyState, Modal } from '../components';
import type { Card, Deck, Section } from '../types';

export function Decks({
  decks,
  refresh,
  notify,
  ready,
}: {
  decks: Deck[];
  refresh: () => Promise<void>;
  notify: (text: string) => void;
  ready: boolean;
}) {
  const [draft, setDraft] = useState<Deck | null>(null),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [query, setQuery] = useState(''),
    [type, setType] = useState('all'),
    [results, setResults] = useState<Card[]>([]),
    [total, setTotal] = useState(0),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState(''),
    [inspected, setInspected] = useState(89631139),
    [section, setSection] = useState<Section>('main'),
    [remove, setRemove] = useState<Deck | null>(null),
    [closing, setClosing] = useState(false),
    [errors, setErrors] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null),
    debounced = useDebounce(query),
    card = useCard(inspected);
  const [showDetail, setShowDetail] = useState(false);
  useEffect(() => {
    if (!draft) return;
    const controller = new AbortController();
    setSearching(true);
    setSearchError('');
    void api(`/cards?q=${encodeURIComponent(debounced)}&type=${type}&limit=60`, {
      signal: controller.signal,
    })
      .then((data) => {
        cacheCards(data.cards);
        setResults(data.cards);
        setTotal(data.total);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setSearchError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [debounced, type, !!draft, ready]);
  const edit = (deck: Deck) => {
    setDraft(structuredClone(deck));
    setDirty(false);
    setErrors([]);
    setInspected(deck.cover || deck.main[0] || 89631139);
  };
  const update = (next: Deck) => {
    setDraft(next);
    setDirty(true);
    setErrors([]);
  };
  function add(id: number, forcedSection?: Section) {
    if (!draft) return;
    const known =
      cachedCard(id) || results.find((c) => c.id === id) || (card?.id === id ? card : undefined);
    const target =
      forcedSection ||
      (section === 'side' ? 'side' : known && known.type & 0x4802040 ? 'extra' : 'main');
    if (known?.type && known.type & 0x4000) {
      notify('衍生物不能加入卡组');
      return;
    }
    if (
      known &&
      ((target === 'extra' && !(known.type & 0x4802040)) ||
        (target === 'main' && known.type & 0x4802040))
    ) {
      notify('请将卡片放入正确的主卡组或额外卡组');
      return;
    }
    if (draft[target].length >= (target === 'main' ? 60 : 15)) {
      notify(`${sectionLabel[target]}已满`);
      return;
    }
    if (
      ['main', 'extra', 'side'].flatMap((k) => draft[k as Section]).filter((code) => code === id)
        .length >= 3
    ) {
      notify('同一卡片最多加入 3 张');
      return;
    }
    update({ ...draft, [target]: [...draft[target], id] });
  }
  const take = (target: Section, index: number) => {
    if (draft) update({ ...draft, [target]: draft[target].filter((_, i) => i !== index) });
  };
  function drop(event: React.DragEvent, target: Section) {
    event.preventDefault();
    if (!draft) return;
    const id = Number(event.dataTransfer.getData('text/card'));
    if (!id) return;
    const raw = event.dataTransfer.getData('application/x-dragon-source');
    if (!raw) {
      add(id, target);
      return;
    }
    try {
      const source = JSON.parse(raw) as { section: Section; index: number };
      if (
        !['main', 'extra', 'side'].includes(source.section) ||
        draft[source.section][source.index] !== id
      )
        return;
      const info = cachedCard(id);
      if (!info) {
        notify('卡片信息正在读取，请稍后重试');
        return;
      }
      if (
        (target === 'main' && info.type & 0x4802040) ||
        (target === 'extra' && !(info.type & 0x4802040))
      ) {
        notify('请将卡片放入正确的主卡组或额外卡组');
        return;
      }
      const next = structuredClone(draft);
      next[source.section].splice(source.index, 1);
      if (next[target].length >= (target === 'main' ? 60 : 15)) {
        notify(`${sectionLabel[target]}已满`);
        return;
      }
      next[target].push(id);
      update(next);
    } catch {
      notify('无法识别拖放的卡片');
    }
  }
  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const data = await post('/decks', draft);
      setDraft(data.deck);
      setErrors(data.errors);
      setDirty(false);
      await refresh();
      notify(data.errors.length ? '卡组已保存为草稿，使用前请修正提示' : '卡组已保存');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function importDeck(selected?: File) {
    if (!selected) return;
    if (selected.size > 256 * 1024) {
      notify('YDK 文件过大');
      return;
    }
    try {
      const data = await post('/decks', {
        name: selected.name.replace(/\.ydk$/i, ''),
        ydk: await selected.text(),
      });
      await refresh();
      edit(data.deck);
      setErrors(data.errors);
      notify('卡组已导入');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const hiddenFile = (
    <input
      ref={file}
      type="file"
      accept=".ydk,.txt"
      className="visually-hidden"
      onChange={(e) => {
        void importDeck(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );
  if (!draft)
    return (
      <>
        {hiddenFile}
        <div className="page-heading">
          <div>
            <h1>
              卡组编辑<span className="title-dot">.</span>
            </h1>
            <p>编辑卡组，或导入已有的 YDK 文件。</p>
          </div>
          <div className="button-group">
            <button className="button secondary" onClick={() => file.current?.click()}>
              <Upload size={17} />
              导入 YDK
            </button>
            <button
              className="button primary"
              onClick={() => {
                edit({ id: '', name: '未命名卡组', main: [], extra: [], side: [] });
              }}
            >
              <Plus size={18} />
              新建卡组
            </button>
          </div>
        </div>
        {!ready && (
          <div className="notice">
            <LoaderCircle className="spin" size={16} />
            首次卡库下载完成后，可搜索全部卡片。现在可以先导入 YDK。
          </div>
        )}
        <div className="section-heading">
          <h2>
            全部卡组 <span>{decks.length}</span>
          </h2>
          <span className="muted small">保存在当前决斗档案中</span>
        </div>
        <div className="deck-library">
          {decks.map((deck) => (
            <div key={deck.id} className="library-item">
              <DeckTile deck={deck} onClick={() => edit(deck)} />
              <div className="library-actions">
                <button className="text-button" onClick={() => edit(deck)}>
                  编辑卡组
                  <ArrowLeft size={14} className="rotate-arrow" />
                </button>
                <button
                  className="icon-button"
                  onClick={() => downloadFile(`${deck.name}.ydk`, ydk(deck))}
                  aria-label={`导出${deck.name}`}
                >
                  <Download size={16} />
                </button>
                {!deck.id.startsWith('starter-') && (
                  <button
                    className="icon-button danger-text"
                    aria-label={`删除${deck.name}`}
                    onClick={() => setRemove(deck)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            className="new-deck-tile"
            onClick={() => edit({ id: '', name: '未命名卡组', main: [], extra: [], side: [] })}
          >
            <span>
              <Plus size={25} />
            </span>
            <b>新建卡组</b>
            <small>创建空白卡组</small>
          </button>
        </div>
        {remove && (
          <Modal title="删除卡组" onClose={() => setRemove(null)}>
            <p>删除「{remove.name}」？你可以先导出 YDK 备份。</p>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setRemove(null)}>
                保留卡组
              </button>
              <button
                className="button danger"
                onClick={async () => {
                  try {
                    await api(`/decks/${remove.id}`, { method: 'DELETE' });
                    setRemove(null);
                    await refresh();
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                删除
              </button>
            </div>
          </Modal>
        )}
      </>
    );
  return (
    <>
      {hiddenFile}
      <div className="editor-heading">
        <button
          className="icon-button"
          aria-label="返回卡组列表"
          onClick={() => (dirty ? setClosing(true) : setDraft(null))}
        >
          <ArrowLeft size={21} />
        </button>
        <div className="deck-name-field">
          <label className="visually-hidden" htmlFor="deck-name">
            卡组名称
          </label>
          <input
            id="deck-name"
            value={draft.name}
            maxLength={60}
            onChange={(e) => update({ ...draft, name: e.target.value })}
          />
          <span className="small muted">{dirty ? '有未保存的修改' : '已保存'} · YDK</span>
        </div>
        <div className="button-group">
          <button
            className="button secondary compact"
            onClick={() => downloadFile(`${draft.name}.ydk`, ydk(draft))}
          >
            <Download size={16} />
            <span>导出</span>
          </button>
          <button className="button primary compact" disabled={saving} onClick={() => void save()}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}保存卡组
          </button>
        </div>
      </div>
      {errors.length > 0 && <div className="notice warning">{errors.join('；')}</div>}
      <div className="deck-editor">
        <CardDetail code={inspected}>
          <div className="detail-actions">
            <button className="button primary" onClick={() => add(inspected)} disabled={!card}>
              <Plus size={17} />
              加入卡组
            </button>
            <button className="text-button" onClick={() => update({ ...draft, cover: inspected })}>
              设为封面
            </button>
          </div>
        </CardDetail>
        <div className="deck-workspace">
          <div className="workspace-summary">
            <Layers3 size={17} />
            <span>构筑区</span>
            <b>
              {draft.main.length + draft.extra.length + draft.side.length}
              <small> 张</small>
            </b>
          </div>
          {(['main', 'extra', 'side'] as Section[]).map((target) => (
            <section
              key={target}
              className={`deck-zone ${section === target ? 'active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => drop(e, target)}
            >
              <button className="deck-zone-heading" onClick={() => setSection(target)}>
                <span>
                  {sectionLabel[target]}
                  <small>{target.toUpperCase()}</small>
                </span>
                <span className={target === 'main' && draft.main.length < 40 ? 'warning-text' : ''}>
                  {draft[target].length}
                  <span className="muted"> / {target === 'main' ? '40–60' : '15'}</span>
                </span>
              </button>
              <div className="deck-card-grid">
                {draft[target].map((id, i) => (
                  <div
                    className="deck-card"
                    key={`${id}-${i}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/card', String(id));
                      e.dataTransfer.setData(
                        'application/x-dragon-source',
                        JSON.stringify({ section: target, index: i }),
                      );
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      take(target, i);
                    }}
                  >
                    <button
                      className="card-button"
                      onClick={() => setInspected(id)}
                      aria-label={`查看卡片 ${id}`}
                    >
                      <CardImage code={id} />
                    </button>
                    <button
                      className="card-remove"
                      aria-label="移除卡片"
                      onClick={() => take(target, i)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {!draft[target].length && (
                  <div className="zone-empty">
                    {target === 'main' ? '双击右侧卡片，或将卡片拖到这里' : '将卡片拖到这里'}
                  </div>
                )}
              </div>
            </section>
          ))}
          <div className="editor-hint">
            <span>双击添加</span>
            <span>右键移除</span>
            <span>点击查看效果</span>
          </div>
        </div>
        <section className="card-search">
          <div className="search-heading">
            <h3>卡片检索</h3>
            <button className="text-button" onClick={() => setShowDetail(true)}>
              <Info size={14} />
              卡片详情
            </button>
            <span className="mono muted">{total.toLocaleString()}</span>
          </div>
          <label className="search-input">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="卡名、效果或卡片密码"
              aria-label="搜索卡片"
            />
            {query && (
              <button className="icon-button" aria-label="清除搜索" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </label>
          <div className="filter-tabs" role="group" aria-label="卡片类型">
            {[
              ['all', '全部'],
              ['monster', '怪兽'],
              ['spell', '魔法'],
              ['trap', '陷阱'],
              ['extra', '额外'],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={type === value}
                className={type === value ? 'active' : ''}
                onClick={() => setType(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {searching ? (
            <div className="search-loading">
              <LoaderCircle size={20} className="spin" />
            </div>
          ) : searchError ? (
            <EmptyState title="检索暂时不可用" text={searchError} />
          ) : !results.length ? (
            <EmptyState
              title={ready ? '没有找到卡片' : '卡库准备中'}
              text={ready ? '试试较短的卡名，或搜索效果中的关键词。' : '卡库下载完成后会自动显示。'}
            />
          ) : (
            <>
              <div className="search-card-grid">
                {results.map((result) => (
                  <div
                    className={`search-card ${inspected === result.id ? 'inspected' : ''}`}
                    key={result.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/card', String(result.id))}
                  >
                    <button
                      className="card-button"
                      title={result.name}
                      onClick={() => setInspected(result.id)}
                      onDoubleClick={() => add(result.id)}
                    >
                      <CardImage code={result.id} />
                    </button>
                    <button
                      className="card-add"
                      aria-label={`添加${result.name}`}
                      onClick={() => add(result.id)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="small muted search-note">
                显示前 {results.length} 张 · 输入关键词缩小范围
              </p>
            </>
          )}
        </section>
      </div>
      {showDetail && (
        <Modal title="卡片详情" className="info-modal" onClose={() => setShowDetail(false)}>
          <CardDetail code={inspected} />
        </Modal>
      )}
      {closing && (
        <Modal title="有未保存的修改" onClose={() => setClosing(false)}>
          <p>离开构筑区将丢弃本次修改。</p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => {
                setClosing(false);
                setDraft(null);
              }}
            >
              放弃修改
            </button>
            <button
              className="button primary"
              onClick={async () => {
                await save();
                setClosing(false);
              }}
            >
              保存并继续编辑
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
