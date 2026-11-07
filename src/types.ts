export type Section = 'main' | 'extra' | 'side';
export interface Deck {
  id: string;
  name: string;
  main: number[];
  extra: number[];
  side: number[];
  cover?: number;
  description?: string;
  updatedAt?: number;
}
export interface Card {
  id: number;
  name: string;
  desc: string;
  type: number;
  atk: number;
  def: number;
  level: number;
  attribute: number;
  race: string;
  alias: number;
  lscale: number;
  rscale: number;
}
export interface ResourceStatus {
  phase: string;
  ready: boolean;
  cards: number;
  images: number;
  done: number;
  total: number;
  current?: string;
  updated?: number;
  received?: number;
  fileTotal?: number;
  errors: { file: string; reason: string }[];
  bulk?: {
    total: number;
    done: number;
    failed: number;
    errors: { code: number; reason: string }[];
  };
}
export interface FieldCard {
  uid?: string;
  code?: number;
  controller: number;
  location: number;
  sequence: number;
  position: number;
  attack?: number;
  defense?: number;
  level?: number;
  rank?: number;
  hidden?: boolean;
  overlayCards?: number[];
  counters?: Record<string, number>;
  link?: { rating: number; marker: number };
}
export interface Player {
  player: number;
  lp: number;
  zones: Record<string, (FieldCard | null)[]>;
}
export interface DuelState {
  opening?: OpeningState;
  players: Player[];
  turn: number;
  turnPlayer: number;
  phase: number;
  chain: { code: number; controller: number; index: number }[];
  ended: boolean;
  winner: number | null;
}
export interface OpeningState {
  stage: 'connecting' | 'rps' | 'rps-wait' | 'rps-result' | 'turn-order' | 'starting';
  round: number;
  mine?: number;
  opponent?: number;
  outcome?: 'win' | 'lose' | 'draw';
  previousDraw?: boolean;
}
export interface Option extends Partial<FieldCard> {
  value?: number;
  id: string;
  label: string;
  description?: string;
  action?: number;
  phase?: string;
  selected?: boolean;
  capacity?: number;
  amount?: number;
  release_param?: number;
}
export interface Prompt {
  id: number;
  player: number;
  kind: string;
  title: string;
  options: Option[];
  min: number;
  max: number;
  canCancel: boolean;
  canFinish?: boolean;
  specialCount?: number;
  amount?: number;
  greater?: boolean;
  mandatory?: Option[];
  tribute?: boolean;
  tributeMin?: number;
}
export interface Room {
  opponent?: string;
  source?: string;
  id: string;
  name: string;
  mode: string;
  started: boolean;
  ended: boolean;
  players: ({ name: string; ready: boolean; connected: boolean; seat: number } | null)[];
}
export interface GameEvent {
  text?: string;
  id: number;
  at: number;
  type: string;
  player?: number;
  code?: number;
  count?: number;
  turn?: number;
  phase?: number;
  amount?: number;
  winner?: number;
  cards?: FieldCard[];
}
export interface Opponent {
  id: string;
  name: string;
  command: string;
  description: string;
  tags: string[];
}
export interface Motion {
  type: string;
  uid?: string;
  from?: Partial<FieldCard>;
  to?: Partial<FieldCard>;
  player?: number;
  code?: number;
  index?: number;
  count?: number;
  amount?: number;
}
export interface Settings {
  name: string;
  motion: 'normal' | 'quick' | 'none';
  accent: 'jade' | 'blue' | 'amber';
  confirmEnd: boolean;
  chain: 'auto' | 'all' | 'off';
}
export interface ResponseInput {
  promptId: number;
  ids?: string[];
  cancel?: boolean;
  finish?: boolean;
  clear?: boolean;
  cancelAll?: boolean;
  materialIds?: string[];
  counts?: number[];
}
