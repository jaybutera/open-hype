import { useEffect } from 'react';
import { Header } from './Header.tsx';
import { TradingChart } from '../chart/TradingChart.tsx';
import { OrderPanel } from '../trading/OrderPanel.tsx';
import { PositionTable } from '../positions/PositionTable.tsx';
import { OrderConfirmModal } from '../modals/OrderConfirmModal.tsx';
import { useMarketStore } from '../../store/useMarketStore.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';

interface Props {
  engine: PaperEngine;
}

export function AppLayout({ engine }: Props) {
  const splitView = useMarketStore(s => s.splitView);
  const secondaryPane = useMarketStore(s => s.panes.secondary);
  const loadCandles = useMarketStore(s => s.loadCandles);

  // When split view opens with no candles for secondary yet, fetch them.
  // Re-runs if the secondary pane is recreated (toggle off→on).
  useEffect(() => {
    if (splitView && secondaryPane && secondaryPane.candles.length === 0 && !secondaryPane.loading) {
      loadCandles('secondary');
    }
  }, [splitView, secondaryPane?.asset, secondaryPane?.interval]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TradingChart engine={engine} paneId="primary" />
          </div>
          {splitView && secondaryPane && (
            <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid #1a1f2e' }}>
              <TradingChart engine={engine} paneId="secondary" />
            </div>
          )}
        </div>
        <OrderPanel engine={engine} />
      </div>

      <PositionTable engine={engine} />

      <OrderConfirmModal engine={engine} />
    </div>
  );
}
