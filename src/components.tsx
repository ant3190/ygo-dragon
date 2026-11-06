import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, CreditCard, RotateCcw, X } from 'lucide-react';
import { cardType, useCard } from './lib';
import type { Card, Deck } from './types';

export function CardImage({
  code,
  back = false,
  eager = false,
}: {
  code?: number;
  back?: boolean;
  eager?: boolean;
}) {
  const card = useCard(back ? undefined : code),
    [errorCode, setErrorCode] = useState<number>(),
    [loadedCode, setLoadedCode] = useState<number>();
  const error = !!code && errorCode === code,
    loaded = !!code && loadedCode === code;
  return (
    <span className={`card-image ${back || !code ? 'card-back' : ''}`}>
      {!!code && !back && !error && (
        <img
          key={code}
          src={`/api/images/${code}.jpg`}
          alt={card?.name || `卡片 ${code}`}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedCode(code)}
          onError={() => setErrorCode(code)}
        />
      )}
      {(!loaded || error || back || !code) && (
        <span className="card-placeholder">
          <CreditCard size={22} strokeWidth={1} />
          {!back && <small>{card?.name || code || '卡片'}</small>}
        </span>
      )}
      {back && <span className="back-mark">D</span>}
    </span>
  );
}
export function CardDetail({
  code,
  card: supplied,
  children,
}: {
  code?: number;
  card?: Card;
  children?: ReactNode;
}) {
  const loaded = useCard(code),
    card = supplied || loaded;
  return (
    <aside className="card-detail">
      <div className="detail-image">
        <CardImage code={card?.id || code} />
      </div>
      <span className="eyebrow">{cardType(card)}</span>
      <h3>{card?.name || (code ? '读取卡片信息…' : '选择一张卡片')}</h3>
      {card && (
        <>
          {!!(card.type & 1) && (
            <div className="card-stats">
              <span>
                {card.type & 0x4000000 ? 'LINK' : 'LV'} <b>{card.level}</b>
              </span>
              <span>
                ATK <b>{card.atk < 0 ? '?' : card.atk}</b>
              </span>
              {!(card.type & 0x4000000) && (
                <span>
                  DEF <b>{card.def < 0 ? '?' : card.def}</b>
                </span>
              )}
            </div>
          )}
          <p className="effect-text">{card.desc}</p>
          <small className="mono muted">{String(card.id).padStart(8, '0')}</small>
        </>
      )}
      {!card && !code && <p className="muted">查看卡名、数值与完整效果。</p>}
      {children}
    </aside>
  );
}
export function Modal({
  title,
  children,
  onClose,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    (dialog?.querySelector('button, input, select, [tabindex="0"]') as HTMLElement | null)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab') {
        const nodes = dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={ref}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-button" onClick={onClose} aria-label="关闭">
              <X size={19} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
export function DeckTile({
  deck,
  onClick,
  selected,
}: {
  deck: Deck;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <button className={`deck-tile ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span className="deck-art">
        <CardImage code={deck.cover || deck.main[0]} />
        <span className="deck-art-lines" />
      </span>
      <span className="deck-tile-body">
        <span className="deck-name">{deck.name}</span>
        <span className="muted">
          {deck.main.length} 主卡组 <span className="dot-separator">·</span> {deck.extra.length}{' '}
          额外
        </span>
      </span>
      <span className="deck-tile-corner">
        {selected ? <Check size={18} /> : <ArrowUpRight size={18} />}
      </span>
    </button>
  );
}
export function EmptyState({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <CreditCard size={30} strokeWidth={1} />
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="button secondary" onClick={onClick}>
      <RotateCcw size={16} />
      重试
    </button>
  );
}
