import { useState, useEffect, useRef } from 'react';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useTradeSetupStore } from '../../store/useTradeSetupStore.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import type { OrderType, Side } from '../../types/order.ts';
import { useWalletStore } from '../../store/useWalletStore.ts';
import { prepareOrder, submitPrepared, type LiveOrderInput, type PreparedOrder } from '../../services/hl/liveTrader.ts';
import { LiveOrderConfirm } from './LiveOrderConfirm.tsx';
import { AiOverlayPanel } from './AiOverlayPanel.tsx';
import { AiTradePanel } from './AiTradePanel.tsx';
import { AlertPanel } from './AlertPanel.tsx';

interface Props {
  engine: PaperEngine;
}

const inputStyle = {
  width: '100%', padding: '8px 10px', background: '#1a1f2e',
  border: '1px solid #2a2f3e', borderRadius: 0, color: '#e1e4e8',
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
  const activePane = useMarketStore(s => s.panes[s.activePaneId] ?? s.panes.primary);
  const currentAsset = activePane?.asset ?? 'BTC';
  const allMids = useMarketStore(s => s.allMids);
  const maxLeverageFor = useMarketStore(s => s.maxLeverageFor);
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
  const mode = useSettingsStore(s => s.mode);
  const tradingStatus = useWalletStore(s => s.tradingStatus);
  const walletAddress = useWalletStore(s => s.address);
  const subAccount = useWalletStore(s => s.subAccount);
  const isLive = mode === 'live';
  const [pendingLive, setPendingLive] = useState<{ order: PreparedOrder; setupId?: string } | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
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
  const assetMaxLeverage = maxLeverageFor(currentAsset);

  // Clamp leverage to the active asset's cap (e.g. switching from a 50x to a 10x asset).
  useEffect(() => {
    if (leverage > assetMaxLeverage) setLeverage(assetMaxLeverage);
  }, [assetMaxLeverage, leverage, setLeverage]);

  // A staged live order belongs to the asset/mode it was built for.
  useEffect(() => { setPendingLive(null); }, [currentAsset, mode, walletAddress, subAccount]);

  const stageLive = async (input: LiveOrderInput, setupId?: string) => {
    setError(null);
    setSuccess(null);
    if (tradingStatus !== 'ready') {
      setError(walletAddress ? 'Enable trading in the wallet menu first' : 'Connect a wallet first');
      return;
    }
    try {
      setPendingLive({ order: await prepareOrder(input), setupId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Setup Execute in live mode: no confirm card, the order goes straight to the exchange. */
  const executeLive = async (input: LiveOrderInput, setupId: string) => {
    setError(null);
    setSuccess(null);
    if (tradingStatus !== 'ready') {
      setError(walletAddress ? 'Enable trading in the wallet menu first' : 'Connect a wallet first');
      return;
    }
    setLiveBusy(true);
    try {
      const r = await submitPrepared(await prepareOrder(input));
      if (r.ok) { removeSetup(setupId); setSuccess(r.message); } else setError(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLiveBusy(false);
    }
  };

  const confirmLive = async () => {
    if (!pendingLive) return;
    setLiveBusy(true);
    const r = await submitPrepared(pendingLive.order);
    setLiveBusy(false);
    if (r.ok && pendingLive.setupId) removeSetup(pendingLive.setupId);
    setPendingLive(null);
    if (r.ok) setSuccess(r.message); else setError(r.message);
  };

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
    const setupAsset = setup.asset ?? currentAsset;

    if (isLive) {
      void executeLive({
        coin: setupAsset, side: setup.side, size: assetSize, kind: 'limit', price: setup.entryPrice,
        tp: setup.tpPrice, sl: setup.slPrice, leverage,
      }, id);
      return;
    }

    // A risk-capped position with a tight stop can imply a large notional. The
    // loss is still bounded at `risk`, but margin = notional / leverage may
    // exceed available balance at the current leverage. Auto-bump leverage
    // toward the asset's cap so the trade fits rather than failing outright.
    const notional = assetSize * setup.entryPrice;
    const available = parseFloat(engine.getAvailableBalance()) || 0;
    const cap = maxLeverageFor(setupAsset);
    if (available > 0 && notional / leverage > available) {
      const neededLev = Math.ceil(notional / available);
      if (neededLev > cap) {
        setError(
          `Position too large: notional $${notional.toFixed(0)} needs ${neededLev}x ` +
          `but ${setupAsset} caps at ${cap}x (margin $${(notional / cap).toFixed(2)} > available $${available.toFixed(2)}). ` +
          `Widen the stop or lower risk.`,
        );
        return;
      }
      const bumped = Math.min(cap, neededLev);
      if (bumped !== leverage) {
        setLeverage(bumped);
        engine.setLeverage(bumped);
      }
    }

    const errors: string[] = [];

    const r1 = engine.placeOrder({
      coin: setupAsset,
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

    const entryOid = r1.oid as string;

    const r2 = engine.placeOrder({
      coin: setupAsset,
      side: closeSide,
      price: setup.tpPrice.toFixed(2),
      size: sizeStr,
      reduceOnly: false,
      orderType: { trigger: { isMarket: true, triggerPx: setup.tpPrice.toFixed(2), tpsl: 'tp' } },
      parentOid: entryOid,
    });
    if (!r2.success) errors.push(`TP: ${r2.error}`);

    const r3 = engine.placeOrder({
      coin: setupAsset,
      side: closeSide,
      price: setup.slPrice.toFixed(2),
      size: sizeStr,
      reduceOnly: false,
      orderType: { trigger: { isMarket: true, triggerPx: setup.slPrice.toFixed(2), tpsl: 'sl' } },
      parentOid: entryOid,
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

  // Execute clicked on the chart's trade box: run it here, then scroll the
  // outcome (live confirm card, error, success) into view, since the chart
  // is not where the card renders.
  const executeSetupRef = useRef(handleExecuteSetup);
  executeSetupRef.current = handleExecuteSetup;
  const scrollOnOutcomeRef = useRef(false);
  const liveConfirmRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const executeRequest = useTradeSetupStore(s => s.executeRequest);
  useEffect(() => {
    if (!executeRequest) return;
    const req = useTradeSetupStore.getState().takeExecuteRequest();
    if (!req) return; // another OrderPanel took it
    scrollOnOutcomeRef.current = true;
    executeSetupRef.current(req.id);
  }, [executeRequest]);
  useEffect(() => {
    if (!scrollOnOutcomeRef.current) return;
    const el = (pendingLive && liveConfirmRef.current) || (error && errorRef.current) || (success && successRef.current);
    if (!el) return;
    scrollOnOutcomeRef.current = false;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [pendingLive, error, success]);

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

    if (isLive) {
      void stageLive({
        coin: currentAsset, side, size: assetSize, kind: orderType,
        price: orderType === 'limit' ? price : undefined, reduceOnly,
        tp: tpPrice || undefined, sl: slPrice || undefined, leverage,
      });
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
          className={`btn-long${isBuy ? ' filled' : ''}`}
          onClick={() => setSide('buy')}
          style={{ flex: 1, padding: '10px', fontSize: 14 }}
        >
          Long
        </button>
        <button
          className={`btn-short${!isBuy ? ' filled' : ''}`}
          onClick={() => setSide('sell')}
          style={{ flex: 1, padding: '10px', fontSize: 14 }}
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
          className="btn-long"
          onClick={() => startSetup('buy')}
          disabled={!!pendingSetup}
          style={{ flex: 1, padding: '8px', fontSize: 12 }}
        >
          Set Up Long
        </button>
        <button
          className="btn-short"
          onClick={() => startSetup('sell')}
          disabled={!!pendingSetup}
          style={{ flex: 1, padding: '8px', fontSize: 12 }}
        >
          Set Up Short
        </button>
      </div>
      {pendingSetup && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: pendingSetup.side === 'buy' ? 'var(--up)' : 'var(--down)' }}>
            Click chart: {pendingSetup.clicks.length}/3 levels
          </span>
          <button
            className="btn-ghost"
            onClick={clearPending}
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Active trade setups */}
      {activeSetups.map(setup => (
        <div key={setup.id} style={{
          background: '#1a1f2e', borderRadius: 0, padding: '8px 10px',
          fontSize: 11, color: '#e1e4e8',
          borderLeft: `2px solid ${setup.side === 'buy' ? 'var(--up)' : 'var(--down)'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: setup.side === 'buy' ? 'var(--up)' : 'var(--down)' }}>
              {setup.side === 'buy' ? 'LONG' : 'SHORT'} {setup.asset ?? currentAsset}
            </span>
            <span style={{ color: '#8a8f98' }}>R:R {setup.rr.toFixed(1)}</span>
          </div>
          <div>Entry: {setup.entryPrice.toFixed(2)} | Size: {setup.assetSize.toPrecision(4)}</div>
          <div>
            <span style={{ color: 'var(--up)' }}>TP: {setup.tpPrice.toFixed(2)} (+${setup.potentialPnl.toFixed(2)})</span>
            {' · '}
            <span style={{ color: 'var(--down)' }}>SL: {setup.slPrice.toFixed(2)} (-${setup.potentialLoss.toFixed(2)})</span>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <button
              className="btn-long"
              onClick={() => handleExecuteSetup(setup.id)}
              style={{ flex: 1, padding: '5px', fontSize: 11, fontWeight: 700 }}
            >
              Execute
            </button>
            <button
              className="btn-short"
              onClick={() => removeSetup(setup.id)}
              style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700 }}
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
            className={`btn-toggle${orderType === t ? ' active' : ''}`}
            onClick={() => setOrderType(t)}
            style={{ flex: 1, padding: '6px', fontSize: 12 }}
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
          <label style={{ ...labelStyle, color: 'var(--up)' }}>Take Profit</label>
          <input
            value={tpPrice}
            onChange={e => setTpPrice(e.target.value)}
            placeholder="TP price"
            style={{ ...inputStyle, fontSize: 12, padding: '6px 8px' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ ...labelStyle, color: 'var(--down)' }}>Stop Loss</label>
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
        <label style={labelStyle}>Leverage: {leverage}x <span style={{ color: '#555' }}>(max {assetMaxLeverage}x)</span></label>
        <input
          type="range"
          min={1} max={assetMaxLeverage} value={leverage}
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
      {pendingLive ? (
        <div ref={liveConfirmRef}>
          <LiveOrderConfirm order={pendingLive.order} busy={liveBusy} onConfirm={() => void confirmLive()} onCancel={() => setPendingLive(null)} />
        </div>
      ) : (
        <button
          className={isBuy ? 'btn-long' : 'btn-short'}
          onClick={handleSubmit}
          style={{ padding: '12px', fontWeight: 700, fontSize: 15 }}
        >
          {isLive ? 'Review ' : ''}{isBuy ? 'Buy/Long' : 'Sell/Short'} {currentAsset}
        </button>
      )}
      {isLive && tradingStatus !== 'ready' && (
        <div style={{ fontSize: 11, color: '#f0b90b' }}>
          {walletAddress ? 'Live: enable trading in the wallet menu to place orders' : 'Live: connect a wallet to place orders'}
        </div>
      )}

      {error && <div ref={errorRef} style={{ color: 'var(--down)', fontSize: 12 }}>{error}</div>}
      {success && <div ref={successRef} style={{ color: 'var(--up)', fontSize: 12 }}>{success}</div>}

      <AiTradePanel />
      <AiOverlayPanel />
      <AlertPanel />
    </div>
  );
}
