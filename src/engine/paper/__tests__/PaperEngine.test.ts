import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaperEngine } from '../PaperEngine.ts';
import type { PaperOrder } from '../matching.ts';

let engine: PaperEngine;

beforeEach(() => {
  engine = new PaperEngine({ initialBalance: '10000', leverage: 10 });
});

// ── Helpers ──────────────────────────────────────────────────────────

function placeLimitBuy(coin: string, price: string, size: string, opts?: { reduceOnly?: boolean }) {
  return engine.placeOrder({
    coin, side: 'buy', price, size,
    reduceOnly: opts?.reduceOnly ?? false,
    orderType: { limit: { tif: 'Gtc' } },
  });
}

function placeLimitSell(coin: string, price: string, size: string, opts?: { reduceOnly?: boolean }) {
  return engine.placeOrder({
    coin, side: 'sell', price, size,
    reduceOnly: opts?.reduceOnly ?? false,
    orderType: { limit: { tif: 'Gtc' } },
  });
}

function placeTP(coin: string, side: 'buy' | 'sell', price: string, size: string, reduceOnly = false) {
  return engine.placeOrder({
    coin, side, price, size, reduceOnly,
    orderType: { trigger: { isMarket: true, triggerPx: price, tpsl: 'tp' } },
  });
}

function placeSL(coin: string, side: 'buy' | 'sell', price: string, size: string, reduceOnly = false) {
  return engine.placeOrder({
    coin, side, price, size, reduceOnly,
    orderType: { trigger: { isMarket: true, triggerPx: price, tpsl: 'sl' } },
  });
}

/** Place and immediately fill a long position */
function openLong(coin: string, price: string, size: string) {
  placeLimitBuy(coin, price, size);
  engine.onPriceUpdate(coin, price);
}

/** Place and immediately fill a short position */
function openShort(coin: string, price: string, size: string) {
  placeLimitSell(coin, price, size);
  engine.onPriceUpdate(coin, price);
}

// ── Order placement ──────────────────────────────────────────────────

describe('placeOrder', () => {
  it('rejects zero/negative size and price', () => {
    expect(placeLimitBuy('BTC', '50000', '0').success).toBe(false);
    expect(placeLimitBuy('BTC', '0', '1').success).toBe(false);
  });

  it('accepts placement regardless of margin (checked at fill)', () => {
    // 100 BTC × 50000 / 10 = 500k margin > 10k balance — placement still succeeds
    expect(placeLimitBuy('BTC', '50000', '100').success).toBe(true);
  });

  it('rejects reduceOnly sell when no position', () => {
    expect(placeLimitSell('BTC', '50000', '1', { reduceOnly: true }).success).toBe(false);
  });

  it('rejects reduceOnly in wrong direction', () => {
    openLong('BTC', '50000', '0.1');
    // Can't reduceOnly buy when long
    expect(placeLimitBuy('BTC', '48000', '0.1', { reduceOnly: true }).success).toBe(false);
  });
});

// ── Limit fill basics ────────────────────────────────────────────────

describe('limit order fills', () => {
  it('buy fills when price drops to limit', () => {
    placeLimitBuy('BTC', '50000', '0.1');

    engine.onPriceUpdate('BTC', '51000');
    expect(engine.getPositions()).toHaveLength(0);

    engine.onPriceUpdate('BTC', '50000');
    expect(engine.getPositions()).toHaveLength(1);
    expect(engine.getPosition('BTC')!.szi.toString()).toBe('0.1');
    expect(engine.getOpenOrders()).toHaveLength(0);
    expect(engine.getFills()).toHaveLength(1);
  });

  it('sell fills when price rises to limit', () => {
    placeLimitSell('BTC', '50000', '0.1');

    engine.onPriceUpdate('BTC', '49000');
    expect(engine.getPositions()).toHaveLength(0);

    engine.onPriceUpdate('BTC', '50000');
    const pos = engine.getPosition('BTC')!;
    expect(pos.szi.toString()).toBe('-0.1');
  });

  it('manages independent positions per asset', () => {
    placeLimitBuy('BTC', '50000', '0.1');
    placeLimitSell('ETH', '3000', '1');

    engine.onPriceUpdate('BTC', '50000');
    engine.onPriceUpdate('ETH', '3000');

    expect(engine.getPositions()).toHaveLength(2);
    expect(engine.getPosition('BTC')!.szi.toString()).toBe('0.1');
    expect(engine.getPosition('ETH')!.szi.toString()).toBe('-1');
  });
});

// ── Margin check at fill time ────────────────────────────────────────

