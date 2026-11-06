import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  ChevronRight,
  CircleHelp,
  Command,
  Database,
  DoorOpen,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  Settings2,
  Shield,
  Swords,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { api, useHash } from './lib';
import { CardImage, DeckTile, Modal } from './components';
import { Decks } from './pages/Decks';
import { Play } from './pages/Play';
import { SettingsPage } from './pages/Settings';
import { Duel } from './pages/Duel';
import type { Deck, DuelState, GameEvent, Prompt, ResourceStatus, Room, Settings } from './types';
import './styles.css';

const defaults: Settings = {
  name: '决斗者',
  motion: 'normal',
  accent: 'jade',
  confirmEnd: true,
  chain: 'auto',
};
function savedSettings(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('dragon-settings') || '{}') };
  } catch {
    return defaults;
  }
}
const nav = [
  { id: 'home', label: '决斗大厅', icon: LayoutDashboard },
  { id: 'decks', label: '卡组编辑', icon: Layers3 },
  { id: 'solo', label: '单人对战', icon: Swords },
  { id: 'online', label: '联机对战', icon: Users },
];
export type Send = (message: Record<string, unknown>) => void;
function App() {
  const route = useHash(),
    [settings, setSettings] = useState(savedSettings),
    [decks, setDecks] = useState<Deck[]>([]),
    [resources, setResources] = useState<ResourceStatus>({
      phase: 'loading',
      ready: false,
      cards: 0,
      images: 0,
      done: 0,
      total: 0,
      errors: [],
    });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [connected, setConnected] = useState(false),
    [room, setRoom] = useState<Room | null>(null),
    [seat, setSeat] = useState(0),
    [game, setGame] = useState<DuelState | null>(null),
    [prompt, setPrompt] = useState<Prompt | null>(null),
    [events, setEvents] = useState<GameEvent[]>([]),
    [toast, setToast] = useState(''),
    [help, setHelp] = useState(false);
  const socket = useRef<WebSocket | null>(null),
    notify = (text: string) => setToast(text);
  const refresh = async () => {
    try {
      const data = await api('/bootstrap');
      setDecks(data.decks);
      setResources(data.resources);
      setRoom(data.room);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (resources.ready && !decks.length) void refresh();
  }, [resources.ready]);
  useEffect(() => {
    document.documentElement.dataset.accent = settings.accent;
    document.documentElement.dataset.motion = settings.motion;
    try {
      localStorage.setItem('dragon-settings', JSON.stringify(settings));
    } catch {}
  }, [settings]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (loading || error) return;
    let disposed = false,
      retry: ReturnType<typeof setTimeout>,
      attempts = 0;
    function connect() {
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`,
      );
      socket.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!disposed) retry = setTimeout(connect, Math.min(15000, 800 * 2 ** attempts++));
      };
      ws.onmessage = (event) => {
        try {
          const m = JSON.parse(event.data);
          if (m.type === 'room') {
            setRoom(m.room);
            setSeat(m.seat);
          }
          if (m.type === 'view') {
            setGame(m.state);
            setPrompt(m.prompt);
            setSeat(m.viewer);
            location.hash = 'duel';
          }
          if (m.type === 'event') setEvents((old) => [...old, m.event].slice(-100));
          if (m.type === 'history') setEvents(m.events);
          if (m.type === 'left') {
            setGame(null);
            setPrompt(null);
            setRoom(null);
            setEvents([]);
            location.hash = 'home';
          }
          if (m.type === 'resources') setResources(m.status);
          if (m.type === 'error' || m.type === 'fatal') notify(m.message);
        } catch {}
      };
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, [loading, error]);
  const send: Send = (message) => {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      notify('连接正在恢复，请稍后重试');
      return;
    }
    socket.current.send(JSON.stringify({ ...message, name: settings.name }));
  };
  const inDuel = route === 'duel' && !!game;
  const pageName =
    nav.find((x) => x.id === route)?.label || (route === 'settings' ? '偏好设置' : '决斗大厅');
  return (
    <div className={`app-shell ${inDuel ? 'in-duel' : ''}`}>
      {!inDuel && (
        <aside className="sidebar">
          <a className="brand" href="#home">
            <img src="/dragon.svg" alt="" />
            <span>
              DRAGON<small>游 戏 王 对 战 平 台</small>
            </span>
          </a>
          <div className="sidebar-caption">PLAY YOUR NEXT MOVE</div>
          <nav aria-label="主导航">
            {nav.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`nav-item ${route === item.id ? 'active' : ''}`}
                aria-current={route === item.id ? 'page' : undefined}
              >
                <item.icon size={19} />
                <span>{item.label}</span>
                {route === item.id && <span className="nav-indicator" />}
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <a href="#settings" className={`nav-item ${route === 'settings' ? 'active' : ''}`}>
              <Settings2 size={19} />
              <span>偏好设置</span>
            </a>
            <button className="nav-item" onClick={() => setHelp(true)}>
              <CircleHelp size={19} />
              <span>操作帮助</span>
            </button>
            <div className="sidebar-profile">
              <span className="avatar">{settings.name.slice(0, 1)}</span>
              <span>
                <strong>{settings.name}</strong>
                <small>本地决斗档案</small>
              </span>
              <span
                className={`connection-dot ${connected ? '' : 'offline'}`}
                title={connected ? '服务已连接' : '正在连接'}
              />
            </div>
          </div>
        </aside>
      )}
      <div className="app-content">
        {!inDuel && (
          <header className="topbar">
            <div className="breadcrumb">
              <span>游戏王</span>
              <ChevronRight size={13} />
              <strong>{pageName}</strong>
            </div>
            <div className="topbar-right">
              <a className={`resource-pill ${resources.ready ? 'ready' : ''}`} href="#settings">
                <span className={`connection-dot ${resources.ready ? '' : 'offline'}`} />
                {resources.ready ? '本地资源已就绪' : '资源准备中'}
              </a>
              <button className="icon-button" aria-label="操作帮助" onClick={() => setHelp(true)}>
                <Command size={18} />
              </button>
            </div>
          </header>
        )}
        {loading ? (
          <div className="loading-page">
            <LoaderCircle className="spin" />
            <p>正在连接本地服务…</p>
          </div>
        ) : error ? (
          <div className="loading-page">
            <WifiOff />
            <h2>暂时无法连接</h2>
            <p>{error}</p>
            <button
              className="button primary"
              onClick={() => {
                setLoading(true);
                void refresh();
              }}
            >
              重新连接
            </button>
          </div>
        ) : inDuel ? (
          <Duel
            state={game}
            prompt={prompt}
            room={room}
            seat={seat}
            events={events}
            connected={connected}
            settings={settings}
            onSettings={setSettings}
            send={send}
            notify={notify}
          />
        ) : (
          <main className={`page page-${route}`}>
            {route === 'decks' ? (
              <Decks decks={decks} refresh={refresh} notify={notify} ready={resources.ready} />
            ) : route === 'solo' || route === 'online' ? (
              <Play
                mode={route}
                decks={decks}
                room={room}
                connected={connected}
                ready={resources.ready}
                seat={seat}
                send={send}
                notify={notify}
              />
            ) : route === 'settings' ? (
              <SettingsPage
                settings={settings}
                onChange={setSettings}
                resources={resources}
                decks={decks}
                notify={notify}
              />
            ) : (
              <Home decks={decks} resources={resources} game={game} room={room} />
            )}
          </main>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <Modal title="操作帮助" onClose={() => setHelp(false)}>
          <div className="help-content">
            <p>
              <b>卡组编辑</b>
              ：点击卡片查看效果；双击、点击加号或拖入卡组添加；右键卡片移除。支持导入和导出 .ydk
              文件。
            </p>
            <p>
              <b>对战</b>
              ：点击手牌或场上的卡片选择行动。选择素材和对象后点击「确认」，右键清空当前选择。连接、融合的连续选材会保留在同一面板，最后点击确认。
            </p>
            <p>
              <b>查看区域</b>：点击墓地、除外或额外卡组直接查看列表。对手的隐藏信息不会显示。
            </p>
            <p>
              <b>联机</b>
              ：双方打开同一服务器地址，创建或输入房间码。双方准备后由房主开始。断线后刷新可重连当前对局。
            </p>
            <p>
              <b>本地资源</b>
              ：首次自动准备卡库与规则脚本；卡图按需保存，可在设置后台补全。没有卡图也可根据卡名与效果继续操作。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Home({
  decks,
  resources,
  game,
  room,
}: {
  decks: Deck[];
  resources: ResourceStatus;
  game: DuelState | null;
  room: Room | null;
}) {
  const featured = decks[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR DUEL, YOUR WAY</span>
          <h1>
            决斗大厅<span className="title-dot">.</span>
          </h1>
        </div>
        <span className="quiet-label">
          <Shield size={15} />
          专注每一次决策
        </span>
      </div>
      {(game || room) && (
        <a href={game ? '#duel' : '#online'} className="resume-banner">
          <Swords size={18} />
          <span>{game?.ended ? '查看上一场对局' : '你有一场进行中的对局'}</span>
          <ArrowRight size={18} />
        </a>
      )}
      <section className="lobby-hero">
        <div className="hero-copy">
          <span className="section-index">
            <span />
            READY WHEN YOU ARE
          </span>
          <h2>
            下一场决斗，
            <br />
            <span>由你掌控。</span>
          </h2>
          <p>
            构筑你的战术，找到自己的节奏。
            <br />
            从一次练习，走向下一场交锋。
          </p>
          <div className="hero-actions">
            <a href="#solo" className="button primary">
              开始决斗
              <ArrowRight size={17} />
            </a>
            <a href="#decks" className="text-button">
              编辑卡组
              <ChevronRight size={16} />
            </a>
          </div>
          <div className="hero-footnote">
            <span className="connection-dot" />
            {resources.ready
              ? `${resources.cards.toLocaleString()} 张卡片已就绪`
              : '正在准备本地卡库'}
          </div>
        </div>
        <div className="hero-card-display" aria-label="卡片展示">
          <div className="hero-card-line">
            <span>DECK / 001</span>
            <span>OCG</span>
          </div>
          <div className="hero-cards">
            {[46986414, 89631139, 55144522].map((id, i) => (
              <div className={`hero-card hero-card-${i}`} key={id}>
                <CardImage code={id} eager />
              </div>
            ))}
          </div>
          <div className="hero-card-bottom">
            <span>BUILD YOUR STRATEGY</span>
            <span className="display-rule" />
            <span>DRAGON</span>
          </div>
        </div>
      </section>
      <div className="mode-grid">
        <a className="mode-card" href="#solo">
          <div className="mode-icon">
            <Swords size={23} />
          </div>
          <div>
            <span className="eyebrow">SOLO PRACTICE</span>
            <h3>单人对战</h3>
            <p>熟悉卡组，推演你的下一步。</p>
          </div>
          <ArrowRight className="mode-arrow" size={19} />
        </a>
        <a className="mode-card" href="#online">
          <div className="mode-icon blue">
            <Users size={23} />
          </div>
          <div>
            <span className="eyebrow">DUEL WITH FRIENDS</span>
            <h3>联机对战</h3>
            <p>创建房间，与朋友正面交锋。</p>
          </div>
          <ArrowRight className="mode-arrow" size={19} />
        </a>
      </div>
      <div className="lobby-lower">
        <section>
          <div className="section-heading">
            <h2>
              我的卡组 <span>{decks.length.toString().padStart(2, '0')}</span>
            </h2>
            <a className="text-button" href="#decks">
              全部卡组
              <ArrowRight size={16} />
            </a>
          </div>
          <div className="home-decks">
            {decks.slice(0, 3).map((deck) => (
              <DeckTile
                key={deck.id}
                deck={deck}
                onClick={() => {
                  location.hash = 'decks';
                }}
              />
            ))}
            {!featured && (
              <a className="empty-deck" href="#decks">
                <Layers3 />
                <span>导入你的第一副卡组</span>
              </a>
            )}
          </div>
        </section>
        <section className="local-panel">
          <div className="section-heading">
            <h2>本地资源</h2>
            <Database size={17} />
          </div>
          <div className="resource-stat">
            <strong>{resources.cards.toLocaleString()}</strong>
            <span>卡片数据</span>
          </div>
          <div className="local-panel-line">
            <span>已保存卡图</span>
            <b>{resources.images.toLocaleString()}</b>
          </div>
          <div className="local-panel-line">
            <span>服务连接</span>
            <span className="status-text">
              <Wifi size={13} />
              本地服务
            </span>
          </div>
          <a className="text-button" href="#settings">
            管理资源
            <ArrowRight size={16} />
          </a>
        </section>
      </div>
      <footer className="page-footer">
        <span>
          YGO DRAGON <span className="muted">/</span> 0.1.0
        </span>
        <span>专注构筑 · 自由决斗</span>
      </footer>
    </>
  );
}
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="loading-page">
        <h1>界面遇到了问题</h1>
        <p>{this.state.error}</p>
        <button className="button primary" onClick={() => location.reload()}>
          重新加载
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
