import { useMemo } from 'react';

interface Props {
  expirations: number[];
  selected: number | null;
  onSelect: (expiration: number) => void;
  now?: Date;
}

interface TabInfo {
  exp: number;
  label: string;
  dte: number;
}

export function formatExpirationLabel(exp: number, now: Date): { label: string; dte: number } {
  const expMs = exp * 1000;
  const dte = Math.max(0, Math.ceil((expMs - now.getTime()) / 86_400_000));
  const d = new Date(expMs);
  const md = d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
  });
  return { label: `${md} (${dte}d)`, dte };
}

export function ExpirationTabs({ expirations, selected, onSelect, now }: Props) {
  const nowDate = now ?? new Date();
  const tabs = useMemo<TabInfo[]>(
    () =>
      expirations.map((exp) => {
        const { label, dte } = formatExpirationLabel(exp, nowDate);
        return { exp, label, dte };
      }),
    [expirations, nowDate],
  );

  if (!tabs.length) return null;

  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        overflowX: 'auto',
        overflowY: 'hidden',
        padding: '8px 16px',
        borderBottom: '1px solid #1a1f2e',
        background: '#0d1117',
        whiteSpace: 'nowrap',
      }}
    >
      {tabs.map((t) => {
        const active = t.exp === selected;
        return (
          <button
            key={t.exp}
            type="button"
            onClick={() => onSelect(t.exp)}
            style={{
              flex: '0 0 auto',
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              color: active ? '#e1e4e8' : '#8a8f98',
              background: active ? '#1a1f2e' : 'transparent',
              border: `1px solid ${active ? '#3861fb' : '#2a2f3e'}`,
              borderRadius: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: 0.3,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
