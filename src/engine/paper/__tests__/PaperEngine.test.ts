import { describe, it, expect, beforeEach } from 'vitest';
import { PaperEngine } from '../PaperEngine.ts';

let engine: PaperEngine;

beforeEach(() => {
  engine = new PaperEngine({ initialBalance: '10000', leverage: 10 });
});

describe('placeOrder', () => {
  it('places a limit buy order', () => {
    const result = engine.placeOrder({
      coin: 'BTC',
      side: 'buy',
      price: '50000',
      size: '0.1',
      reduceOnly: false,
      orderType: { limit: { tif: 'Gtc' } },
    });
    expect(result.success).toBe(true);
    expect(engine.getOpenOrders()).toHaveLength(1);
  });

  it('rejects zero size', () => {
    const result = engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '0',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Size');
  });

  it('rejects insufficient margin', () => {
    // 100 BTC * 50000 / 10 = 500,000 margin needed
    const result = engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '100',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('margin');
  });

  it('rejects reduceOnly when no position', () => {
    const result = engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '50000', size: '1',
      reduceOnly: true, orderType: { limit: { tif: 'Gtc' } },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No position');
  });
});

describe('cancelOrder', () => {
  it('cancels an existing order', () => {
    const result = engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '0.1',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    expect(engine.cancelOrder(result.oid as string)).toBe(true);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('returns false for nonexistent order', () => {
    expect(engine.cancelOrder('nonexistent')).toBe(false);
  });
});

describe('cancelAllOrders', () => {
  it('cancels all orders for a coin', () => {
    engine.placeOrder({ coin: 'BTC', side: 'buy', price: '50000', size: '0.1', reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });
    engine.placeOrder({ coin: 'ETH', side: 'buy', price: '3000', size: '1', reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });
    engine.cancelAllOrders('BTC');
    expect(engine.getOpenOrders()).toHaveLength(1);
    expect(engine.getOpenOrders()[0].coin).toBe('ETH');
  });

  it('cancels all orders when no coin specified', () => {
    engine.placeOrder({ coin: 'BTC', side: 'buy', price: '50000', size: '0.1', reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });
    engine.placeOrder({ coin: 'ETH', side: 'buy', price: '3000', size: '1', reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });
    engine.cancelAllOrders();
    expect(engine.getOpenOrders()).toHaveLength(0);
  });
});

describe('full flow: limit buy fills on price drop', () => {
  it('opens position when limit buy fills', () => {
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '0.1',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });

    // Price above limit — no fill
    engine.onPriceUpdate('BTC', '51000');
    expect(engine.getOpenOrders()).toHaveLength(1);
    expect(engine.getPositions()).toHaveLength(0);

    // Price drops to limit — fill
    engine.onPriceUpdate('BTC', '50000');
    expect(engine.getOpenOrders()).toHaveLength(0);
    expect(engine.getPositions()).toHaveLength(1);

    const pos = engine.getPosition('BTC')!;
    expect(pos.szi.toString()).toBe('0.1');
    expect(pos.entryPx.toString()).toBe('50000');
    expect(engine.getFills()).toHaveLength(1);
  });
});

describe('full flow: open long, TP hits, close with profit', () => {
  it('realizes profit when TP triggers', () => {
    // Place and fill a long position via limit
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    engine.onPriceUpdate('BTC', '50000'); // fills

    // Place TP at 55000
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '55000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '55000', tpsl: 'tp' } },
    });

    // Price rises to TP
    engine.onPriceUpdate('BTC', '55000');
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);

    // Balance should have increased (initial 10000 + 5000 profit - fees)
    const balance = parseFloat(engine.getBalance());
    expect(balance).toBeGreaterThan(14000); // rough check accounting for fees
    expect(balance).toBeLessThan(15000);
  });
});

describe('full flow: open short, SL triggers, loss realized', () => {
  it('realizes loss when SL triggers', () => {
    // Open short at 50000
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    engine.onPriceUpdate('BTC', '50000'); // fills

    // Place SL at 52000 (buy to close)
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '52000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '52000', tpsl: 'sl' } },
    });

    engine.onPriceUpdate('BTC', '52000');
    expect(engine.getPositions()).toHaveLength(0);

    // Balance: 10000 - 2000 loss - fees
    const balance = parseFloat(engine.getBalance());
    expect(balance).toBeLessThan(8100);
    expect(balance).toBeGreaterThan(7900);
  });
});

