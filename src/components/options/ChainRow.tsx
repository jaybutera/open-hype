import type { OptionContract } from '../../services/options/types.ts';

interface Props {
  strike: number;
  call?: OptionContract;
  put?: OptionContract;
  underlyingPrice: number;
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toFixed(2);
}

function fmtIv(iv: number): string {
  if (!Number.isFinite(iv) || iv <= 0) return '—';
  // IV is a decimal (0.33 = 33%). Clamp absurd values (deep OTM/ITM wings can
  // have 40+). Display only reliable regime; flag the rest with `*`.
  if (iv > 5) return `${(iv * 100).toFixed(0)}%*`;
  return `${(iv * 100).toFixed(1)}%`;
}

function fmtInt(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

const ROW_BORDER = '1px solid #1a1f2e';
const ITM_BG = 'rgba(56,97,251,0.05)';

const LEFT_ALIGN: React.CSSProperties = { textAlign: 'left', padding: '6px 8px' };
const RIGHT_ALIGN: React.CSSProperties = { textAlign: 'right', padding: '6px 8px' };
const CENTER: React.CSSProperties = { textAlign: 'center', padding: '6px 8px' };

const BID_COLOR = '#0ecb81';
const ASK_COLOR = '#f6465d';

export function ChainRow({ strike, call, put, underlyingPrice }: Props) {
  const callItm = call?.inTheMoney ?? strike < underlyingPrice;
  const putItm = put?.inTheMoney ?? strike > underlyingPrice;

  return (
    <tr
      style={{
        borderBottom: ROW_BORDER,
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      {/* CALL side (left) */}
      <td style={{ ...RIGHT_ALIGN, background: callItm ? ITM_BG : 'transparent', color: '#8a8f98' }}>
        {call ? fmtIv(call.iv) : ''}
      </td>
      <td style={{ ...RIGHT_ALIGN, background: callItm ? ITM_BG : 'transparent', color: '#8a8f98' }}>
        {call ? fmtInt(call.openInterest) : ''}
      </td>
      <td
        style={{
          ...RIGHT_ALIGN,
          background: callItm ? ITM_BG : 'transparent',
          color: call && call.bid > 0 ? BID_COLOR : '#3d4250',
          fontWeight: 600,
        }}
        title={call ? `Sell call @ bid ${fmtPrice(call.bid)}` : undefined}
      >
        {call ? fmtPrice(call.bid) : ''}
      </td>
      <td
        style={{
          ...RIGHT_ALIGN,
          background: callItm ? ITM_BG : 'transparent',
          color: call && call.ask > 0 ? ASK_COLOR : '#3d4250',
          fontWeight: 600,
        }}
        title={call ? `Buy call @ ask ${fmtPrice(call.ask)}` : undefined}
      >
        {call ? fmtPrice(call.ask) : ''}
      </td>

      {/* STRIKE (center) */}
      <td
        style={{
          ...CENTER,
          background: '#0d1117',
          color: '#e1e4e8',
          fontWeight: 700,
          borderLeft: ROW_BORDER,
          borderRight: ROW_BORDER,
          minWidth: 72,
        }}
      >
        {strike.toFixed(strike % 1 === 0 ? 0 : 2)}
      </td>

      {/* PUT side (right) */}
      <td
        style={{
          ...LEFT_ALIGN,
          background: putItm ? ITM_BG : 'transparent',
          color: put && put.bid > 0 ? BID_COLOR : '#3d4250',
          fontWeight: 600,
        }}
        title={put ? `Sell put @ bid ${fmtPrice(put.bid)}` : undefined}
      >
        {put ? fmtPrice(put.bid) : ''}
      </td>
      <td
        style={{
          ...LEFT_ALIGN,
          background: putItm ? ITM_BG : 'transparent',
          color: put && put.ask > 0 ? ASK_COLOR : '#3d4250',
          fontWeight: 600,
        }}
        title={put ? `Buy put @ ask ${fmtPrice(put.ask)}` : undefined}
      >
        {put ? fmtPrice(put.ask) : ''}
      </td>
      <td style={{ ...LEFT_ALIGN, background: putItm ? ITM_BG : 'transparent', color: '#8a8f98' }}>
        {put ? fmtInt(put.openInterest) : ''}
      </td>
      <td style={{ ...LEFT_ALIGN, background: putItm ? ITM_BG : 'transparent', color: '#8a8f98' }}>
        {put ? fmtIv(put.iv) : ''}
      </td>
    </tr>
  );
}

