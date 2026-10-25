import { useLiveAccountStore } from '../../store/useLiveAccountStore.ts';
import type { Side } from '../../types/order.ts';

/** Headroom on live margin so fees and slippage at the fill do not leave the order a few dollars short. */
export const LIVE_MARGIN_BUFFER = 1.02;

export type LeverageFit =
  | { ok: true; leverage: number; bumped: boolean }
  | { ok: false; error: string };

/**
 * Leverage that lets `notional` fit in `available` margin. Only ever raises
 * `leverage`, never past `cap`; when even `cap` is not enough it returns the
 * error the order panel shows. With no known margin (`available` <= 0) it
 * leaves leverage alone and lets the exchange decide.
 */
export function fitLeverage(o: {
  coin: string; notional: number; available: number; leverage: number; cap: number; buffer?: number;
}): LeverageFit {
  const { coin, notional, available, leverage, cap } = o;
  const need = notional * (o.buffer ?? 1);
  if (!(available > 0) || need / leverage <= available) return { ok: true, leverage, bumped: false };
  const neededLev = Math.ceil(need / available);
  if (neededLev > cap) {
    return {
      ok: false,
      error:
        `Position too large: notional $${notional.toFixed(0)} needs ${neededLev}x ` +
        `but ${coin} caps at ${cap}x (margin $${(need / cap).toFixed(2)} > available $${available.toFixed(2)}). ` +
        `Widen the stop or lower risk.`,
    };
  }
  const lev = Math.max(leverage, neededLev);
  return { ok: true, leverage: lev, bumped: lev !== leverage };
}

/**
 * Fit a new live opening order into the account's free margin. Free margin is
 * the store's `withdrawable` (spot USDC available after maintenance on unified
 * accounts, perp withdrawable plus free spot USDC otherwise). A same-coin
 * position's margin is already out of `withdrawable`, and a cross leverage
 * change applies to the whole position, so the check runs on the position after
 * the fill against free margin plus that position's margin.
 */
export function fitLiveLeverage(o: {
  coin: string; side: Side; size: number; price: number; leverage: number; cap: number;
}): LeverageFit & { notional: number; available: number } {
  const { withdrawable, positions } = useLiveAccountStore.getState();
  const pos = positions.find(p => p.coin === o.coin);
  const orderNotional = o.size * o.price;
  const signed = (o.side === 'buy' ? 1 : -1) * orderNotional;
  const posNotional = pos ? Math.sign(pos.szi) * Math.abs(pos.positionValue) : 0;
  const notional = Math.abs(posNotional + signed);
  const available = withdrawable > 0 ? withdrawable + (pos?.marginUsed ?? 0) : 0;
  const fit = fitLeverage({ coin: o.coin, notional, available, leverage: o.leverage, cap: o.cap, buffer: LIVE_MARGIN_BUFFER });
  return { ...fit, notional, available };
}
