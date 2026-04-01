import { Header } from './Header.tsx';
import { TradingChart } from '../chart/TradingChart.tsx';
import { OrderPanel } from '../trading/OrderPanel.tsx';
import { PositionTable } from '../positions/PositionTable.tsx';
import { OrderConfirmModal } from '../modals/OrderConfirmModal.tsx';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';

interface Props {
  engine: PaperEngine;
}

export function AppLayout({ engine }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />

      {/* Main area: chart + order panel */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TradingChart engine={engine} />
        </div>
        <OrderPanel engine={engine} />
      </div>

      {/* Bottom: positions/orders */}
      <PositionTable engine={engine} />

      {/* Order confirmation modal */}
      <OrderConfirmModal engine={engine} />
    </div>
  );
}
