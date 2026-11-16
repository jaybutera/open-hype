import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Records 30s candles from Hyperliquid's trades feed. Hyperliquid's smallest
 * candle is 1m, so sub-minute bars only exist from the time this recorder
 * started watching a coin. Completed bars are appended to
 * <dir>/<coin>.jsonl as [t, o, h, l, c, v, n]; the last KEEP_MS stay in memory.
 * A coin is watched from the first time anyone asks for it, and the watch list
 * persists in <dir>/coins.json, so history keeps building with no tab open.
 */
export const BAR_MS = 30_000;
const KEEP_MS = 7 * 86_400_000;
const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const DEFAULT_COINS = ['BTC', 'ETH', 'xyz:SP500', 'xyz:XYZ100'];
const COIN_RE = /^[A-Za-z0-9:_-]{1,32}$/;

type Row = [number, string, string, string, string, string, number];

export interface Bar30 {
  t: number; T: number; s: string; i: '30s';
  o: string; h: string; l: string; c: string; v: string; n: number;
}

interface Trade { coin: string; px: string; sz: string; time: number; tid: number }

function toBar(coin: string, r: Row): Bar30 {
  return { t: r[0], T: r[0] + BAR_MS - 1, s: coin, i: '30s', o: r[1], h: r[2], l: r[3], c: r[4], v: r[5], n: r[6] };
}

export class Bars30Recorder {
  private bars = new Map<string, Row[]>();
  private live = new Map<string, Row>();
  private seen = new Map<string, Set<number>>();
  private coins = new Set<string>();
  private ws: WebSocket | null = null;
  private retryMs = 1000;
  private timers: ReturnType<typeof setInterval>[] = [];
  private stopped = false;

  constructor(private dir: string, private log: (msg: string) => void = () => {}) {
    mkdirSync(dir, { recursive: true });
    const listFile = join(dir, 'coins.json');
    let list = DEFAULT_COINS;
    try { if (existsSync(listFile)) list = JSON.parse(readFileSync(listFile, 'utf8')); } catch { /* defaults */ }
    for (const c of list) if (typeof c === 'string' && COIN_RE.test(c)) this.addCoin(c, false);
  }

  start(): void {
    this.connect();
    this.timers.push(setInterval(() => this.flushIdle(), 2_000));
    this.timers.push(setInterval(() => this.send({ method: 'ping' }), 50_000));
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.ws?.close();
  }

  isValidCoin(coin: string): boolean { return COIN_RE.test(coin); }

  /** Bars with from <= t < to, oldest first, the forming bar last; at most limit (newest kept). */
  get(coin: string, from: number, to: number, limit: number): { bars: Bar30[]; since: number | null } {
    this.addCoin(coin, true);
    const rows = this.bars.get(coin) ?? [];
    const out: Row[] = [];
    for (const r of rows) if (r[0] >= from && r[0] < to) out.push(r);
    const cur = this.live.get(coin);
    if (cur && cur[0] >= from && cur[0] < to) out.push(cur);
    return { bars: out.slice(-limit).map(r => toBar(coin, r)), since: rows[0]?.[0] ?? cur?.[0] ?? null };
  }

  private addCoin(coin: string, persist: boolean): void {
    if (this.coins.has(coin)) return;
    this.coins.add(coin);
    this.bars.set(coin, this.loadFile(coin));
    this.seen.set(coin, new Set());
    if (persist) {
      writeFileSync(join(this.dir, 'coins.json'), JSON.stringify([...this.coins]));
      this.log(`recording 30s bars for ${coin}`);
    }
    this.send({ method: 'subscribe', subscription: { type: 'trades', coin } });
  }

  private file(coin: string): string { return join(this.dir, `${coin.replace(/:/g, '_')}.jsonl`); }

  private loadFile(coin: string): Row[] {
    const f = this.file(coin);
    if (!existsSync(f)) return [];
    const cutoff = Date.now() - KEEP_MS;
    const rows: Row[] = [];
    const lines = readFileSync(f, 'utf8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as Row;
        if (r[0] >= cutoff && (rows.length === 0 || r[0] > rows[rows.length - 1][0])) rows.push(r);
      } catch { /* torn line */ }
    }
    // Compact once the file holds mostly expired bars.
    if (lines.length > rows.length * 2 + 1000) writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    return rows;
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 1000;
      for (const coin of this.coins) this.send({ method: 'subscribe', subscription: { type: 'trades', coin } });
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(String(evt.data)) as { channel?: string; data?: Trade[] };
        if (msg.channel === 'trades' && Array.isArray(msg.data)) for (const t of msg.data) this.onTrade(t);
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.stopped) return;
      this.ws = null;
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
    };
    ws.onerror = () => ws.close();
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onTrade(t: Trade): void {
    const coin = t.coin;
    if (!this.coins.has(coin) || typeof t.time !== 'number') return;
    // Reconnects replay recent trades; skip ones already counted.
    const seen = this.seen.get(coin)!;
    if (seen.has(t.tid)) return;
    seen.add(t.tid);
    if (seen.size > 5000) {
      const it = seen.values();
      for (let i = 0; i < 2500; i++) seen.delete(it.next().value as number);
    }
    const bucket = Math.floor(t.time / BAR_MS) * BAR_MS;
    const rows = this.bars.get(coin)!;
    if (rows.length && bucket <= rows[rows.length - 1][0]) return; // bar already closed
    let cur = this.live.get(coin);
    if (cur && bucket < cur[0]) return;
    if (cur && bucket > cur[0]) { this.close(coin, cur); cur = undefined; }
    const px = parseFloat(t.px);
    if (!cur) {
      this.live.set(coin, [bucket, t.px, t.px, t.px, t.px, t.sz, 1]);
      return;
    }
    if (px > parseFloat(cur[2])) cur[2] = t.px;
    if (px < parseFloat(cur[3])) cur[3] = t.px;
    cur[4] = t.px;
    cur[5] = String(+(parseFloat(cur[5]) + parseFloat(t.sz)).toPrecision(12));
    cur[6] += 1;
  }

  private close(coin: string, row: Row): void {
    this.live.delete(coin);
    const rows = this.bars.get(coin)!;
    rows.push(row);
    const cutoff = Date.now() - KEEP_MS;
    let drop = 0;
    while (drop < rows.length && rows[drop][0] < cutoff) drop++;
    if (drop) rows.splice(0, drop);
    try { appendFileSync(this.file(coin), JSON.stringify(row) + '\n'); } catch (e) { this.log(`write failed: ${(e as Error).message}`); }
  }

  /** Close bars whose 30s ended a couple of seconds ago with no newer trade. */
  private flushIdle(): void {
    const now = Date.now();
    for (const [coin, cur] of this.live) if (now >= cur[0] + BAR_MS + 2_000) this.close(coin, cur);
  }
}
