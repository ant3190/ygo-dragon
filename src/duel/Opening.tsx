import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from 'lucide-react';
import type { OpeningState, Prompt, Room } from '../types';
import type { Send } from '../main';
import { CardImage } from '../components';
import './opening.css';

const gestures = [
  {
    value: 2,
    label: '石头',
    paths: [
      'M8 11v-3.5a1.5 1.5 0 0 1 3 0v2.5',
      'M11 9.5v-3a1.5 1.5 0 0 1 3 0v3.5',
      'M14 7.5a1.5 1.5 0 0 1 3 0v2.5',
      'M17 9.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7l-.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47',
    ],
  },
  {
    value: 1,
    label: '剪刀',
    paths: [
      'M8 13v-8.5a1.5 1.5 0 0 1 3 0v7.5',
      'M17 11.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47',
      'M14 10.5a1.5 1.5 0 0 1 3 0v1.5',
      'M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5',
    ],
  },
  {
    value: 3,
    label: '布',
    paths: [
      'M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5',
      'M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5',
      'M14 5.5a1.5 1.5 0 0 1 3 0v6.5',
      'M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47',
    ],
  },
];
// Gesture paths: Tabler Icons, MIT. See THIRD_PARTY.md.
function Gesture({ value }: { value?: number }) {
  const gesture = gestures.find((item) => item.value === value);
  return gesture ? (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {gesture.paths.map((path, i) => (
        <path d={path} key={i} />
      ))}
    </svg>
  ) : (
    <span className="md-hidden-gesture">?</span>
  );
}

export function Opening({
  opening,
  prompt,
  room,
  name,
  connected,
  send,
  fatal,
  inputEpoch,
}: {
  opening: OpeningState;
  prompt: Prompt | null;
  room: Room | null;
  name: string;
  connected: boolean;
  send: Send;
  fatal: string;
  inputEpoch: number;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setSelected(null);
    setSubmitting(false);
  }, [prompt?.id, inputEpoch]);
  const { stage } = opening;
  const rps = stage === 'rps',
    order = stage === 'turn-order';
  const waiting = !rps && !order;
  const locked = !connected || submitting || !!fatal || !prompt;
  const confirm = () => {
    if (locked || selected === null || !prompt) return;
    setSubmitting(true);
    send({ type: 'response', input: { promptId: prompt.id, ids: [selected] } });
  };
  const opponent = room?.opponent || room?.players[1]?.name || '对手';
  const title = fatal
    ? '对战连接中断'
    : stage === 'connecting'
      ? '正在邀请对手'
      : stage === 'rps-result'
        ? opening.outcome === 'win'
          ? '猜拳获胜'
          : opening.outcome === 'draw'
            ? '平局'
            : '对手获胜'
        : order
          ? '选择先后手'
          : stage === 'starting'
            ? '准备开始决斗'
            : stage === 'rps-wait'
              ? '等待对手出拳'
              : opening.previousDraw
                ? '平局，请重新出拳'
                : '猜拳';
  return (
    <main className="md-opening">
      <header className="md-opening-header">
        <button className="text-button" onClick={() => send({ type: 'leave' })}>
          <ArrowLeft size={17} />
          取消对战
        </button>
        <span>决斗准备</span>
      </header>
      <div className="md-opening-content">
        <div className="md-opening-players">
          <span>
            <i>{name.slice(0, 1)}</i>
            {name}
          </span>
          <span>
            {opponent}
            <i className="opponent">{opponent.slice(0, 1)}</i>
          </span>
        </div>
        <div className="md-opening-title" aria-live="polite">
          <span>
            {room?.source || '单人对战'}
            {opening.round > 1 ? ` · 第 ${opening.round} 次猜拳` : ''}
          </span>
          <h1>{title}</h1>
          <p>
            {fatal ||
              (rps
                ? '选择出拳，确认后双方同时揭晓。'
                : order
                  ? '由你决定这场决斗的先后顺序。'
                  : stage === 'rps-result'
                    ? opening.outcome === 'draw'
                      ? '双方出拳相同，即将重新猜拳。'
                      : opening.outcome === 'win'
                        ? '由你选择先攻或后攻。'
                        : '由对手选择先攻或后攻。'
                    : stage === 'rps-wait'
                      ? '你的选择已提交。'
                      : stage === 'starting'
                        ? '正在进入对战场地。'
                        : '连接对战服务器，请稍候。')}
          </p>
        </div>
        {rps ? (
          <div className="md-rps-choices" role="group" aria-label="选择出拳">
            {gestures.map((gesture) => {
              const option = prompt?.options.find((item) => item.value === gesture.value);
              return (
                <button
                  key={gesture.value}
                  className={`md-gesture-choice ${selected === option?.id ? 'selected' : ''}`}
                  aria-label={gesture.label}
                  aria-pressed={selected === option?.id}
                  disabled={locked || !option}
                  onClick={() => setSelected(option!.id)}
                >
                  <Gesture value={gesture.value} />
                  <span>{gesture.label}</span>
                  {selected === option?.id && <Check className="md-gesture-check" size={18} />}
                </button>
              );
            })}
          </div>
        ) : order ? (
          <div className="md-order-choices" role="group" aria-label="选择先后手">
            {prompt?.options.map((option) => (
              <button
                key={option.id}
                className={`md-order-choice ${selected === option.id ? 'selected' : ''}`}
                aria-pressed={selected === option.id}
                disabled={locked}
                onClick={() => setSelected(option.id)}
              >
                <b>{option.label}</b>
                <span>{option.label === '先攻' ? '先展开场面' : '后手进攻'}</span>
                {selected === option.id && <Check size={19} />}
              </button>
            ))}
          </div>
        ) : stage === 'connecting' || stage === 'starting' ? (
          <div className="md-opening-decks">
            <CardImage back />
            <span>{stage === 'connecting' ? '等待对手' : '即将开始'}</span>
            <CardImage back />
          </div>
        ) : (
          <div
            className={`md-rps-reveal ${stage === 'rps-result' ? 'revealed' : ''}`}
            key={`${stage}-${opening.round}`}
          >
            <div>
              <span>你</span>
              <Gesture value={opening.mine} />
              <b>{gestures.find((g) => g.value === opening.mine)?.label || '等待'}</b>
            </div>
            <span className="md-rps-divider">对决</span>
            <div className="opponent">
              <span>{opponent}</span>
              <Gesture value={opening.opponent} />
              <b>{gestures.find((g) => g.value === opening.opponent)?.label || '等待'}</b>
            </div>
          </div>
        )}
        <div className="md-opening-confirm">
          {!waiting ? (
            <button
              className="button primary"
              onClick={confirm}
              disabled={locked || selected === null}
            >
              {submitting ? <LoaderCircle size={17} className="spin" /> : null}
              {rps ? '确认出拳' : '确认先后手'}
              <ArrowRight size={17} />
            </button>
          ) : !fatal ? (
            <span role="status">
              <LoaderCircle size={15} className="spin" />
              {stage === 'rps-result' ? '即将继续' : '等待服务器'}
            </span>
          ) : (
            <button className="button" onClick={() => send({ type: 'leave' })}>
              返回大厅
            </button>
          )}
        </div>
        <ol className="md-opening-steps" aria-label="准备进度">
          <li className={!order && stage !== 'starting' ? 'current' : ''}>猜拳</li>
          <li className={order ? 'current' : ''}>选择先后手</li>
          <li className={stage === 'starting' ? 'current' : ''}>开始决斗</li>
        </ol>
      </div>
    </main>
  );
}
