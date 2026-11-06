import { useEffect, useState } from 'react';
import type { Card, Deck, Option } from './types';

export async function api<T = any>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败 ${response.status}`);
  return data;
}
export const post = <T = any>(path: string, value: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(value) });
const cards = new Map<number, Card>(),
  requests = new Map<number, Promise<Card>>();
export function cacheCards(values: Card[]) {
  for (const value of values) cards.set(value.id, value);
}
export function cachedCard(id: number) {
  return cards.get(id);
}
export function useCard(id?: number) {
  const [card, setCard] = useState<Card | undefined>(id ? cards.get(id) : undefined);
  useEffect(() => {
    let alive = true;
    setCard(id ? cards.get(id) : undefined);
    if (!id || cards.has(id)) return;
    if (!requests.has(id))
      requests.set(
        id,
        api<Card>(`/cards/${id}`)
          .then((c) => {
            cards.set(id, c);
            return c;
          })
          .finally(() => requests.delete(id)),
      );
    void requests
      .get(id)!
      .then((c) => {
        if (alive) setCard(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);
  return card;
}
export const sectionLabel = { main: '主卡组', extra: '额外卡组', side: '副卡组' };
export const locationLabel: Record<number, string> = {
  1: '卡组',
  2: '手牌',
  4: '怪兽区',
  8: '魔法 / 陷阱区',
  16: '墓地',
  32: '除外',
  64: '额外卡组',
};
export const phases: Record<number, string> = {
  1: '抽卡',
  2: '准备',
  4: '主要 1',
  8: '战斗开始',
  16: '战斗',
  32: '伤害',
  64: '伤害计算',
  128: '战斗结束',
  256: '主要 2',
  512: '结束',
};
export function cardType(card?: Card) {
  if (!card) return '卡片';
  return card.type & 4
    ? '陷阱卡'
    : card.type & 2
      ? '魔法卡'
      : `${card.type & 0x4000000 ? '连接' : card.type & 0x800000 ? '超量' : card.type & 0x2000 ? '同调' : card.type & 0x40 ? '融合' : card.type & 0x10 ? '通常' : '效果'}怪兽`;
}
export function ydk(deck: Deck) {
  return `#created by YGO Dragon\n#main\n${deck.main.join('\n')}\n#extra\n${deck.extra.join('\n')}\n!side\n${deck.side.join('\n')}\n`;
}
export function downloadFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function sumValid(options: Option[], target: number, greater = false) {
  let values = new Set([0]);
  for (const option of options) {
    const low = (option.amount || 0) & 65535,
      high = (option.amount || 0) >>> 16;
    values = new Set(
      [...values].flatMap((n) => (high && high !== low ? [n + low, n + high] : [n + low])),
    );
    if (values.size > 20000) return false;
  }
  return [...values].some((n) => (greater ? n >= target : n === target));
}
export function useHash() {
  const get = () => location.hash.slice(1) || 'home',
    [route, setRoute] = useState(get);
  useEffect(() => {
    const update = () => setRoute(get());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
export function useDebounce<T>(value: T, delay = 250) {
  const [debounced, set] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => set(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
