import { useState } from 'react';
import { useChartStore } from '../../store/useChartStore.ts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import type { OrderType } from '../../types/order.ts';
import { useWalletStore } from '../../store/useWalletStore.ts';
import { useLiveAccountStore } from '../../store/useLiveAccountStore.ts';
import { prepareOrder, submitPrepared, placeLivePositionTrigger, type PreparedOrder } from '../../services/hl/liveTrader.ts';
import { NETWORK } from '../../services/hl/network.ts';
import { LiveOrderConfirm } from '../trading/LiveOrderConfirm.tsx';

interface Props {
  engine: PaperEngine;
}

export function OrderConfirmModal({ engine }: Props) {
  const { draftOrder, showConfirm, clearDraft } = useChartStore();
  const activePane = useMarketStore(s => s.panes[s.activePaneId] ?? s.panes.primary);
  const currentAsset = activePane?.asset ?? 'BTC';
  const leverage = useSettingsStore(s => s.leverage);
  const [sizeUsdc, setSizeUsdc] = useState('1000');
  const [error, setError] = useState<string | null>(null);
  const mode = useSettingsStore(s => s.mode);
  const tradingStatus = useWalletStore(s => s.tradingStatus);
  const [prepared, setPrepared] = useState<PreparedOrder | null>(null);
  const [busy, setBusy] = useState(false);

  if (!showConfirm || !draftOrder) return null;
  const isLive = mode === 'live';

  const close = () => { setPrepared(null); setError(null); clearDraft(); };

  const handleLive = async () => {
    setError(null);
    if (tradingStatus !== 'ready') { setError('Connect a wallet and enable trading first'); return; }
    if (draftOrder.type === 'limit') {
      if (!sizeUsdc || parseFloat(sizeUsdc) <= 0) { setError('Enter a size in USDC'); return; }
      try {
        setPrepared(await prepareOrder({
          coin: currentAsset, side: draftOrder.side, size: assetSize, kind: 'limit',
          price: draftOrder.price, leverage,
        }));
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      return;
    }
    // TP/SL on a live position covers the whole position; this modal is the review step.
    setBusy(true);
    const r = await placeLivePositionTrigger(currentAsset, draftOrder.tpsl ?? (draftOrder.type === 'tp' ? 'tp' : 'sl'), draftOrder.price);
    setBusy(false);
    if (r.ok) close(); else setError(r.message);
  };

  const sendPrepared = async () => {
    if (!prepared) return;
    setBusy(true);
    const r = await submitPrepared(prepared);
    setBusy(false);
    if (r.ok) { useSettingsStore.getState().setSizeUsdc(sizeUsdc); close(); }
    else { setPrepared(null); setError(r.message); }
  };
  const livePos = useLiveAccountStore.getState().positions.find(p => p.coin === currentAsset);

  const isReduceOnly = draftOrder.type === 'tp' || draftOrder.type === 'stop';
  const assetSize = parseFloat(sizeUsdc) / draftOrder.price;

  const handleConfirm = () => {
    if (!sizeUsdc || parseFloat(sizeUsdc) <= 0) {
      setError('Enter a size in USDC');
      return;
    }

    let orderType: OrderType;

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

    // For TP/SL, use the full position size so it closes entirely
    let size: string;
    if (isReduceOnly) {
      const pos = engine.getPosition(currentAsset);
      size = pos ? pos.szi.abs().toString() : assetSize.toString();
    } else {
      size = assetSize.toString();
    }

    const result = engine.placeOrder({
      coin: currentAsset,
      side: draftOrder.side,
      price: draftOrder.price.toFixed(2),
      size,
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
    }} onClick={close}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#141820', border: '1px solid #2a2f3e', borderRadius: 0,
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
            padding: '8px 12px', background: '#1a1f2e', borderRadius: 0,
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
              border: '1px solid #2a2f3e', borderRadius: 0, color: '#e1e4e8',
              fontSize: 14, outline: 'none',
            }}
            onKeyDown={e => e.key === 'Enter' && (isLive ? void handleLive() : handleConfirm())}
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

        {isLive && isReduceOnly && (
          <div style={{ fontSize: 12, color: '#8a8f98', marginBottom: 12 }}>
            {livePos ? `Closes the whole ${Math.abs(livePos.szi)} ${currentAsset} position at market when triggered.` : `No open ${currentAsset} position.`}
          </div>
        )}
        {isLive && (
          <div style={{ fontSize: 12, fontWeight: 700, color: NETWORK === 'mainnet' ? '#f6465d' : '#f0b90b', marginBottom: 12 }}>
            {NETWORK === 'mainnet' ? 'Live order on Hyperliquid mainnet' : 'Testnet order'}
          </div>
        )}

        {error && <div role="alert" style={{ color: '#f6465d', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        {prepared ? (
          <LiveOrderConfirm order={prepared} busy={busy} onConfirm={() => void sendPrepared()} onCancel={() => setPrepared(null)} />
        ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn-secondary"
            onClick={close}
            style={{ flex: 1, padding: '10px', fontSize: 14 }}
          >
            Cancel
          </button>
          <button
            className={draftOrder.side === 'buy' ? 'btn-long' : 'btn-short'}
            disabled={busy}
            onClick={() => (isLive ? void handleLive() : handleConfirm())}
            style={{ flex: 1, padding: '10px', fontSize: 14 }}
          >
            {isLive && draftOrder.type === 'limit' ? 'Review ' : ''}{draftOrder.side === 'buy' ? 'Buy/Long' : 'Sell/Short'}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
