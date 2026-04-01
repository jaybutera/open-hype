import { useState } from 'react';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import type { PaperPosition } from '../../engine/paper/positions.ts';
import type { Side } from '../../types/order.ts';

interface Props {
  engine: PaperEngine;
}

function TpSlInput({ position, engine, allMids }: {
  position: PaperPosition;
  engine: PaperEngine;
  allMids: Record<string, string>;
}) {
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [show, setShow] = useState(false);

  const isLong = position.szi.gt(0);
  const closeSide: Side = isLong ? 'sell' : 'buy';
  const size = position.szi.abs().toString();

  const handleSetTp = () => {
    if (!tp) return;
    engine.placeOrder({
      coin: position.coin,
      side: closeSide,
      price: tp,
      size,
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: tp, tpsl: 'tp' } },
    });
    setTp('');
  };

  const handleSetSl = () => {
    if (!sl) return;
    engine.placeOrder({
      coin: position.coin,
      side: closeSide,
      price: sl,
      size,
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: sl, tpsl: 'sl' } },
    });
    setSl('');
  };

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        style={{
          fontSize: 11, background: '#1a1f2e', border: '1px solid #2a2f3e',
          borderRadius: 4, padding: '3px 8px', color: '#8a8f98',
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        + TP/SL
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        value={tp}
        onChange={e => setTp(e.target.value)}
        placeholder="TP"
        style={{
          width: 70, padding: '3px 6px', fontSize: 11, background: '#1a1f2e',
          border: '1px solid #2a2f3e', borderRadius: 4, color: '#0ecb81', outline: 'none',
        }}
        onKeyDown={e => e.key === 'Enter' && handleSetTp()}
      />
      <button onClick={handleSetTp} style={{
        fontSize: 10, background: '#0ecb8130', border: 'none', borderRadius: 3,
        padding: '3px 6px', color: '#0ecb81', cursor: 'pointer',
      }}>Set</button>
      <input
        value={sl}
        onChange={e => setSl(e.target.value)}
        placeholder="SL"
        style={{
          width: 70, padding: '3px 6px', fontSize: 11, background: '#1a1f2e',
          border: '1px solid #2a2f3e', borderRadius: 4, color: '#f6465d', outline: 'none',
        }}
        onKeyDown={e => e.key === 'Enter' && handleSetSl()}
      />
      <button onClick={handleSetSl} style={{
        fontSize: 10, background: '#f6465d30', border: 'none', borderRadius: 3,
        padding: '3px 6px', color: '#f6465d', cursor: 'pointer',
      }}>Set</button>
    </div>
  );
}

