import { useState } from 'react';
import { useChartStore } from '../../store/useChartStore.ts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import type { OrderType } from '../../types/order.ts';

interface Props {
  engine: PaperEngine;
}

export function OrderConfirmModal({ engine }: Props) {
  const { draftOrder, showConfirm, clearDraft } = useChartStore();
  const currentAsset = useMarketStore(s => s.currentAsset);
  const leverage = useSettingsStore(s => s.leverage);
  const [sizeUsdc, setSizeUsdc] = useState('1000');
  const [error, setError] = useState<string | null>(null);

  if (!showConfirm || !draftOrder) return null;

  const assetSize = parseFloat(sizeUsdc) / draftOrder.price;

  const handleConfirm = () => {
    if (!sizeUsdc || parseFloat(sizeUsdc) <= 0) {
      setError('Enter a size in USDC');
      return;
    }

    let orderType: OrderType;
    const isReduceOnly = draftOrder.type === 'tp' || draftOrder.type === 'stop';

    if (draftOrder.type === 'limit') {
      orderType = { limit: { tif: 'Gtc' } };
    } else {
      orderType = {
        trigger: {
          isMarket: true,
          triggerPx: draftOrder.price.toFixed(2),
          tpsl: draftOrder.tpsl ?? (draftOrder.type === 'tp' ? 'tp' : 'sl'),
        },
      };
    }

    const result = engine.placeOrder({
      coin: currentAsset,
      side: draftOrder.side,
      price: draftOrder.price.toFixed(2),
      size: assetSize.toString(),
      reduceOnly: isReduceOnly,
      orderType,
    });

    if (result.success) {
      // Also save this size to the store so future shift+clicks skip the modal
      useSettingsStore.getState().setSizeUsdc(sizeUsdc);
      clearDraft();
      setError(null);
    } else {
      setError(result.error ?? 'Order failed');
    }
  };

  const typeLabel = draftOrder.type === 'limit'
    ? 'Limit'
    : draftOrder.type === 'tp' ? 'Take Profit' : 'Stop Loss';

  const sideColor = draftOrder.side === 'buy' ? '#0ecb81' : '#f6465d';

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={clearDraft}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#141820', border: '1px solid #2a2f3e', borderRadius: 12,
          padding: 24, width: 340,
        }}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#e1e4e8' }}>
          {typeLabel} {draftOrder.side.toUpperCase()} {currentAsset}
        </h3>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#8a8f98', display: 'block', marginBottom: 4 }}>
            Price
          </label>
          <div style={{
            padding: '8px 12px', background: '#1a1f2e', borderRadius: 6,
            color: sideColor, fontWeight: 600, fontSize: 14,
          }}>
            ${draftOrder.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#8a8f98', display: 'block', marginBottom: 4 }}>
            Size (USDC)
          </label>
          <input
            autoFocus
            value={sizeUsdc}
            onChange={e => setSizeUsdc(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', background: '#1a1f2e',
              border: '1px solid #2a2f3e', borderRadius: 6, color: '#e1e4e8',
              fontSize: 14, outline: 'none',
            }}
            onKeyDown={e => e.key === 'Enter' && handleConfirm()}
          />
          {assetSize > 0 && (
            <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>
              ~ {assetSize.toPrecision(6)} {currentAsset}
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: '#8a8f98', marginBottom: 16 }}>
          Leverage: {leverage}x | Margin: ${(parseFloat(sizeUsdc || '0') / leverage).toFixed(2)}
        </div>

        {error && <div style={{ color: '#f6465d', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={clearDraft}
            style={{
              flex: 1, padding: '10px', background: '#2a2f3e', border: 'none',
              borderRadius: 6, color: '#8a8f98', cursor: 'pointer', fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={{
              flex: 1, padding: '10px', background: sideColor, border: 'none',
              borderRadius: 6, color: draftOrder.side === 'buy' ? '#0a0e17' : '#fff',
              cursor: 'pointer', fontSize: 14, fontWeight: 600,
            }}
          >
            {draftOrder.side === 'buy' ? 'Buy/Long' : 'Sell/Short'}
          </button>
        </div>
      </div>
    </div>
  );
}
