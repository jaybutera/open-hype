import { useState, useEffect } from 'react';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useTradeSetupStore } from '../../store/useTradeSetupStore.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import type { OrderType, Side } from '../../types/order.ts';

interface Props {
  engine: PaperEngine;
}

const inputStyle = {
  width: '100%', padding: '8px 10px', background: '#1a1f2e',
  border: '1px solid #2a2f3e', borderRadius: 6, color: '#e1e4e8',
  fontSize: 14, outline: 'none',
} as const;

const labelStyle = {
  fontSize: 11, color: '#8a8f98', display: 'block', marginBottom: 4,
} as const;

/** Convert USDC notional to asset size */
function usdcToAssetSize(usdc: string, price: string): string {
  const u = parseFloat(usdc);
  const p = parseFloat(price);
  if (!u || !p || p === 0) return '0';
  return (u / p).toString();
}

export function OrderPanel({ engine }: Props) {
  const currentAsset = useMarketStore(s => s.currentAsset);
  const allMids = useMarketStore(s => s.allMids);
  const leverage = useSettingsStore(s => s.leverage);
  const setLeverage = useSettingsStore(s => s.setLeverage);
  const sizeUsdc = useSettingsStore(s => s.sizeUsdc);
  const setSizeUsdc = useSettingsStore(s => s.setSizeUsdc);
  const side = useSettingsStore(s => s.side);
  const setSide = useSettingsStore(s => s.setSide);
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState('');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const lastRejection = useAccountStore(s => s.lastRejection);
  const setRejection = useAccountStore(s => s.setRejection);

  // Surface async order rejections (e.g. margin check at fill time)
  useEffect(() => {
    if (lastRejection) {
      setError(lastRejection);
      setRejection(null);
    }
  }, [lastRejection, setRejection]);

  const riskUsdc = useSettingsStore(s => s.riskUsdc);
  const setRiskUsdc = useSettingsStore(s => s.setRiskUsdc);
  const pendingSetup = useTradeSetupStore(s => s.pendingSetup);
  const activeSetups = useTradeSetupStore(s => s.activeSetups);
  const startSetup = useTradeSetupStore(s => s.startSetup);
  const removeSetup = useTradeSetupStore(s => s.removeSetup);
  const clearPending = useTradeSetupStore(s => s.clearPending);

  const mid = allMids[currentAsset] ?? '0';

  const handleExecuteSetup = (id: string) => {
    const setup = useTradeSetupStore.getState().activeSetups.find(s => s.id === id);
    if (!setup) {
      setError('Setup not found');
      return;
    }

    // Recalculate size from current risk in case it was set/changed after setup creation
    const currentRisk = parseFloat(useSettingsStore.getState().riskUsdc) || 0;
    const riskPerUnit = Math.abs(setup.entryPrice - setup.slPrice);
    const assetSize = riskPerUnit > 0 && currentRisk > 0
      ? currentRisk / riskPerUnit
      : setup.assetSize;
    const sizeStr = assetSize.toString();

    if (assetSize <= 0) {
      setError('Risk not set — size is zero');
      return;
    }

    const closeSide: Side = setup.side === 'buy' ? 'sell' : 'buy';

    const errors: string[] = [];

    const r1 = engine.placeOrder({
      coin: currentAsset,
      side: setup.side,
      price: setup.entryPrice.toFixed(2),
      size: sizeStr,
      reduceOnly: false,
      orderType: { limit: { tif: 'Gtc' } },
    });
    if (!r1.success) {
      setError(`Entry failed: ${r1.error}`);
      return;
    }

    const r2 = engine.placeOrder({
      coin: currentAsset,
      side: closeSide,
      price: setup.tpPrice.toFixed(2),
      size: sizeStr,
      reduceOnly: false,
      orderType: { trigger: { isMarket: true, triggerPx: setup.tpPrice.toFixed(2), tpsl: 'tp' } },
    });
    if (!r2.success) errors.push(`TP: ${r2.error}`);

    const r3 = engine.placeOrder({
      coin: currentAsset,
      side: closeSide,
      price: setup.slPrice.toFixed(2),
      size: sizeStr,
      reduceOnly: false,
      orderType: { trigger: { isMarket: true, triggerPx: setup.slPrice.toFixed(2), tpsl: 'sl' } },
    });
    if (!r3.success) errors.push(`SL: ${r3.error}`);

    if (errors.length > 0) {
      setError(errors.join(' | '));
    }

    removeSetup(id);
    if (errors.length === 0) {
      setSuccess('Setup executed — 3 orders placed');
      setTimeout(() => setSuccess(null), 2000);
    }
  };

  const handleSubmit = () => {
    setError(null);
    setSuccess(null);

    const orderPrice = orderType === 'market' ? mid : price;
    if (!orderPrice || !sizeUsdc) {
      setError('Price and size required');
      return;
    }

    const assetSize = usdcToAssetSize(sizeUsdc, orderPrice);
    if (parseFloat(assetSize) <= 0) {
      setError('Invalid size');
      return;
    }

    const ot: OrderType = orderType === 'market'
      ? { limit: { tif: 'Ioc' } }
      : { limit: { tif: 'Gtc' } };

    const result = engine.placeOrder({
      coin: currentAsset,
      side,
      price: orderPrice,
      size: assetSize,
      reduceOnly,
      orderType: ot,
    });

    if (!result.success) {
      setError(result.error ?? 'Order failed');
      return;
    }

    if (orderType === 'market') {
      engine.onPriceUpdate(currentAsset, mid);
    }

    // Place TP if specified
    if (tpPrice) {
      const tpSide: Side = side === 'buy' ? 'sell' : 'buy';
      engine.placeOrder({
        coin: currentAsset,
        side: tpSide,
        price: tpPrice,
        size: assetSize,
        reduceOnly: true,
        orderType: { trigger: { isMarket: true, triggerPx: tpPrice, tpsl: 'tp' } },
      });
    }

    // Place SL if specified
    if (slPrice) {
      const slSide: Side = side === 'buy' ? 'sell' : 'buy';
      engine.placeOrder({
        coin: currentAsset,
        side: slSide,
        price: slPrice,
        size: assetSize,
        reduceOnly: true,
        orderType: { trigger: { isMarket: true, triggerPx: slPrice, tpsl: 'sl' } },
      });
    }

    setSuccess('Order placed');
    setTimeout(() => setSuccess(null), 2000);
  };

  const isBuy = side === 'buy';
  const effectivePrice = orderType === 'market' ? mid : price;
  const assetSizePreview = effectivePrice ? usdcToAssetSize(sizeUsdc, effectivePrice) : '0';
  const marginPreview = sizeUsdc ? (parseFloat(sizeUsdc) / leverage).toFixed(2) : '';

  return (
    <div style={{
      background: '#0d1117',
      borderLeft: '1px solid #1a1f2e',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      width: 280,
      flexShrink: 0,
      overflowY: 'auto',
    }}>
      {/* Side toggle */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={() => setSide('buy')}
          style={{
            flex: 1, padding: '10px', border: 'none', borderRadius: 6,
            cursor: 'pointer', fontWeight: 600, fontSize: 14,
            background: isBuy ? '#0ecb81' : '#1a1f2e',
            color: isBuy ? '#0a0e17' : '#8a8f98',
          }}
        >
          Long
        </button>
        <button
          onClick={() => setSide('sell')}
          style={{
            flex: 1, padding: '10px', border: 'none', borderRadius: 6,
            cursor: 'pointer', fontWeight: 600, fontSize: 14,
            background: !isBuy ? '#f6465d' : '#1a1f2e',
            color: !isBuy ? '#fff' : '#8a8f98',
          }}
        >
          Short
        </button>
      </div>

      {/* Risk-based trade setup */}
      <div>
        <label style={labelStyle}>Risk (USDC)</label>
        <input
          value={riskUsdc}
          onChange={e => setRiskUsdc(e.target.value)}
          placeholder="20.00"
          style={inputStyle}
        />
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={() => startSetup('buy')}
          disabled={!!pendingSetup}
          style={{
            flex: 1, padding: '8px', border: 'none', borderRadius: 6,
            cursor: pendingSetup ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 12,
            background: '#0ecb81', color: '#0a0e17', opacity: pendingSetup ? 0.4 : 1,
          }}
        >
          Set Up Long
        </button>
        <button
          onClick={() => startSetup('sell')}
          disabled={!!pendingSetup}
          style={{
            flex: 1, padding: '8px', border: 'none', borderRadius: 6,
            cursor: pendingSetup ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 12,
            background: '#f6465d', color: '#fff', opacity: pendingSetup ? 0.4 : 1,
          }}
        >
          Set Up Short
        </button>
      </div>
      {pendingSetup && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: pendingSetup.side === 'buy' ? '#0ecb81' : '#f6465d' }}>
            Click chart: {pendingSetup.clicks.length}/3 levels
          </span>
          <button
            onClick={clearPending}
            style={{
              background: 'none', border: '1px solid #2a2f3e', borderRadius: 4,
              color: '#8a8f98', fontSize: 11, padding: '2px 8px', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Active trade setups */}
      {activeSetups.map(setup => (
        <div key={setup.id} style={{
          background: '#1a1f2e', borderRadius: 6, padding: '8px 10px',
          fontSize: 11, color: '#e1e4e8',
          borderLeft: `3px solid ${setup.side === 'buy' ? '#0ecb81' : '#f6465d'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: setup.side === 'buy' ? '#0ecb81' : '#f6465d' }}>
              {setup.side === 'buy' ? 'LONG' : 'SHORT'} Setup
            </span>
            <span style={{ color: '#8a8f98' }}>R:R {setup.rr.toFixed(1)}</span>
          </div>
          <div>Entry: {setup.entryPrice.toFixed(2)} | Size: {setup.assetSize.toPrecision(4)}</div>
          <div>
            <span style={{ color: '#0ecb81' }}>TP: {setup.tpPrice.toFixed(2)} (+${setup.potentialPnl.toFixed(2)})</span>
            {' · '}
            <span style={{ color: '#f6465d' }}>SL: {setup.slPrice.toFixed(2)} (-${setup.potentialLoss.toFixed(2)})</span>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <button
              onClick={() => handleExecuteSetup(setup.id)}
              style={{
                flex: 1, padding: '5px', border: 'none', borderRadius: 4,
                background: '#0ecb81', color: '#0a0e17',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Execute
            </button>
            <button
              onClick={() => removeSetup(setup.id)}
              style={{
                padding: '5px 10px', border: 'none', borderRadius: 4,
                background: '#f6465d', color: '#fff',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      <div style={{ borderTop: '1px solid #1a1f2e', margin: '2px 0' }} />

      {/* Order type */}
      <div style={{ display: 'flex', gap: 4 }}>
        {(['limit', 'market'] as const).map(t => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            style={{
              flex: 1, padding: '6px', fontSize: 12, border: 'none', borderRadius: 4,
              cursor: 'pointer',
              background: orderType === t ? '#2a2f3e' : 'transparent',
              color: orderType === t ? '#e1e4e8' : '#8a8f98',
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Price */}
      {orderType === 'limit' && (
        <div>
          <label style={labelStyle}>Price</label>
          <input
            value={price}
            onChange={e => setPrice(e.target.value)}
            placeholder={mid}
            style={inputStyle}
          />
        </div>
      )}

      {/* Size in USDC */}
      <div>
        <label style={labelStyle}>Size (USDC)</label>
        <input
          value={sizeUsdc}
          onChange={e => setSizeUsdc(e.target.value)}
          placeholder="0.00"
          style={inputStyle}
        />
        {sizeUsdc && effectivePrice && parseFloat(assetSizePreview) > 0 && (
          <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>
            ~ {parseFloat(assetSizePreview).toPrecision(6)} {currentAsset}
          </div>
        )}
      </div>

      {/* TP/SL */}
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={{ ...labelStyle, color: '#0ecb81' }}>Take Profit</label>
          <input
            value={tpPrice}
            onChange={e => setTpPrice(e.target.value)}
            placeholder="TP price"
            style={{ ...inputStyle, fontSize: 12, padding: '6px 8px' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ ...labelStyle, color: '#f6465d' }}>Stop Loss</label>
          <input
            value={slPrice}
            onChange={e => setSlPrice(e.target.value)}
            placeholder="SL price"
            style={{ ...inputStyle, fontSize: 12, padding: '6px 8px' }}
          />
        </div>
      </div>

      {/* Leverage */}
      <div>
        <label style={labelStyle}>Leverage: {leverage}x</label>
        <input
          type="range"
          min={1} max={50} value={leverage}
          onChange={e => setLeverage(Number(e.target.value))}
          style={{ width: '100%', accentColor: '#3861fb' }}
        />
      </div>

      {/* Reduce only */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a8f98', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={reduceOnly}
          onChange={e => setReduceOnly(e.target.checked)}
        />
        Reduce Only
      </label>

      {/* Margin info */}
      <div style={{ fontSize: 11, color: '#555' }}>
        {marginPreview && <>Margin: ${marginPreview}</>}
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        style={{
          padding: '12px', border: 'none', borderRadius: 8,
          cursor: 'pointer', fontWeight: 700, fontSize: 15,
          background: isBuy ? '#0ecb81' : '#f6465d',
          color: isBuy ? '#0a0e17' : '#fff',
        }}
      >
        {isBuy ? 'Buy/Long' : 'Sell/Short'} {currentAsset}
      </button>

      {error && <div style={{ color: '#f6465d', fontSize: 12 }}>{error}</div>}
      {success && <div style={{ color: '#0ecb81', fontSize: 12 }}>{success}</div>}
    </div>
  );
}
