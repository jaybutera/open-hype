import type { Leg, LegSide, OptionContract } from './types.ts';

export const MAX_LEGS = 4;

export function legKey(contract: OptionContract, side: LegSide): string {
  return `${contract.symbol}:${side}`;
}

export function findLegIndex(legs: Leg[], contract: OptionContract, side: LegSide): number {
  const key = legKey(contract, side);
  return legs.findIndex((l) => legKey(l.contract, l.side) === key);
}

export function hasLeg(legs: Leg[], contract: OptionContract, side: LegSide): boolean {
  return findLegIndex(legs, contract, side) >= 0;
}

/**
 * Click-toggle semantics used by the chain grid:
 * - Same contract + same side already present → remove it
 * - Same contract but opposite side present → flip that leg's side (bid→ask click swaps)
 * - Otherwise → append a new leg (only if under MAX_LEGS cap)
 */
export function toggleLeg(legs: Leg[], contract: OptionContract, side: LegSide): Leg[] {
  const sameIdx = findLegIndex(legs, contract, side);
  if (sameIdx >= 0) {
    return legs.filter((_, i) => i !== sameIdx);
  }
  const oppositeSide: LegSide = side === 'buy' ? 'sell' : 'buy';
  const oppIdx = findLegIndex(legs, contract, oppositeSide);
  if (oppIdx >= 0) {
    const next = legs.slice();
    next[oppIdx] = { ...next[oppIdx], side };
    return next;
  }
  if (legs.length >= MAX_LEGS) return legs;
  return [...legs, { contract, side, qty: 1 }];
}
