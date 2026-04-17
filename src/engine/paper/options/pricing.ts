import type { OptionContract, LegSide } from '../../../services/options/types.ts';

/**
 * Fill-model choice for paper-opening a leg. `mid` = average of bid/ask.
 * `cross` = pay the ask when buying, hit the bid when selling (conservative).
 */
export type FillModel = 'mid' | 'cross';

export interface FillPriceResult {
  /** Resolved per-share fill price. 0 if no quote is usable. */
  price: number;
  /** True when bid and ask are both > 0 and the chosen side was tradeable. */
  reliable: boolean;
}

/**
 * Per-share fill price for a leg under a given fill model.
 *
 * Mid: average of bid/ask; if one side is 0, fall through to whichever
 * side is populated, then `last`. Returns 0 if nothing usable.
 *
 * Cross: buyers pay ask, sellers hit bid. If the required side is 0
 * (cannot cross), fall back to the mid price so the order form never
 * has to reject on fill-model grounds alone.
 */
export function legFillPrice(
  contract: OptionContract,
  side: LegSide,
  model: FillModel,
): FillPriceResult {
  const { bid, ask, last } = contract;

  if (model === 'cross') {
    if (side === 'buy' && ask > 0) return { price: ask, reliable: bid > 0 };
    if (side === 'sell' && bid > 0) return { price: bid, reliable: ask > 0 };
    // fall through to mid
  }

  if (bid > 0 && ask > 0) return { price: (bid + ask) / 2, reliable: true };
  if (bid > 0) return { price: bid, reliable: false };
  if (ask > 0) return { price: ask, reliable: false };
  if (last > 0) return { price: last, reliable: false };
  return { price: 0, reliable: false };
}