describe('margin check at fill time', () => {
  it('rejects fill when margin is insufficient and fires callback', () => {
    const rejections: string[] = [];
    engine = new PaperEngine({
      initialBalance: '10000',
      leverage: 10,
      onRejection: (reason) => rejections.push(reason),
    });

    // 100 BTC × 50000 / 10 = 500k margin — way over 10k balance
    placeLimitBuy('BTC', '50000', '100');
    engine.onPriceUpdate('BTC', '50000');

    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toContain('Insufficient margin');
    expect(rejections[0]).toContain('500000');
  });

  it('fills when margin is sufficient', () => {
    // 0.1 BTC × 50000 / 10 = 500 margin, well within 10k
    placeLimitBuy('BTC', '50000', '0.1');
    engine.onPriceUpdate('BTC', '50000');
    expect(engine.getPositions()).toHaveLength(1);
  });

  it('rejects when existing positions consume available margin', () => {
    const rejections: string[] = [];
    engine = new PaperEngine({
      initialBalance: '10000',
      leverage: 10,
      onRejection: (reason) => rejections.push(reason),
    });

    // First position: 1 BTC × 50000 / 10 = 5000 margin → 5000 available
    openLong('BTC', '50000', '1');

    // Second: 1 ETH × 4000 / 10 = 400 margin → still fits
    openLong('ETH', '4000', '1');

    // Third: 1 SOL × 50000 / 10 = 5000 margin → only ~4600 available
    placeLimitBuy('SOL', '50000', '1');
    engine.onPriceUpdate('SOL', '50000');

    expect(engine.getPosition('SOL')).toBeNull();
    expect(rejections).toHaveLength(1);
  });
});

// ── TP/SL fill behavior ─────────────────────────────────────────────