describe('SL triggers and cancels TP', () => {
  it('closes position and removes TP when SL fills', () => {
    // Open short at 50000
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    engine.onPriceUpdate('BTC', '50000');
    expect(engine.getPositions()).toHaveLength(1);

    // Place TP at 48000 and SL at 52000
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '48000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '48000', tpsl: 'tp' } },
    });
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '52000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '52000', tpsl: 'sl' } },
    });
    expect(engine.getOpenOrders()).toHaveLength(2);

    // Price rises to SL
    engine.onPriceUpdate('BTC', '52000');

    // Position should be closed and BOTH orders gone
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('closes position and removes SL when TP fills', () => {
    // Open long at 50000
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });
    engine.onPriceUpdate('BTC', '50000');

    // Place TP at 55000 and SL at 48000
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '55000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '55000', tpsl: 'tp' } },
    });
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '48000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '48000', tpsl: 'sl' } },
    });
    expect(engine.getOpenOrders()).toHaveLength(2);

    // Price rises to TP
    engine.onPriceUpdate('BTC', '55000');

    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });
});

describe('multiple assets tracked independently', () => {
  it('manages BTC and ETH positions separately', () => {
    engine.placeOrder({ coin: 'BTC', side: 'buy', price: '50000', size: '0.1', reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });
    engine.placeOrder({ coin: 'ETH', side: 'sell', price: '3000', size: '1', reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });

    engine.onPriceUpdate('BTC', '50000');
    engine.onPriceUpdate('ETH', '3000');

    expect(engine.getPositions()).toHaveLength(2);
    const btc = engine.getPosition('BTC')!;
    const eth = engine.getPosition('ETH')!;
    expect(btc.szi.toString()).toBe('0.1');
    expect(eth.szi.toString()).toBe('-1');
  });
});

describe('marketClose', () => {
  it('closes a long position at market price', () => {
    engine.placeOrder({ coin: 'BTC', side: 'buy', price: '50000', size: '0.1', reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });
    engine.onPriceUpdate('BTC', '50000'); // fill
    expect(engine.getPositions()).toHaveLength(1);

    const result = engine.marketClose('BTC', '51000');
    expect(result.success).toBe(true);
    expect(engine.getPositions()).toHaveLength(0);
    // Profit: (51000-50000) * 0.1 = 100, minus fees
    const balance = parseFloat(engine.getBalance());
    expect(balance).toBeGreaterThan(10090);
  });

  it('cancels reduceOnly orders when position is closed', () => {
    engine.placeOrder({ coin: 'BTC', side: 'buy', price: '50000', size: '0.1', reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });
    engine.onPriceUpdate('BTC', '50000');

    // Place TP and SL
    engine.placeOrder({ coin: 'BTC', side: 'sell', price: '55000', size: '0.1', reduceOnly: true, orderType: { trigger: { isMarket: true, triggerPx: '55000', tpsl: 'tp' } } });
    engine.placeOrder({ coin: 'BTC', side: 'sell', price: '48000', size: '0.1', reduceOnly: true, orderType: { trigger: { isMarket: true, triggerPx: '48000', tpsl: 'sl' } } });
    expect(engine.getOpenOrders()).toHaveLength(2);

    engine.marketClose('BTC', '51000');
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0); // TP/SL cancelled
  });

  it('returns error when no position exists', () => {
    const result = engine.marketClose('BTC', '50000');
    expect(result.success).toBe(false);
  });
});

describe('onUpdate callback', () => {
  it('fires on state change', () => {
    const updates: string[] = [];
    const eng = new PaperEngine({
      initialBalance: '10000',
      leverage: 10,
      onUpdate: (state) => updates.push(state.balance),
    });

    eng.placeOrder({ coin: 'BTC', side: 'buy', price: '50000', size: '0.1', reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });
    expect(updates.length).toBeGreaterThan(0);
  });
});

describe('balance tracking through multiple trades', () => {
  it('accumulates realized PnL and fees correctly', () => {
    // Use smaller sizes so margin isn't an issue
    // Trade 1: Buy 0.1 BTC at 50000, close at 51000 (+100 profit)
    engine.placeOrder({ coin: 'BTC', side: 'buy', price: '50000', size: '0.1', reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });
    engine.onPriceUpdate('BTC', '50000'); // fills buy

    engine.placeOrder({ coin: 'BTC', side: 'sell', price: '51000', size: '0.1', reduceOnly: true, orderType: { limit: { tif: 'Gtc' } } });
    engine.onPriceUpdate('BTC', '51000'); // fills sell, closes long

    // Trade 2: Short 0.1 BTC at 51000, close at 50500 (+50 profit)
    engine.placeOrder({ coin: 'BTC', side: 'sell', price: '51000', size: '0.1', reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });
    engine.onPriceUpdate('BTC', '51000'); // fills sell, opens short

    engine.placeOrder({ coin: 'BTC', side: 'buy', price: '50500', size: '0.1', reduceOnly: true, orderType: { limit: { tif: 'Gtc' } } });
    engine.onPriceUpdate('BTC', '50500'); // fills buy, closes short

    expect(engine.getFills()).toHaveLength(4);

    // Net profit: 100 + 50 = 150, minus fees (~5 + 5.1 + 5.1 + 5.05 ≈ 20.25 for maker)
    const balance = parseFloat(engine.getBalance());
    expect(balance).toBeGreaterThan(10120);
    expect(balance).toBeLessThan(10150);
  });
});
