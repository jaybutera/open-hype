import type { LedgerEntry, LedgerKind } from '../../engine/paper/ledger.ts';
import { parseOccSymbol } from './occSymbol.ts';
import { classifyShapes, type LegShape } from './strategy.ts';

export type SpreadLifecycle = 'option-open' | 'option-close' | 'option-expire';

export interface SpreadFillGroup {
  kind: 'spread';
  spreadId: string;
  lifecycle: SpreadLifecycle;
  fills: LedgerEntry[];
  strategy: string;
  /**
   * Signed net cash flow for this lifecycle, in dollars. Positive = credit
   * received (money in), negative = debit paid (money out). Computed as
   * Σ (sellSign × size × premiumPerShare × 100) where sellSign is +1 for
   * sell fills and -1 for buy fills. This matches the "net debit/credit"
   * convention used in OrderForm / PositionsOptions.
   */
  netPremium: number;
  realizedPnl: number;
  firstTimestamp: number;
}

export interface SingleFillGroup {
  kind: 'single';
  fill: LedgerEntry;
}

export type FillGroupItem = SpreadFillGroup | SingleFillGroup;

function fillToLegShape(fill: LedgerEntry): LegShape | null {
  const parsed = parseOccSymbol(fill.coin);
  if (!parsed) return null;
  const qty = parseFloat(fill.size);
  if (!isFinite(qty) || qty <= 0) return null;
  const signedQty = fill.side === 'buy' ? qty : -qty;
  return {
    type: parsed.type,
    strike: parsed.strike,
    expiration: parsed.expiration,
    signedQty,
  };
}

function netPremiumOfFills(fills: LedgerEntry[]): number {
  let sum = 0;
  for (const f of fills) {
    const size = parseFloat(f.size);
    const price = parseFloat(f.price);
    if (!isFinite(size) || !isFinite(price)) continue;
    const sign = f.side === 'sell' ? 1 : -1;
    sum += sign * size * price * 100;
  }
  return sum;
}

function realizedPnlOfFills(fills: LedgerEntry[]): number {
  let sum = 0;
  for (const f of fills) {
    const p = parseFloat(f.realizedPnl);
    if (isFinite(p)) sum += p;
  }
  return sum;
}

function isOptionLifecycle(kind: LedgerKind | undefined): kind is SpreadLifecycle {
  return kind === 'option-open' || kind === 'option-close' || kind === 'option-expire';
}

/**
 * Partition a day's fills into spread groups and single-fill rows. Option
 * fills sharing the same `spreadId` AND the same lifecycle `kind` collapse
 * into one `SpreadFillGroup` when there are 2+ legs. Single-leg option
 * "spreads" and all perp fills pass through as `SingleFillGroup`s so they
 * render as normal rows.
 *
 * Input order is preserved — the first group in the result is the one
 * containing the chronologically-first fill. Within a group, leg fills
 * retain the input order.
 */
export function groupFillsForDay(fills: LedgerEntry[]): FillGroupItem[] {
  // Bucket option fills by (spreadId, lifecycle). Non-option or spreadId-less
  // fills get their own 1-element buckets in input order.
  const buckets = new Map<string, LedgerEntry[]>();
  const order: string[] = [];

  for (const f of fills) {
    let key: string;
    if (isOptionLifecycle(f.kind) && f.spreadId) {
      key = `${f.spreadId}|${f.kind}`;
    } else {
      // Unique key per single fill.
      key = `single|${f.id}`;
    }
    const existing = buckets.get(key);
    if (existing) {
      existing.push(f);
    } else {
      buckets.set(key, [f]);
      order.push(key);
    }
  }

  const out: FillGroupItem[] = [];
  for (const key of order) {
    const group = buckets.get(key)!;
    if (key.startsWith('single|') || group.length < 2) {
      for (const f of group) out.push({ kind: 'single', fill: f });
      continue;
    }
    const first = group[0];
    const lifecycle = first.kind as SpreadLifecycle;
    const shapes: LegShape[] = [];
    for (const f of group) {
      const s = fillToLegShape(f);
      if (s) shapes.push(s);
    }
    const strategy = shapes.length === group.length
      ? classifyShapes(shapes)
      : `${group.length}-leg spread`;
    out.push({
      kind: 'spread',
      spreadId: first.spreadId!,
      lifecycle,
      fills: group,
      strategy,
      netPremium: netPremiumOfFills(group),
      realizedPnl: realizedPnlOfFills(group),
      firstTimestamp: first.timestamp,
    });
  }
  return out;
}

/**
 * Verb label for a spread group's lifecycle. Drives the summary row's
 * leading word ("Opened Call Vertical", "Closed Iron Condor", "Expired
 * Long Straddle").
 */
export function lifecycleVerb(lifecycle: SpreadLifecycle): string {
  if (lifecycle === 'option-open') return 'Opened';
  if (lifecycle === 'option-close') return 'Closed';
  return 'Expired';
}