describe('TP/SL triggers', () => {
  it('long TP fills on price rise, cancels SL', () => {
    openLong('BTC', '50000', '1');
    placeTP('BTC', 'sell', '55000', '1', true);
    placeSL('BTC', 'sell', '48000', '1', true);

    engine.onPriceUpdate('BTC', '55000');
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);

    const balance = parseFloat(engine.getBalance());
    expect(balance).toBeGreaterThan(14000);
  });

  it('long SL fills on price drop', () => {
    openLong('BTC', '50000', '1');
    placeSL('BTC', 'sell', '48000', '1', true);

    engine.onPriceUpdate('BTC', '48000');
    expect(engine.getPositions()).toHaveLength(0);

    const balance = parseFloat(engine.getBalance());
    expect(balance).toBeLessThan(8100);
  });

  it('short TP fills on price drop, cancels SL', () => {
    openShort('BTC', '50000', '1');
    placeTP('BTC', 'buy', '45000', '1', true);
    placeSL('BTC', 'buy', '52000', '1', true);

    engine.onPriceUpdate('BTC', '44000');
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('does not cancel non-reduceOnly orders when position closes', () => {
    openLong('BTC', '50000', '1');
    placeTP('BTC', 'sell', '55000', '1', true);
    placeLimitBuy('BTC', '45000', '0.5'); // separate entry order

    engine.onPriceUpdate('BTC', '56000');

    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(1);
    expect(engine.getOpenOrders()[0].reduceOnly).toBe(false);
  });
});

// ── TP/SL without position (the fix) ────────────────────────────────

describe('TP/SL without existing position', () => {
  it('non-reduceOnly TP is removed if no position exists when triggered', () => {
    // This is what trade setup does: TP placed before entry fills
    placeTP('BTC', 'sell', '55000', '1', false);

    engine.onPriceUpdate('BTC', '56000');

    // Should NOT create a short position
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('non-reduceOnly SL is removed if no position exists when triggered', () => {
    placeSL('BTC', 'sell', '48000', '1', false);

    engine.onPriceUpdate('BTC', '47000');

    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('TP/SL rejected if position is in wrong direction', () => {
    openShort('BTC', '50000', '1');

    // Sell TP against a short — wrong direction (should close a long, not a short)
    // Sell TP triggers when midPrice >= triggerPx
    placeTP('BTC', 'sell', '48000', '1', false);

    engine.onPriceUpdate('BTC', '48000');

    // Short should remain, TP should be gone without opening a second position
    expect(engine.getPositions()).toHaveLength(1);
    expect(engine.getPosition('BTC')!.szi.isNeg()).toBe(true);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });
});

// ── Trade setup end-to-end (entry + TP + SL) ────────────────────────

describe('trade setup: entry + TP + SL end-to-end', () => {
  it('long setup: entry fills, TP closes with profit', () => {
    // Simulate handleExecuteSetup: place entry + TP + SL
    placeLimitBuy('BTC', '50000', '0.01');
    placeTP('BTC', 'sell', '54000', '0.01', false);
    placeSL('BTC', 'sell', '48000', '0.01', false);
    expect(engine.getOpenOrders()).toHaveLength(3);

    // Price drops to entry → fills
    engine.onPriceUpdate('BTC', '50000');
    expect(engine.getPositions()).toHaveLength(1);
    expect(engine.getOpenOrders()).toHaveLength(2); // TP + SL remain

    // Price rises to TP
    engine.onPriceUpdate('BTC', '54000');
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);

    const balance = parseFloat(engine.getBalance());
    expect(balance).toBeGreaterThan(10030); // ~40 profit minus fees
  });

  it('long setup: entry fills, SL closes with loss', () => {
    placeLimitBuy('BTC', '50000', '0.01');
    placeTP('BTC', 'sell', '54000', '0.01', false);
    placeSL('BTC', 'sell', '48000', '0.01', false);

    engine.onPriceUpdate('BTC', '50000');
    engine.onPriceUpdate('BTC', '48000');

    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('short setup: entry fills, TP closes', () => {
    placeLimitSell('BTC', '50000', '0.01');
    placeTP('BTC', 'buy', '46000', '0.01', false);
    placeSL('BTC', 'buy', '52000', '0.01', false);

    engine.onPriceUpdate('BTC', '50000'); // entry fills
    engine.onPriceUpdate('BTC', '45000'); // TP triggers

    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('risk-based sizing: rejects entry when size exceeds margin', () => {
    const rejections: string[] = [];
    engine = new PaperEngine({
      initialBalance: '10000',
      leverage: 10,
      onRejection: (reason) => rejections.push(reason),
    });

    // Simulate risk sizing: $50 risk, $1 stop distance → 50 units
    // 50 BTC × 50000 / 10 = 250k margin >> 10k balance
    const riskUsdc = 50;
    const entryPrice = 50000;
    const slPrice = 49999;
    const riskPerUnit = Math.abs(entryPrice - slPrice); // 1
    const assetSize = (riskUsdc / riskPerUnit).toString(); // '50'

    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: entryPrice.toString(), size: assetSize,
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    placeTP('BTC', 'sell', '50100', assetSize, false);
    placeSL('BTC', 'sell', slPrice.toString(), assetSize, false);

    expect(engine.getOpenOrders()).toHaveLength(3); // all placed

    engine.onPriceUpdate('BTC', entryPrice.toString());

    // Entry rejected at fill time — no position created
    expect(engine.getPositions()).toHaveLength(0);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toContain('Insufficient margin');

    // TP/SL remain as orphans (no position to trigger against)
    // They'll be harmlessly removed when triggered with no position
  });

  it('risk-based sizing: fills when size fits within margin', () => {
    // $100 risk, $2000 stop distance → 0.05 BTC
    // 0.05 × 50000 / 10 = 250 margin — fits in 10k
    const riskUsdc = 100;
    const entryPrice = 50000;
    const slPrice = 48000;
    const riskPerUnit = Math.abs(entryPrice - slPrice);
    const assetSize = (riskUsdc / riskPerUnit).toString();

    placeLimitBuy('BTC', entryPrice.toString(), assetSize);
    placeTP('BTC', 'sell', '54000', assetSize, false);
    placeSL('BTC', 'sell', slPrice.toString(), assetSize, false);

    engine.onPriceUpdate('BTC', entryPrice.toString());
    expect(engine.getPositions()).toHaveLength(1);

    engine.onPriceUpdate('BTC', '54000');
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('tight margin: entry fills, TP closes (realistic gold setup)', () => {
    engine = new PaperEngine({ initialBalance: '1000', leverage: 20 });

    // 6 gold × 3300 / 20 = 990 margin, just within 1000
    placeLimitBuy('GOLD', '3300', '6');
    placeTP('GOLD', 'sell', '3400', '6', false);
    placeSL('GOLD', 'sell', '3250', '6', false);

    engine.onPriceUpdate('GOLD', '3300');
    expect(engine.getPositions()).toHaveLength(1);
    expect(engine.getOpenOrders()).toHaveLength(2);

    engine.onPriceUpdate('GOLD', '3400');
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });
});

// ── Cancel and drag ──────────────────────────────────────────────────

describe('cancel and order drag', () => {
  it('cancels an existing order', () => {
    const r = placeLimitBuy('BTC', '50000', '0.1');
    expect(engine.cancelOrder(r.oid!)).toBe(true);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('cancelAllOrders scoped to coin', () => {
    placeLimitBuy('BTC', '50000', '0.1');
    placeLimitBuy('ETH', '3000', '1');
    engine.cancelAllOrders('BTC');
    expect(engine.getOpenOrders()).toHaveLength(1);
    expect(engine.getOpenOrders()[0].coin).toBe('ETH');
  });

  it('drag: cancel and re-place TP at new price', () => {
    openLong('BTC', '50000', '1');
    const r = placeTP('BTC', 'sell', '55000', '1', true);

    engine.cancelOrder(r.oid!);
    placeTP('BTC', 'sell', '56000', '1', true);

    // Old price doesn't trigger
    engine.onPriceUpdate('BTC', '55500');
    expect(engine.getPositions()).toHaveLength(1);

    // New price triggers
    engine.onPriceUpdate('BTC', '56000');
    expect(engine.getPositions()).toHaveLength(0);
  });
});

// ── Market close ─────────────────────────────────────────────────────

describe('marketClose', () => {
  it('closes position and cancels TP/SL', () => {
    openLong('BTC', '50000', '0.1');
    placeTP('BTC', 'sell', '55000', '0.1', true);
    placeSL('BTC', 'sell', '48000', '0.1', true);

    engine.marketClose('BTC', '51000');
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);

    const balance = parseFloat(engine.getBalance());
    expect(balance).toBeGreaterThan(10090);
  });

  it('returns error when no position exists', () => {
    expect(engine.marketClose('BTC', '50000').success).toBe(false);
  });
});

// ── Balance tracking ─────────────────────────────────────────────────

describe('balance tracking', () => {
  it('accumulates PnL across multiple trades', () => {
    // Trade 1: long 0.1 BTC at 50k, close at 51k → +100
    openLong('BTC', '50000', '0.1');
    placeLimitSell('BTC', '51000', '0.1', { reduceOnly: true });
    engine.onPriceUpdate('BTC', '51000');

    // Trade 2: short 0.1 BTC at 51k, close at 50.5k → +50
    openShort('BTC', '51000', '0.1');
    placeLimitBuy('BTC', '50500', '0.1', { reduceOnly: true });
    engine.onPriceUpdate('BTC', '50500');

    expect(engine.getFills()).toHaveLength(4);
    const balance = parseFloat(engine.getBalance());
    // ~150 profit minus maker fees
    expect(balance).toBeGreaterThan(10120);
    expect(balance).toBeLessThan(10150);
  });
});

// ── Candle-based trigger fills ───────────────────────────────────────

describe('candle-based trigger fills', () => {
  it('SL triggers from candle wick even if mid price does not cross', () => {
    openLong('BTC', '50000', '1');
    placeSL('BTC', 'sell', '48000', '1', true);

    // Mid stays above SL, but candle low wicks below
    engine.onCandleUpdate('BTC', '51000', '47500');
    expect(engine.getPositions()).toHaveLength(0);
  });

  it('TP triggers from candle wick', () => {
    openShort('BTC', '50000', '1');
    placeTP('BTC', 'buy', '45000', '1', true);

    // Candle low wicks to 44000 but mid is 46000
    engine.onCandleUpdate('BTC', '50000', '44000');
    expect(engine.getPositions()).toHaveLength(0);
  });

  it('ignores candle updates for limit orders', () => {
    placeLimitBuy('BTC', '48000', '0.1');
    engine.onCandleUpdate('BTC', '50000', '47000');
    // Limit orders are not matched by candle updates
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(1);
  });
});

// ── State persistence (rehydration) ─────────────────────────────────

describe('state persistence', () => {
  it('TP still triggers after JSON round-trip', () => {
    openLong('BTC', '50000', '1');
    placeTP('BTC', 'sell', '55000', '1', true);
    placeSL('BTC', 'sell', '48000', '1', true);

    const serialized = JSON.parse(JSON.stringify(engine.getState()));
    const engine2 = new PaperEngine({ initialBalance: '10000', leverage: 10 });
    engine2.loadState(serialized);

    engine2.onPriceUpdate('BTC', '56000');
    expect(engine2.getPositions()).toHaveLength(0);
    expect(engine2.getOpenOrders()).toHaveLength(0);
  });
});

// ── onUpdate callback ────────────────────────────────────────────────

describe('onUpdate callback', () => {
  it('emits clean state after TP closes position', () => {
    const states: ReturnType<PaperEngine['getState']>[] = [];
    engine = new PaperEngine({
      initialBalance: '10000', leverage: 10,
      onUpdate: (state) => states.push(state),
    });

    openLong('BTC', '50000', '1');
    placeTP('BTC', 'sell', '55000', '1', true);
    placeSL('BTC', 'sell', '48000', '1', true);
    states.length = 0;

    engine.onPriceUpdate('BTC', '56000');

    const last = states[states.length - 1];
    expect(last.positions).toHaveLength(0);
    expect(last.openOrders).toHaveLength(0);
  });
});
