import { useEffect, useState, Component, type ReactNode } from 'react';
import { AppLayout } from './components/layout/AppLayout.tsx';
import { useMarketStore } from './store/useMarketStore.ts';
import { usePaperEngine } from './hooks/useEngine.ts';
import { useWebSocket } from './hooks/useWebSocket.ts';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#f6465d', fontFamily: 'monospace' }}>
          <h2>Runtime Error</h2>
          <pre style={{ marginTop: 16, color: '#e1e4e8' }}>{this.state.error}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '8px 16px', background: '#2a2f3e', border: 'none', borderRadius: 6, color: '#e1e4e8', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const engine = usePaperEngine();
  const [ready, setReady] = useState(false);

  useWebSocket(engine);

  useEffect(() => {
    const init = async () => {
      try {
        await useMarketStore.getState().loadMeta();
        await useMarketStore.getState().loadAllMids();
        await useMarketStore.getState().loadCandles();
      } catch (e) {
        console.error('Init failed:', e);
      }
      setReady(true);
    };
    init();
  }, []);

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#8a8f98' }}>
        Loading market data...
      </div>
    );
  }

  return <AppLayout engine={engine} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
