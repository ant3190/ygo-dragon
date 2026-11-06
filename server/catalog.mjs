import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export class Catalog {
  constructor(file, stringsFile) {
    this.file = file;
    this.stringsFile = stringsFile;
    this.cards = new Map();
    this.system = new Map();
    this.reload();
  }
  reload() {
    try {
      const db = new DatabaseSync(this.file, { readOnly: true });
      try {
        const rows = db
          .prepare(
            `SELECT d.id,d.alias,d.type,d.atk,d.def,d.level,d.attribute,CAST(d.race AS TEXT) AS race,CAST(d.setcode AS TEXT) AS setcode,t.name,t.desc,${Array.from({ length: 16 }, (_, i) => `t.str${i + 1}`).join(',')} FROM datas d JOIN texts t ON d.id=t.id`,
          )
          .all();
        const cards = new Map();
        for (const r of rows) {
          cards.set(r.id, {
            id: r.id,
            name: r.name,
            desc: r.desc,
            type: r.type,
            atk: r.atk,
            def: r.def,
            level: r.level & 0xff,
            lscale: (r.level >> 24) & 0xff,
            rscale: (r.level >> 16) & 0xff,
            race: r.race,
            attribute: r.attribute,
            alias: r.alias,
            setcode: r.setcode,
            strings: Array.from({ length: 16 }, (_, i) => r[`str${i + 1}`] || ''),
          });
        }
        this.cards = cards;
      } finally {
        db.close();
      }
    } catch {
      /* The download service reports bootstrap errors; retain the last catalog. */
    }
    try {
      this.system = new Map(
        [...readFileSync(this.stringsFile, 'utf8').matchAll(/^!system\s+(\d+)\s+(.+)$/gm)].map(
          (m) => [Number(m[1]), m[2].trim()],
        ),
      );
    } catch {}
  }
  get(code) {
    return this.cards.get(Number(code));
  }
  search({ q = '', type = 'all', offset = 0, limit = 60 } = {}) {
    const terms = String(q).trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = [...this.cards.values()].filter((c) => {
      if (type === 'monster' && !(c.type & 1)) return false;
      if (type === 'spell' && !(c.type & 2)) return false;
      if (type === 'trap' && !(c.type & 4)) return false;
      if (type === 'extra' && !(c.type & 0x4802040)) return false;
      return terms.every((t) => `${c.id} ${c.name} ${c.desc}`.toLowerCase().includes(t));
    });
    // Favor familiar cards at the beginning without loading images for the full database.
    if (!q)
      filtered.sort(
        (a, b) =>
          (featured.indexOf(b.id) >= 0 ? 1 : 0) - (featured.indexOf(a.id) >= 0 ? 1 : 0) ||
          a.id - b.id,
      );
    return {
      total: filtered.length,
      cards: filtered.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(100, limit)),
    };
  }
  description(value) {
    const n = BigInt(value || 0);
    if (n < 10000n) return this.system.get(Number(n)) || `选择效果 ${n}`;
    const card = this.get(Number(n >> 4n));
    return card?.strings[Number(n & 15n)] || (card ? `${card.name}的效果` : '选择效果');
  }
}
export const featured = [
  89631139, 46986414, 14558127, 23434538, 55144522, 83764718, 53129443, 44095762, 74677422,
  89604813, 70902743, 84013237,
];

export function coreCard(c) {
  if (!c) return null;
  let setcode = BigInt(c.setcode),
    setcodes = [];
  for (let i = 0; i < 4; i++, setcode >>= 16n)
    if (setcode & 0xffffn) setcodes.push(Number(setcode & 0xffffn));
  return {
    code: c.id,
    alias: c.alias,
    setcodes,
    type: c.type,
    level: c.level,
    attribute: c.attribute,
    race: BigInt(c.race),
    attack: c.atk,
    defense: c.def,
    lscale: c.lscale,
    rscale: c.rscale,
    link_marker: c.type & 0x4000000 ? c.def : 0,
  };
}
