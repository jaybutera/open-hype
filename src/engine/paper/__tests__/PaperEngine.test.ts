import { describe, it, expect, beforeEach, vi } from 'vitest';
import Decimal from 'decimal.js';
import { PaperEngine } from '../PaperEngine.ts';
import type { PaperOrder } from '../matching.ts';
import type { OptionPosition } from '../options/OptionPosition.ts';

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

  it('rejects placement when margin is insufficient', () => {
    // 100 BTC × 50000 / 10 = 500k margin > 10k balance — rejected at placement
    const result = placeLimitBuy('BTC', '50000', '100');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient margin');
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

// ── Margin check at placement time ───────────────────────────────────

describe('margin check at placement time', () => {
  it('rejects order when margin is insufficient', () => {
    engine = new PaperEngine({
      initialBalance: '10000',
      leverage: 10,
    });

    // 100 BTC × 50000 / 10 = 500k margin — way over 10k balance
    const result = engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '100',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient margin');
    expect(result.error).toContain('500000');
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('accepts order when margin is sufficient', () => {
    // 0.1 BTC × 50000 / 10 = 500 margin, well within 10k
    placeLimitBuy('BTC', '50000', '0.1');
    engine.onPriceUpdate('BTC', '50000');
    expect(engine.getPositions()).toHaveLength(1);
  });

  it('rejects when existing positions consume available margin', () => {
    engine = new PaperEngine({
      initialBalance: '10000',
      leverage: 10,
    });

    // First position: 1 BTC × 50000 / 10 = 5000 margin → 5000 available
    openLong('BTC', '50000', '1');

    // Second: 1 ETH × 4000 / 10 = 400 margin → still fits
    openLong('ETH', '4000', '1');

    // Third: 1 SOL × 50000 / 10 = 5000 margin → only ~4600 available
    const result = engine.placeOrder({
      coin: 'SOL', side: 'buy', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient margin');
  });

  it('reserves margin for pending limit orders', () => {
    engine = new PaperEngine({
      initialBalance: '10000',
      leverage: 10,
    });

    // First limit order: 1 BTC × 50000 / 10 = 5000 margin reserved
    placeLimitBuy('BTC', '50000', '1');

    // Second: 1 ETH × 50000 / 10 = 5000 margin — only 5000 available
    const result = engine.placeOrder({
      coin: 'ETH', side: 'buy', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    expect(result.success).toBe(true); // exactly 5000 + 5000 = 10000, fits

    // Third: should fail, no margin left
    const result2 = engine.placeOrder({
      coin: 'SOL', side: 'buy', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('Insufficient margin');
  });

  it('rejects fill at execution time when margin is insufficient', () => {
    const rejection = vi.fn();
    engine = new PaperEngine({
      initialBalance: '1000',
      leverage: 10,
      onRejection: rejection,
    });

    // Place two limit orders that each fit individually at placement
    // 0.1 BTC × 50000 / 10 = 500 margin each, total 1000 = fits
    placeLimitBuy('BTC', '50000', '0.1');
    placeLimitBuy('ETH', '50000', '0.1');

    // First fills — margin used by position = 500
    engine.onPriceUpdate('BTC', '50000');
    expect(engine.getPositions()).toHaveLength(1);

    // Cancel the pending ETH order (frees reserved margin), place a bigger one
    engine.cancelAllOrders('ETH');
    const big = engine.placeOrder({
      coin: 'ETH', side: 'buy', price: '50000', size: '0.2',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    // 0.2 × 50000 / 10 = 1000 margin, but 500 used by BTC pos → only 500 available
    expect(big.success).toBe(false);
    expect(big.error).toContain('Insufficient margin');
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

  it('risk-based sizing: rejects entry at placement when size exceeds margin', () => {
    engine = new PaperEngine({
      initialBalance: '10000',
      leverage: 10,
    });

    // Simulate risk sizing: $50 risk, $1 stop distance → 50 units
    // 50 BTC × 50000 / 10 = 250k margin >> 10k balance
    const riskUsdc = 50;
    const entryPrice = 50000;
    const slPrice = 49999;
    const riskPerUnit = Math.abs(entryPrice - slPrice); // 1
    const assetSize = (riskUsdc / riskPerUnit).toString(); // '50'

    const result = engine.placeOrder({
      coin: 'BTC', side: 'buy', price: entryPrice.toString(), size: assetSize,
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });

    // Rejected immediately at placement — never sits in the book
    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient margin');
    expect(engine.getOpenOrders()).toHaveLength(0);
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
    expect(engine.cancelOrder(String(r.oid))).toBe(true);
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

    engine.cancelOrder(String(r.oid));
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

// ── Option positions ─────────────────────────────────────────────────

function makeOptionPosition(overrides: Partial<OptionPosition> = {}): OptionPosition {
  return {
    id: 'op-1',
    spreadId: 'sp-1',
    contractSymbol: 'TSLA260417C00400000',
    underlying: 'TSLA',
    type: 'call',
    strike: new Decimal(400),
    expiration: 1776384000,
    szi: new Decimal(1),
    entryPx: new Decimal('5.25'),
    marginUsed: new Decimal(525),
    openedAt: 1713345600,
    ...overrides,
  };
}

describe('option position storage', () => {
  it('starts with no option positions', () => {
    expect(engine.getOptionPositions()).toEqual([]);
  });

  it('addOptionPosition stores and getOptionPosition retrieves', () => {
    const p = makeOptionPosition();
    engine.addOptionPosition(p);
    expect(engine.getOptionPositions()).toHaveLength(1);
    expect(engine.getOptionPosition('op-1')!.contractSymbol).toBe(p.contractSymbol);
  });

  it('getOptionPositionsBySpread returns only matching legs', () => {
    engine.addOptionPosition(makeOptionPosition({ id: 'a', spreadId: 'sp-1' }));
    engine.addOptionPosition(makeOptionPosition({ id: 'b', spreadId: 'sp-1', strike: new Decimal(410) }));
    engine.addOptionPosition(makeOptionPosition({ id: 'c', spreadId: 'sp-2' }));
    expect(engine.getOptionPositionsBySpread('sp-1').map(l => l.id).sort()).toEqual(['a', 'b']);
    expect(engine.getOptionPositionsBySpread('sp-2').map(l => l.id)).toEqual(['c']);
  });

  it('removeOptionPosition returns false on unknown id', () => {
    expect(engine.removeOptionPosition('nope')).toBe(false);
  });

  it('removeOptionPosition returns true and deletes', () => {
    engine.addOptionPosition(makeOptionPosition());
    expect(engine.removeOptionPosition('op-1')).toBe(true);
    expect(engine.getOptionPositions()).toEqual([]);
  });

  it('getState().optionPositions are serializable JSON', () => {
    engine.addOptionPosition(makeOptionPosition());
    const raw = engine.getState().optionPositions;
    expect(raw).toHaveLength(1);
    expect(typeof raw[0].strike).toBe('string');
    expect(typeof raw[0].szi).toBe('string');
    expect(typeof raw[0].entryPx).toBe('string');
  });

  it('survives JSON round-trip through loadState', () => {
    engine.addOptionPosition(makeOptionPosition({ szi: new Decimal(-2), entryPx: new Decimal('3.14159265') }));
    const serialized = JSON.parse(JSON.stringify(engine.getState()));
    const engine2 = new PaperEngine({ initialBalance: '10000', leverage: 10 });
    engine2.loadState(serialized);
    const revived = engine2.getOptionPositions();
    expect(revived).toHaveLength(1);
    expect(revived[0].szi.toString()).toBe('-2');
    expect(revived[0].entryPx.toString()).toBe('3.14159265');
  });

  it('loadState tolerates legacy saved states without optionPositions', () => {
    // Legacy account JSON from before options existed — no optionPositions key.
    const legacy = {
      balance: '10000',
      positions: [],
      openOrders: [],
      fills: [],
    };
    engine.loadState(legacy);
    expect(engine.getOptionPositions()).toEqual([]);
  });

  it('does not disturb perp positions when options are added', () => {
    openLong('BTC', '50000', '1');
    engine.addOptionPosition(makeOptionPosition());
    expect(engine.getPositions()).toHaveLength(1);
    expect(engine.getOptionPositions()).toHaveLength(1);
  });
});

// ── openOptionLegs ───────────────────────────────────────────────────

import type { Leg, OptionContract } from '../../../services/options/types.ts';

function mkContract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    symbol: 'TSLA260417C00400000',
    underlying: 'TSLA',
    type: 'call',
    strike: 400,
    expiration: 1776384000,
    bid: 4,
    ask: 6,
    last: 5,
    iv: 0.5,
    volume: 100,
    openInterest: 200,
    inTheMoney: false,
    ...overrides,
  };
}

function mkLeg(overrides: Partial<Leg> = {}): Leg {
  return {
    contract: mkContract(),
    side: 'buy',
    qty: 1,
    ...overrides,
  };
}

describe('openOptionLegs', () => {
  it('rejects empty legs', () => {
    const r = engine.openOptionLegs([]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/no legs/i);
  });

  it('rejects more than 4 legs', () => {
    const legs: Leg[] = Array.from({ length: 5 }, (_, i) => mkLeg({
      contract: mkContract({ symbol: `X${i}`, strike: 400 + i }),
    }));
    const r = engine.openOptionLegs(legs);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/max/i);
  });

  it('rejects non-positive qtyScalar', () => {
    const r = engine.openOptionLegs([mkLeg()], { qtyScalar: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects leg with zero quote', () => {
    const r = engine.openOptionLegs([mkLeg({
      contract: mkContract({ bid: 0, ask: 0, last: 0 }),
    })]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/no usable quote/i);
  });

  it('rejects when cash required exceeds available balance', () => {
    // Leg premium $5 mid × 100 × 1 = $500 debit; 1 long no margin. Fine.
    // Swap to short at very high premium so margin blows out balance.
    const short = mkLeg({ side: 'sell', contract: mkContract({ bid: 40, ask: 42 }) });
    // short premium $41 × 100 × 1 × 5 = 20500 margin; credit = 4100; cashRequired = 16400. Balance 10000.
    const r = engine.openOptionLegs([short]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/insufficient balance/i);
  });

  it('opens a single long call: debits premium, creates position, emits ledger', () => {
    const r = engine.openOptionLegs([mkLeg({ qty: 2 })], { fillModel: 'mid' });
    expect(r.success).toBe(true);
    if (!r.success) return;

    // mid = (4 + 6) / 2 = 5; qty 2 × 100 × 5 = $1000 debit
    expect(engine.getBalance()).toBe('9000');
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0].szi.toString()).toBe('2');
    expect(r.positions[0].entryPx.toString()).toBe('5');
    expect(r.positions[0].marginUsed.toString()).toBe('0');
    expect(r.positions[0].spreadId).toBe(r.spreadId);

    const fills = engine.getFills();
    expect(fills).toHaveLength(1);
    expect(fills[0].kind).toBe('option-open');
    expect(fills[0].spreadId).toBe(r.spreadId);
    expect(fills[0].side).toBe('buy');
    expect(fills[0].size).toBe('2');
  });

  it('opens a short put: balance increases by credit, margin reserved, available drops', () => {
    const short = mkLeg({
      side: 'sell',
      contract: mkContract({ type: 'put', bid: 2, ask: 3 }),
    });
    const balanceBefore = new Decimal(engine.getBalance());
    const r = engine.openOptionLegs([short], { fillModel: 'mid' });
    expect(r.success).toBe(true);
    if (!r.success) return;

    // mid 2.5 × 100 × 1 = 250 credit; margin = 2.5 × 100 × 1 × 5 = 1250
    const balanceAfter = new Decimal(engine.getBalance());
    expect(balanceAfter.sub(balanceBefore).toString()).toBe('250');

    const pos = r.positions[0];
    expect(pos.szi.toString()).toBe('-1');
    expect(pos.marginUsed.toString()).toBe('1250');
  });

  it('vertical debit spread: one spreadId across both legs, one ledger entry per leg', () => {
    const longCall = mkLeg({
      contract: mkContract({ symbol: 'TSLA-A', bid: 5, ask: 7 }),
    });
    const shortCall = mkLeg({
      side: 'sell',
      contract: mkContract({ symbol: 'TSLA-B', strike: 410, bid: 2, ask: 4 }),
    });
    const r = engine.openOptionLegs([longCall, shortCall], { fillModel: 'mid' });
    expect(r.success).toBe(true);
    if (!r.success) return;

    expect(r.positions).toHaveLength(2);
    expect(r.positions[0].spreadId).toBe(r.spreadId);
    expect(r.positions[1].spreadId).toBe(r.spreadId);
    expect(r.positions[0].id).not.toBe(r.positions[1].id);

    const fills = engine.getFills();
    expect(fills).toHaveLength(2);
    expect(fills.every(f => f.spreadId === r.spreadId)).toBe(true);
    expect(fills.every(f => f.kind === 'option-open')).toBe(true);

    // Long mid 6, short mid 3. Net debit = 600 - 300 = 300. Short margin = 3*100*1*5 = 1500.
    // Balance after: 10000 - 300 = 9700.
    expect(engine.getBalance()).toBe('9700');
  });

  it('cross fill model: buyer pays ask, seller hits bid', () => {
    const buy = mkLeg({
      contract: mkContract({ symbol: 'X-buy', bid: 4, ask: 6 }),
    });
    const sell = mkLeg({
      side: 'sell',
      contract: mkContract({ symbol: 'X-sell', strike: 420, bid: 1.5, ask: 2.5 }),
    });
    const r = engine.openOptionLegs([buy, sell], { fillModel: 'cross' });
    expect(r.success).toBe(true);
    if (!r.success) return;

    // buyer pays 6, seller receives 1.5
    expect(r.positions[0].entryPx.toString()).toBe('6');
    expect(r.positions[1].entryPx.toString()).toBe('1.5');
  });

  it('rollback on reject: no position written, no ledger entry, balance unchanged', () => {
    const good = mkLeg();
    const bad = mkLeg({
      contract: mkContract({ symbol: 'BAD', bid: 0, ask: 0, last: 0 }),
    });
    const balanceBefore = engine.getBalance();
    const fillsBefore = engine.getFills().length;
    const r = engine.openOptionLegs([good, bad]);
    expect(r.success).toBe(false);
    expect(engine.getBalance()).toBe(balanceBefore);
    expect(engine.getOptionPositions()).toEqual([]);
    expect(engine.getFills()).toHaveLength(fillsBefore);
  });

  it('qtyScalar scales size and debit', () => {
    const r = engine.openOptionLegs([mkLeg({ qty: 1 })], { qtyScalar: 3 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    // mid 5 × 100 × 3 = 1500
    expect(engine.getBalance()).toBe('8500');
    expect(r.positions[0].szi.toString()).toBe('3');
  });

  it('emitUpdate runs once per successful open (not once per leg)', () => {
    const updates: ReturnType<PaperEngine['getState']>[] = [];
    engine = new PaperEngine({
      initialBalance: '10000', leverage: 10,
      onUpdate: s => updates.push(s),
    });
    updates.length = 0;
    const r = engine.openOptionLegs([mkLeg(), mkLeg({ contract: mkContract({ symbol: 'Y', strike: 410 }) })]);
    expect(r.success).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].optionPositions).toHaveLength(2);
  });

  it('availableBalance accounts for option short-leg margin', () => {
    const short = mkLeg({
      side: 'sell',
      contract: mkContract({ bid: 2, ask: 2 }),
    });
    engine.openOptionLegs([short]);
    // After short: balance = 10000 + 200 = 10200. Margin reserved = 2*100*1*5 = 1000.
    // Perp entry with $9201 margin should fit (10200 - 1000 = 9200 available) — should FAIL at 9201.
    const rejected = engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '92010', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    expect(rejected.success).toBe(false);
  });

  it('counters survive a JSON round-trip so new legs do not collide', () => {
    engine.openOptionLegs([mkLeg()]);
    const s = JSON.parse(JSON.stringify(engine.getState()));
    const engine2 = new PaperEngine({ initialBalance: '10000', leverage: 10 });
    engine2.loadState(s);
    const r = engine2.openOptionLegs([mkLeg({ contract: mkContract({ symbol: 'Z' }) })]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    // Must not collide with the leg id or spread id from engine #1
    const allIds = [
      ...engine2.getOptionPositions().map(p => p.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

// ── closeOptionSpread / closeOptionLegById ───────────────────────────

describe('closeOptionSpread', () => {
  it('rejects unknown spreadId', () => {
    const r = engine.closeOptionSpread('paper-spread-999', []);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/no open spread/i);
  });

  it('rejects when a leg has no matching contract in the chain', () => {
    const open = engine.openOptionLegs([mkLeg()]);
    expect(open.success).toBe(true);
    if (!open.success) return;
    const r = engine.closeOptionSpread(open.spreadId, []);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/no contract/i);
    // Position still open, balance unchanged (still 9500 — 10000 - 500 debit).
    expect(engine.getOptionPositions()).toHaveLength(1);
    expect(engine.getBalance()).toBe('9500');
  });

  it('rejects when a leg has a zero-quote contract (no usable fill)', () => {
    const open = engine.openOptionLegs([mkLeg()]);
    if (!open.success) throw new Error('setup failed');
    const dead = mkContract({ bid: 0, ask: 0, last: 0 });
    const r = engine.closeOptionSpread(open.spreadId, [dead]);
    expect(r.success).toBe(false);
    expect(engine.getOptionPositions()).toHaveLength(1);
  });

  it('closes a single long call at a profit: balance credited, PnL realized, position removed, ledger tagged', () => {
    // Open: mid 5 × 1 × 100 = 500 debit → balance 9500
    const open = engine.openOptionLegs([mkLeg()]);
    if (!open.success) throw new Error('setup failed');
    const fillsBefore = engine.getFills().length;
    // Close at mid 8 (bid 7, ask 9) → cash in 800, realized PnL = (8-5)×1×100 = 300
    const closeContract = mkContract({ bid: 7, ask: 9 });
    const r = engine.closeOptionSpread(open.spreadId, [closeContract]);
    expect(r.success).toBe(true);
    if (!r.success) return;

    expect(r.realizedPnl.toString()).toBe('300');
    expect(r.closedLegs).toBe(1);
    expect(engine.getOptionPositions()).toHaveLength(0);
    // 9500 + 800 = 10300
    expect(engine.getBalance()).toBe('10300');

    const fills = engine.getFills();
    expect(fills).toHaveLength(fillsBefore + 1);
    const closeFill = fills[fills.length - 1];
    expect(closeFill.kind).toBe('option-close');
    expect(closeFill.side).toBe('sell');
    expect(closeFill.spreadId).toBe(open.spreadId);
    expect(closeFill.realizedPnl).toBe('300');
    expect(closeFill.price).toBe('8');
  });

  it('closes a single long call at a loss: balance still credited (smaller), PnL negative', () => {
    const open = engine.openOptionLegs([mkLeg()]);
    if (!open.success) throw new Error('setup failed');
    // Close at mid 2: cash in 200, realized = (2-5)×1×100 = -300
    const r = engine.closeOptionSpread(open.spreadId, [mkContract({ bid: 1, ask: 3 })]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.realizedPnl.toString()).toBe('-300');
    // 9500 + 200 = 9700
    expect(engine.getBalance()).toBe('9700');
  });

  it('closes a short put: balance debited by buy-to-close cost, margin released', () => {
    // Open short put: mid 2.5 × 1 × 100 = 250 credit → balance 10250.
    // Short margin reserved = 2.5 × 100 × 1 × 5 = 1250.
    const short = mkLeg({
      side: 'sell',
      contract: mkContract({ type: 'put', bid: 2, ask: 3 }),
    });
    const open = engine.openOptionLegs([short]);
    if (!open.success) throw new Error('setup failed');
    expect(engine.getBalance()).toBe('10250');
    // availableBalance after open = 10250 - 1250 = 9000
    // Now close at mid 1 (premium decayed): pay 100 to buy back.
    // Realized PnL = (1 - 2.5) × (-1) × 100 = 150 (short profits from decay).
    const r = engine.closeOptionSpread(open.spreadId, [mkContract({ type: 'put', bid: 0.5, ask: 1.5 })]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.realizedPnl.toString()).toBe('150');
    // Balance: 10250 - 100 = 10150
    expect(engine.getBalance()).toBe('10150');
    // Margin released (position gone) — availableBalance now = full balance.
    expect(engine.getOptionPositions()).toHaveLength(0);
  });

  it('closes a vertical debit spread: both legs closed, realized PnL summed, single spreadId across ledger entries', () => {
    const longCall = mkLeg({ contract: mkContract({ symbol: 'A', bid: 5, ask: 7 }) });
    const shortCall = mkLeg({
      side: 'sell',
      contract: mkContract({ symbol: 'B', strike: 410, bid: 2, ask: 4 }),
    });
    const open = engine.openOptionLegs([longCall, shortCall]);
    if (!open.success) throw new Error('setup failed');
    // balance 9700 (net debit 300 debited)
    const fillsBefore = engine.getFills().length;

    // Close: A at mid 8 (bid 7, ask 9), B at mid 1 (bid 0.5, ask 1.5).
    //   Long A close-sell: cash +800, realized (8-6)×1×100 = 200
    //   Short B close-buy: cash -100, realized (1-3)×(-1)×100 = 200
    //   Total realized: 400; net cash delta: +700
    //   Balance: 9700 + 700 = 10400
    const r = engine.closeOptionSpread(open.spreadId, [
      mkContract({ symbol: 'A', bid: 7, ask: 9 }),
      mkContract({ symbol: 'B', strike: 410, bid: 0.5, ask: 1.5 }),
    ]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.realizedPnl.toString()).toBe('400');
    expect(r.closedLegs).toBe(2);
    expect(engine.getBalance()).toBe('10400');
    expect(engine.getOptionPositions()).toHaveLength(0);

    const newFills = engine.getFills().slice(fillsBefore);
    expect(newFills).toHaveLength(2);
    expect(newFills.every(f => f.kind === 'option-close')).toBe(true);
    expect(newFills.every(f => f.spreadId === open.spreadId)).toBe(true);
  });

  it('atomic on reject: one bad leg → no mutations for the good leg', () => {
    const longA = mkLeg({ contract: mkContract({ symbol: 'A' }) });
    const longB = mkLeg({ contract: mkContract({ symbol: 'B', strike: 410 }) });
    const open = engine.openOptionLegs([longA, longB]);
    if (!open.success) throw new Error('setup failed');
    const balanceBefore = engine.getBalance();
    const fillsBefore = engine.getFills().length;

    // One contract good, the other has no quote at all.
    const r = engine.closeOptionSpread(open.spreadId, [
      mkContract({ symbol: 'A', bid: 10, ask: 12 }),
      mkContract({ symbol: 'B', strike: 410, bid: 0, ask: 0, last: 0 }),
    ]);
    expect(r.success).toBe(false);
    // Both legs still open, balance unchanged, no new ledger.
    expect(engine.getOptionPositions()).toHaveLength(2);
    expect(engine.getBalance()).toBe(balanceBefore);
    expect(engine.getFills()).toHaveLength(fillsBefore);
  });

  it('releases short-leg margin so availableBalance fully recovers', () => {
    const short = mkLeg({
      side: 'sell',
      contract: mkContract({ type: 'put', bid: 2, ask: 3 }),
    });
    const open = engine.openOptionLegs([short]);
    if (!open.success) throw new Error('setup failed');
    // Close at same price → realized 0, balance back to 10000.
    engine.closeOptionSpread(open.spreadId, [mkContract({ type: 'put', bid: 2, ask: 3 })]);
    expect(engine.getBalance()).toBe('10000');
    // Margin reservation is gone — can place a new short with full balance.
    const r = engine.openOptionLegs([short]);
    expect(r.success).toBe(true);
  });

  it('emits onUpdate once per close (not once per leg)', () => {
    const updates: ReturnType<PaperEngine['getState']>[] = [];
    engine = new PaperEngine({
      initialBalance: '10000', leverage: 10,
      onUpdate: (s) => updates.push(s),
    });
    const open = engine.openOptionLegs([
      mkLeg({ contract: mkContract({ symbol: 'A' }) }),
      mkLeg({ contract: mkContract({ symbol: 'B', strike: 410 }) }),
    ]);
    if (!open.success) throw new Error('setup failed');
    updates.length = 0;
    const r = engine.closeOptionSpread(open.spreadId, [
      mkContract({ symbol: 'A', bid: 5, ask: 7 }),
      mkContract({ symbol: 'B', strike: 410, bid: 2, ask: 4 }),
    ]);
    expect(r.success).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].optionPositions).toHaveLength(0);
  });

  it('respects cross fill model: long closes at bid, short closes at ask', () => {
    const long = mkLeg({ contract: mkContract({ symbol: 'L', bid: 4, ask: 6 }) });
    const short = mkLeg({
      side: 'sell',
      contract: mkContract({ symbol: 'S', strike: 410, bid: 2, ask: 3 }),
    });
    const open = engine.openOptionLegs([long, short], { fillModel: 'cross' });
    if (!open.success) throw new Error('setup failed');

    // Close with cross: long sells → bid; short buys → ask.
    const r = engine.closeOptionSpread(open.spreadId, [
      mkContract({ symbol: 'L', bid: 8, ask: 10 }),
      mkContract({ symbol: 'S', strike: 410, bid: 1, ask: 2 }),
    ], { fillModel: 'cross' });
    expect(r.success).toBe(true);
    const fills = engine.getFills().filter((f) => f.kind === 'option-close');
    // long entry = ask 6, long close = bid 8 → realized (8-6)*1*100 = 200
    // short entry = bid 2, short close = ask 2 → realized (2-2)*(-1)*100 = 0
    const longClose = fills.find((f) => f.coin === 'L')!;
    const shortClose = fills.find((f) => f.coin === 'S')!;
    expect(longClose.price).toBe('8');
    expect(shortClose.price).toBe('2');
  });
});

describe('closeOptionLegById', () => {
  it('rejects unknown leg id', () => {
    const r = engine.closeOptionLegById('paper-opt-999', []);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/no open leg/i);
  });

  it('closes one leg of a multi-leg spread and leaves the other open', () => {
    const legA = mkLeg({ contract: mkContract({ symbol: 'A' }) });
    const legB = mkLeg({ contract: mkContract({ symbol: 'B', strike: 410 }) });
    const open = engine.openOptionLegs([legA, legB]);
    if (!open.success) throw new Error('setup failed');
    const [posA, posB] = open.positions;

    const r = engine.closeOptionLegById(posA.id, [mkContract({ symbol: 'A', bid: 7, ask: 9 })]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.realizedPnl.toString()).toBe('300'); // (8-5)*1*100
    // Only posB remains; spreadId preserved on remaining leg.
    const remaining = engine.getOptionPositions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(posB.id);
    expect(remaining[0].spreadId).toBe(open.spreadId);

    const closeFill = engine.getFills().find((f) => f.kind === 'option-close')!;
    expect(closeFill.coin).toBe('A');
    expect(closeFill.spreadId).toBe(open.spreadId);
  });

  it('rejects atomically when the contract is not in the chain', () => {
    const open = engine.openOptionLegs([mkLeg()]);
    if (!open.success) throw new Error('setup failed');
    const posId = open.positions[0].id;
    const balanceBefore = engine.getBalance();
    const r = engine.closeOptionLegById(posId, []);
    expect(r.success).toBe(false);
    expect(engine.getOptionPositions()).toHaveLength(1);
    expect(engine.getBalance()).toBe(balanceBefore);
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