export function PositionTable({ engine }: Props) {
  const mode = useSettingsStore(s => s.mode);
  const paperPositions = useAccountStore(s => s.paperPositions);
  const paperOrders = useAccountStore(s => s.paperOrders);
  const paperBalance = useAccountStore(s => s.paperBalance);
  const paperFills = useAccountStore(s => s.paperFills);
  const allMids = useMarketStore(s => s.allMids);

  const positions = mode === 'paper' ? paperPositions : [];
  const orders = mode === 'paper' ? paperOrders : [];

  const handleMarketClose = (coin: string) => {
    const mid = allMids[coin];
    if (!mid) return;
    engine.marketClose(coin, mid);
  };

  // Find TP/SL orders associated with a position
  const getPositionOrders = (coin: string) => {
    return orders.filter(o => o.coin === coin && o.reduceOnly);
  };

  return (
    <div style={{
      background: '#0d1117',
      borderTop: '1px solid #1a1f2e',
      overflowX: 'auto',
      fontSize: 13,
    }}>
      {/* Balance bar */}
      <div style={{
        display: 'flex', gap: 24, padding: '8px 16px',
        borderBottom: '1px solid #1a1f2e', color: '#8a8f98', fontSize: 12,
      }}>
        <span>Balance: <b style={{ color: '#e1e4e8' }}>${parseFloat(paperBalance).toFixed(2)}</b></span>
        <span>Positions: <b style={{ color: '#e1e4e8' }}>{positions.length}</b></span>
        <span>Open Orders: <b style={{ color: '#e1e4e8' }}>{orders.length}</b></span>
      </div>

      <div style={{ display: 'flex' }}>
        {/* Positions section */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            padding: '8px 16px', fontWeight: 600, color: '#e1e4e8',
            borderBottom: '1px solid #1a1f2e', fontSize: 13,
          }}>
            Positions
          </div>
          {positions.length === 0 ? (
            <div style={{ padding: '20px 16px', color: '#555', textAlign: 'center' }}>
              No open positions
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#8a8f98', fontSize: 11 }}>
                  <th style={{ padding: '6px 16px', textAlign: 'left' }}>Asset</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Size</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Entry</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Mark</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>uPnL</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>TP/SL</th>
                  <th style={{ textAlign: 'right', padding: '6px 16px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => {
                  const isLong = pos.szi.gt(0);
                  const mark = allMids[pos.coin] ?? '0';
                  const upnl = pos.unrealizedPnl.toNumber();
                  const posOrders = getPositionOrders(pos.coin);
                  const tpOrder = posOrders.find(o => o.tpsl === 'tp');
                  const slOrder = posOrders.find(o => o.tpsl === 'sl');

                  return (
                    <tr key={pos.coin} style={{ borderBottom: '1px solid #1a1f2e' }}>
                      <td style={{ padding: '8px 16px' }}>
                        <span style={{ color: isLong ? '#0ecb81' : '#f6465d', fontWeight: 600 }}>
                          {pos.coin} {isLong ? 'LONG' : 'SHORT'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px' }}>
                        <div>{pos.szi.abs().toString()}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>
                          ${pos.szi.abs().mul(parseFloat(mark) || 0).toFixed(0)} USDC
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px' }}>
                        ${pos.entryPx.toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px' }}>
                        ${parseFloat(mark).toFixed(2)}
                      </td>
                      <td style={{
                        textAlign: 'right', padding: '8px',
                        color: upnl >= 0 ? '#0ecb81' : '#f6465d',
                        fontWeight: 600,
                      }}>
                        ${upnl.toFixed(2)}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {tpOrder && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                              <span style={{ color: '#0ecb81' }}>TP ${(tpOrder.triggerPx ?? tpOrder.price).toFixed(1)}</span>
                              <button
                                onClick={() => engine.cancelOrder(tpOrder.id)}
                                style={{ fontSize: 9, background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}
                              >x</button>
                            </div>
                          )}
                          {slOrder && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                              <span style={{ color: '#f6465d' }}>SL ${(slOrder.triggerPx ?? slOrder.price).toFixed(1)}</span>
                              <button
                                onClick={() => engine.cancelOrder(slOrder.id)}
                                style={{ fontSize: 9, background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}
                              >x</button>
                            </div>
                          )}
                          {(!tpOrder || !slOrder) && (
                            <TpSlInput position={pos} engine={engine} allMids={allMids} />
                          )}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 16px' }}>
                        <button
                          onClick={() => handleMarketClose(pos.coin)}
                          style={{
                            fontSize: 12, background: '#f6465d20', border: '1px solid #f6465d40',
                            borderRadius: 4, padding: '5px 12px', color: '#f6465d',
                            cursor: 'pointer', fontWeight: 600,
                          }}
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Orders section */}
        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid #1a1f2e' }}>
          <div style={{
            padding: '8px 16px', fontWeight: 600, color: '#e1e4e8',
            borderBottom: '1px solid #1a1f2e', fontSize: 13,
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Open Orders</span>
            {orders.length > 0 && (
              <button
                onClick={() => engine.cancelAllOrders()}
                style={{
                  fontSize: 11, background: 'none', border: 'none',
                  color: '#f6465d', cursor: 'pointer',
                }}
              >
                Cancel All
              </button>
            )}
          </div>
          {orders.length === 0 ? (
            <div style={{ padding: '20px 16px', color: '#555', textAlign: 'center' }}>
              No open orders
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#8a8f98', fontSize: 11 }}>
                  <th style={{ padding: '6px 16px', textAlign: 'left' }}>Asset</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Type</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Price</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Size</th>
                  <th style={{ textAlign: 'right', padding: '6px 16px' }}></th>
                </tr>
              </thead>
              <tbody>
                {orders.map(ord => (
                  <tr key={ord.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                    <td style={{ padding: '8px 16px' }}>
                      <span style={{ color: ord.side === 'buy' ? '#0ecb81' : '#f6465d' }}>
                        {ord.coin} {ord.side.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '8px' }}>
                      {ord.tpsl ? ord.tpsl.toUpperCase() : ord.type.toUpperCase()}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px' }}>
                      ${(ord.triggerPx ?? ord.price).toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px' }}>{ord.size.toString()}</td>
                    <td style={{ textAlign: 'right', padding: '8px 16px' }}>
                      <button
                        onClick={() => engine.cancelOrder(ord.id)}
                        style={{
                          fontSize: 11, background: '#2a2f3e', border: 'none',
                          borderRadius: 4, padding: '3px 8px', color: '#f6465d',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Recent Fills */}
      {paperFills.length > 0 && (
        <div style={{ borderTop: '1px solid #1a1f2e' }}>
          <div style={{ padding: '8px 16px', fontWeight: 600, color: '#e1e4e8', fontSize: 13 }}>
            Recent Fills
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#8a8f98', fontSize: 11 }}>
                <th style={{ padding: '4px 16px', textAlign: 'left' }}>Asset</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Side</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Price</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Size</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Fee</th>
                <th style={{ textAlign: 'right', padding: '4px 16px' }}>PnL</th>
              </tr>
            </thead>
            <tbody>
              {[...paperFills].reverse().slice(0, 10).map(fill => {
                const pnl = parseFloat(fill.realizedPnl);
                return (
                  <tr key={fill.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                    <td style={{ padding: '6px 16px' }}>{fill.coin}</td>
                    <td style={{
                      padding: '6px 8px',
                      color: fill.side === 'buy' ? '#0ecb81' : '#f6465d',
                    }}>
                      {fill.side.toUpperCase()}
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>${parseFloat(fill.price).toFixed(2)}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>{fill.size}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px', color: '#8a8f98' }}>${parseFloat(fill.fee).toFixed(4)}</td>
                    <td style={{
                      textAlign: 'right', padding: '6px 16px',
                      color: pnl >= 0 ? '#0ecb81' : '#f6465d',
                    }}>
                      {pnl !== 0 ? `$${pnl.toFixed(2)}` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
