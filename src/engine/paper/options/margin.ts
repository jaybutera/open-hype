import Decimal from 'decimal.js';
import { CONTRACT_MULTIPLIER } from './OptionPosition.ts';

/**
 * Conservative short-premium multiplier for cash-margin reservation.
 * Not CBOE-correct. Documented simplification per options-paper.md:
 * short-leg margin reserved = premium × 100 × qty × SHORT_PREMIUM_MARGIN_MULT.
 */
export const SHORT_PREMIUM_MARGIN_MULT = 5;

/**
 * Per-leg cash impact at open. For long legs: positive debit (premium paid).
 * For short legs: negative value (premium received — balance INCREASES).
 *
 * szi sign encodes side: positive = long (debit), negative = short (credit).
 */
export function legCashDelta(szi: Decimal, entryPx: Decimal): Decimal {
  return szi.mul(entryPx).mul(CONTRACT_MULTIPLIER);
}

/**
 * Cash margin that must be reserved against a leg.
 * - Long leg: 0 — the premium itself is the only capital at risk and has
 *   already been debited.
 * - Short leg: premium × 100 × qty × SHORT_PREMIUM_MARGIN_MULT. This is a
 *   crude cash-secured reservation, not CBOE margin.
 */
export function legMarginRequired(szi: Decimal, entryPx: Decimal): Decimal {
  if (szi.gte(0)) return new Decimal(0);
  const qty = szi.abs();
  return entryPx.mul(CONTRACT_MULTIPLIER).mul(qty).mul(SHORT_PREMIUM_MARGIN_MULT);
}

/** One leg as evaluated for a pending open: side-signed size and entry price. */
export interface MarginLegInput {
  szi: Decimal;
  entryPx: Decimal;
}

export interface OpenLegsCost {
  /**
   * Net debit across all legs (sum of legCashDelta). Positive = cash leaves
   * the account, negative = cash received (net credit spread).
   */
  netDebit: Decimal;
  /** Sum of margin reservations across all short legs. */
  totalMargin: Decimal;
  /**
   * Total cash that must be available to open: netDebit + totalMargin.
   * For a net-debit spread with no shorts: equal to netDebit.
   * For a net-credit spread: credit offsets, remainder is the short margin.
   */
  cashRequired: Decimal;
}

/**
 * Aggregate the cash-required, net-debit, and short-margin totals for a
 * set of legs being opened atomically.
 */
export function computeOpenLegsCost(legs: MarginLegInput[]): OpenLegsCost {
  let netDebit = new Decimal(0);
  let totalMargin = new Decimal(0);
  for (const leg of legs) {
    netDebit = netDebit.add(legCashDelta(leg.szi, leg.entryPx));
    totalMargin = totalMargin.add(legMarginRequired(leg.szi, leg.entryPx));
  }
  return {
    netDebit,
    totalMargin,
    cashRequired: netDebit.add(totalMargin),
  };
}
