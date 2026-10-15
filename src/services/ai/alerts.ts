/**
 * Price alerts: shared types and the pure rules. Used by the Vite alert engine
 * (alert-engine.ts), the page, and (as JSON) the MCP server.
 *
 * Two kinds:
 *   cross  - the mid trades at or past `level` in `direction` (first tick wins)
 *   close  - a bar on `interval` closes at or past `level` in `direction`
 * An alert fires once and then stays in the list as `fired` until removed.
 */
import type { HLineShape } from './types.ts';

export type AlertKind = 'cross' | 'close';
export type AlertDirection = 'above' | 'below';
export type AlertStatus = 'armed' | 'fired';
export type AlertSource = 'mcp' | 'ui';

export interface Alert {
  id: string;
  asset: string;
  kind: AlertKind;
  direction: AlertDirection;
  level: number;
  /** Candle interval; only for kind 'close'. */
  interval?: string;
  note?: string;
  source: AlertSource;
  createdAt: number;
  /** Mid when the alert was armed. New alerts always have one; null only on alerts stored before that rule. */
  refPrice: number | null;
  status: AlertStatus;
  firedAt?: number;
  firedPrice?: number;
  /** Open time (UTC ms) of the bar whose close fired a close alert. */
  firedBarT?: number;
}

export interface AlertInput {
  asset?: string;
  kind?: AlertKind;
  direction?: AlertDirection;
  level: number;
  interval?: string;
  note?: string;
  source?: AlertSource;
  /** Arm a cross alert even if the level is already past the mid (fires on the next tick). */
  force?: boolean;
}

export const ALERT_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M'];
export const MAX_NOTE = 300;

export class AlertValidationError extends Error {}

export interface AlertContext {
  id: string;
  /** Asset to use when the input has none (the charted asset). */
  defaultAsset: string | null;
  /** Current mid for the asset. Arming is refused when it is null. */
  mid: number | null;
  now?: number;
  source?: AlertSource;
}

/** Turn raw input into an armed alert, or throw AlertValidationError with a message the caller can show. */
export function validateAlert(raw: unknown, ctx: AlertContext): Alert {
  if (!raw || typeof raw !== 'object') throw new AlertValidationError('alert must be an object');
  const input = raw as Record<string, unknown>;

  const level = typeof input.level === 'number' ? input.level : Number(input.level);
  if (!Number.isFinite(level) || level <= 0) throw new AlertValidationError('level must be a positive number');

  const kind = input.kind === undefined ? 'cross' : input.kind;
  if (kind !== 'cross' && kind !== 'close') throw new AlertValidationError('kind must be "cross" or "close"');

  const assetRaw = typeof input.asset === 'string' && input.asset.trim() ? input.asset.trim() : ctx.defaultAsset;
  if (!assetRaw) throw new AlertValidationError('asset is required (no chart connected to default from)');
  const asset = assetRaw;

  const mid = ctx.mid;
  if (mid === null || !Number.isFinite(mid)) {
    throw new AlertValidationError(`no current price for ${asset}: could not fetch a mid, so the alert was not armed`);
  }

  let direction = input.direction;
  if (direction === undefined) direction = level > mid ? 'above' : 'below';
  if (direction !== 'above' && direction !== 'below') throw new AlertValidationError('direction must be "above" or "below"');

  let interval: string | undefined;
  if (kind === 'close') {
    if (typeof input.interval !== 'string' || !ALERT_INTERVALS.includes(input.interval)) {
      throw new AlertValidationError(`close alerts need interval, one of ${ALERT_INTERVALS.join(', ')}`);
    }
    interval = input.interval;
  }

  let note: string | undefined;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') throw new AlertValidationError('note must be a string');
    note = input.note.trim().slice(0, MAX_NOTE) || undefined;
  }

  const alert: Alert = {
    id: ctx.id,
    asset,
    kind,
    direction,
    level,
    interval,
    note,
    source: (input.source === 'ui' || input.source === 'mcp') ? input.source : (ctx.source ?? 'mcp'),
    createdAt: ctx.now ?? Date.now(),
    refPrice: mid,
    status: 'armed',
  };

  if (kind === 'cross' && !input.force && crossSatisfied(alert, mid)) {
    const other = direction === 'above' ? 'below' : 'above';
    throw new AlertValidationError(
      `level ${level} is already ${direction} the mid ${mid}: nothing to wait for. ` +
      `Use direction "${other}", or force: true to fire on the next tick.`,
    );
  }
  return alert;
}

export function crossSatisfied(a: Pick<Alert, 'direction' | 'level'>, price: number): boolean {
  return a.direction === 'above' ? price >= a.level : price <= a.level;
}

export function closeSatisfied(a: Pick<Alert, 'direction' | 'level'>, close: number): boolean {
  return crossSatisfied(a, close);
}

/** True when two alerts would fire on the same condition. */
export function sameCondition(a: Alert, b: Alert): boolean {
  return a.asset === b.asset && a.kind === b.kind && a.direction === b.direction
    && a.level === b.level && (a.interval ?? '') === (b.interval ?? '');
}

export function describeAlert(a: Alert): string {
  const arrow = a.direction === 'above' ? '↑' : '↓';
  const what = a.kind === 'close' ? `${a.interval} close` : 'cross';
  return `${a.asset} ${what} ${arrow} ${a.level}`;
}

/** Dashed line the chart draws for an armed alert. */
export function alertLine(a: Alert): HLineShape {
  return {
    type: 'hline',
    price: a.level,
    text: `⏰ ${a.kind === 'close' ? `${a.interval} close ` : ''}${a.direction === 'above' ? '↑' : '↓'} ${a.level}`,
    color: a.status === 'fired' ? '#f6465d' : '#f0b90b',
    style: 'dashed',
  };
}
