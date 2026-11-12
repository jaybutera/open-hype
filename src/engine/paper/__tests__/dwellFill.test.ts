import { describe, it, expect } from 'vitest';
import { PaperEngine } from '../PaperEngine.ts';

function setup() {
  let t = 1_000_000;
  const engine = new PaperEngine({ initialBalance: '10000', leverage: 10, now: () => t });
  const advance = (ms: number) => { t += ms; };
  return { engine, advance };
}

const limit = (side: 'buy' | 'sell', price: string) => ({
  coin: 'BTC', side, price, size: '0.01', reduceOnly: false,
  orderType: { limit: { tif: 'Gtc' as const } },
});

describe('dwell fill rule', () => {
  it('fills a buy limit after trades sit at the limit for 2s, mid never reaching it', () => {
    const { engine, advance } = setup();
    engine.placeOrder(limit('buy', '100'));
    engine.onTouchPrice('BTC', '100', '100');
    advance(1999);
    engine.onPriceUpdate('BTC', '100.5');
    expect(engine.getOpenOrders()).toHaveLength(1);
    advance(1);
    engine.onPriceUpdate('BTC', '100.5');
    expect(engine.getOpenOrders()).toHaveLength(0);
    const fill = engine.getFills()[0];
    expect(Number(fill.price)).toBe(100);
  });

  it('restarts the timer when price leaves the limit', () => {
    const { engine, advance } = setup();
    engine.placeOrder(limit('sell', '200'));
    engine.onTouchPrice('BTC', '200', '200');
    advance(1500);
    engine.onTouchPrice('BTC', '199.9', '199.9');
    advance(1000);
    engine.onTouchPrice('BTC', '200.1', '200.1');
    advance(1999);
    engine.onPriceUpdate('BTC', '199.5');
    expect(engine.getOpenOrders()).toHaveLength(1);
    advance(1);
    engine.onTouchPrice('BTC', '200.2', '200.2');
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('uses bid for buys and ask for sells', () => {
    const { engine, advance } = setup();
    engine.placeOrder(limit('buy', '100'));
    engine.onTouchPrice('BTC', '100.1', '99.9');
    advance(3000);
    engine.onTouchPrice('BTC', '100.1', '99.9');
    expect(engine.getOpenOrders()).toHaveLength(1);
  });
});
