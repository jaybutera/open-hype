import Decimal from 'decimal.js';

/** Perp prices may carry at most MAX_DECIMALS - szDecimals decimal places. */
const PERP_MAX_DECIMALS = 6;
const MAX_SIG_FIGS = 5;

/** Canonical wire form: plain decimal, no exponent, no trailing zeros, no "-0". */
export function toWire(x: Decimal.Value): string {
  const d = new Decimal(x);
  if (!d.isFinite()) throw new Error(`Not a finite number: ${x}`);
  const s = d.toFixed();
  const trimmed = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return trimmed === '-0' ? '0' : trimmed;
}

/**
 * Round a perp price to what the exchange accepts: 5 significant figures,
 * at most (6 - szDecimals) decimals; integers are always valid.
 */
export function formatPrice(px: Decimal.Value, szDecimals: number): string {
  const d = new Decimal(px);
  if (!d.isFinite() || d.lte(0)) throw new Error(`Invalid price: ${px}`);
  const maxDecimals = Math.max(0, PERP_MAX_DECIMALS - szDecimals);
  const rounded = d.abs().gte(10 ** MAX_SIG_FIGS)
    ? d.toDecimalPlaces(0)
    : d.toSignificantDigits(MAX_SIG_FIGS).toDecimalPlaces(maxDecimals);
  return toWire(rounded);
}

/** Round a size down to the asset's lot (szDecimals) so it never exceeds what was asked. */
export function formatSize(sz: Decimal.Value, szDecimals: number): string {
  const d = new Decimal(sz);
  if (!d.isFinite() || d.lte(0)) throw new Error(`Invalid size: ${sz}`);
  return toWire(d.toDecimalPlaces(szDecimals, Decimal.ROUND_DOWN));
}
