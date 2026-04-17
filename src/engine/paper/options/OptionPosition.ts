import Decimal from 'decimal.js';
import type { OptionType } from '../../../services/options/types.ts';

export const CONTRACT_MULTIPLIER = 100;

/**
 * One open option leg. Multi-leg spreads share a spreadId; a single-leg
 * position also gets a spreadId so all options can be indexed uniformly.
 *
 * szi is signed: positive = long (bought), negative = short (sold/written).
 * entryPx is the per-share option premium paid (long) or received (short).
 */
export interface OptionPosition {
  id: string;
  spreadId: string;
  contractSymbol: string;
  underlying: string;
  type: OptionType;
  strike: Decimal;
  expiration: number;
  szi: Decimal;
  entryPx: Decimal;
  marginUsed: Decimal;
  openedAt: number;
}

export interface OptionPositionJSON {
  id: string;
  spreadId: string;
  contractSymbol: string;
  underlying: string;
  type: OptionType;
  strike: string;
  expiration: number;
  szi: string;
  entryPx: string;
  marginUsed: string;
  openedAt: number;
}

export function serializeOptionPosition(p: OptionPosition): OptionPositionJSON {
  return {
    id: p.id,
    spreadId: p.spreadId,
    contractSymbol: p.contractSymbol,
    underlying: p.underlying,
    type: p.type,
    strike: p.strike.toString(),
    expiration: p.expiration,
    szi: p.szi.toString(),
    entryPx: p.entryPx.toString(),
    marginUsed: p.marginUsed.toString(),
    openedAt: p.openedAt,
  };
}

export function deserializeOptionPosition(raw: OptionPositionJSON): OptionPosition {
  return {
    id: raw.id,
    spreadId: raw.spreadId,
    contractSymbol: raw.contractSymbol,
    underlying: raw.underlying,
    type: raw.type,
    strike: new Decimal(raw.strike),
    expiration: raw.expiration,
    szi: new Decimal(raw.szi),
    entryPx: new Decimal(raw.entryPx),
    marginUsed: new Decimal(raw.marginUsed),
    openedAt: raw.openedAt,
  };
}

/**
 * Notional cash value of a single option leg at a given per-share mark.
 * Positive for long legs at positive mark, negative for short legs.
 */
export function legNotional(p: OptionPosition, mark: Decimal): Decimal {
  return p.szi.mul(mark).mul(CONTRACT_MULTIPLIER);
}

/**
 * Cost basis for the leg — positive cash outflow for long entries, negative
 * (i.e. cash received) for short entries.
 */
export function legCostBasis(p: OptionPosition): Decimal {
  return p.szi.mul(p.entryPx).mul(CONTRACT_MULTIPLIER);
}

/**
 * Unrealized PnL for a leg at a given per-share mark. Long: mark - entry;
 * short: entry - mark. Multiplied by qty * 100.
 */
export function legUnrealizedPnl(p: OptionPosition, mark: Decimal): Decimal {
  return p.szi.mul(mark.sub(p.entryPx)).mul(CONTRACT_MULTIPLIER);
}

/**
 * Group an array of option positions by spreadId. Useful for the positions
 * view which renders one row per spread with expand-to-see-legs.
 */
export function groupBySpread(positions: OptionPosition[]): Map<string, OptionPosition[]> {
  const groups = new Map<string, OptionPosition[]>();
  for (const p of positions) {
    const existing = groups.get(p.spreadId);
    if (existing) existing.push(p);
    else groups.set(p.spreadId, [p]);
  }
  return groups;
}
