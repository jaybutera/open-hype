import type { Leg, OptionContract } from '../../services/options/types.ts';
import { hasLeg } from '../../services/options/legs.ts';
import {
  type ChainMetricKey,
  formatMetricValue,
} from '../../services/options/chainMetrics.ts';

interface Props {
  strike: number;
  call?: OptionContract;
  put?: OptionContract;
  underlyingPrice: number;
  legs: Leg[];
  onCellClick: (contract: OptionContract, side: 'buy' | 'sell') => void;
  atCapacity: boolean;
  metrics: [ChainMetricKey, ChainMetricKey];
  nowSec?: number;
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toFixed(2);
}

const ROW_BORDER = '1px solid #1a1f2e';
const ITM_BG = 'rgba(56,97,251,0.05)';

const LEFT_ALIGN: React.CSSProperties = { textAlign: 'left', padding: '6px 8px' };
const RIGHT_ALIGN: React.CSSProperties = { textAlign: 'right', padding: '6px 8px' };
const CENTER: React.CSSProperties = { textAlign: 'center', padding: '6px 8px' };

const BID_COLOR = '#0ecb81';
const ASK_COLOR = '#f6465d';
const SELECTED_BID_BG = 'rgba(14,203,129,0.22)';
const SELECTED_ASK_BG = 'rgba(246,70,93,0.22)';

function tradeCellStyle(params: {
  base: React.CSSProperties;
  itm: boolean;
  side: 'buy' | 'sell';
  selected: boolean;
  priced: boolean;
  interactive: boolean;
}): React.CSSProperties {
  const { base, itm, side, selected, priced, interactive } = params;
  const color = priced ? (side === 'sell' ? BID_COLOR : ASK_COLOR) : '#3d4250';
  let background: string = itm ? ITM_BG : 'transparent';
  if (selected) {
    background = side === 'sell' ? SELECTED_BID_BG : SELECTED_ASK_BG;
  }
  return {
    ...base,
    background,
    color,
    fontWeight: 600,
    cursor: interactive ? 'pointer' : 'default',
    userSelect: 'none',
    outline: selected
      ? `1px solid ${side === 'sell' ? BID_COLOR : ASK_COLOR}`
      : 'none',
    outlineOffset: selected ? -1 : 0,
  };
}

export function ChainRow({
  strike,
  call,
  put,
  underlyingPrice,
  legs,
  onCellClick,
  atCapacity,
  metrics,
  nowSec,
}: Props) {
  const callItm = call?.inTheMoney ?? strike < underlyingPrice;
  const putItm = put?.inTheMoney ?? strike > underlyingPrice;

  const callBidSelected = !!call && hasLeg(legs, call, 'sell');
  const callAskSelected = !!call && hasLeg(legs, call, 'buy');
  const putBidSelected = !!put && hasLeg(legs, put, 'sell');
  const putAskSelected = !!put && hasLeg(legs, put, 'buy');

  const callBidInteractive = !!call && call.bid > 0 && (!atCapacity || callBidSelected || callAskSelected);
  const callAskInteractive = !!call && call.ask > 0 && (!atCapacity || callAskSelected || callBidSelected);
  const putBidInteractive = !!put && put.bid > 0 && (!atCapacity || putBidSelected || putAskSelected);
  const putAskInteractive = !!put && put.ask > 0 && (!atCapacity || putAskSelected || putBidSelected);

  const capMsg = 'At 4-leg cap — remove a leg first';
  const callBidTitle = call
    ? callBidInteractive
      ? `Sell call @ bid ${fmtPrice(call.bid)}`
      : atCapacity && call.bid > 0
        ? capMsg
        : undefined
    : undefined;
  const callAskTitle = call
    ? callAskInteractive
      ? `Buy call @ ask ${fmtPrice(call.ask)}`
      : atCapacity && call.ask > 0
        ? capMsg
        : undefined
    : undefined;
  const putBidTitle = put
    ? putBidInteractive
      ? `Sell put @ bid ${fmtPrice(put.bid)}`
      : atCapacity && put.bid > 0
        ? capMsg
        : undefined
    : undefined;
  const putAskTitle = put
    ? putAskInteractive
      ? `Buy put @ ask ${fmtPrice(put.ask)}`
      : atCapacity && put.ask > 0
        ? capMsg
        : undefined
    : undefined;

  const metricCtx = { underlyingPrice, nowSec };
  const [metricA, metricB] = metrics;

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
        {formatMetricValue(metricA, call, metricCtx)}
      </td>
      <td style={{ ...RIGHT_ALIGN, background: callItm ? ITM_BG : 'transparent', color: '#8a8f98' }}>
        {formatMetricValue(metricB, call, metricCtx)}
      </td>
      <td
        style={tradeCellStyle({
          base: RIGHT_ALIGN,
          itm: callItm,
          side: 'sell',
          selected: callBidSelected,
          priced: !!call && call.bid > 0,
          interactive: callBidInteractive,
        })}
        title={callBidTitle}
        onClick={callBidInteractive ? () => onCellClick(call!, 'sell') : undefined}
      >
        {call ? fmtPrice(call.bid) : ''}
      </td>
      <td
        style={tradeCellStyle({
          base: RIGHT_ALIGN,
          itm: callItm,
          side: 'buy',
          selected: callAskSelected,
          priced: !!call && call.ask > 0,
          interactive: callAskInteractive,
        })}
        title={callAskTitle}
        onClick={callAskInteractive ? () => onCellClick(call!, 'buy') : undefined}
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
        style={tradeCellStyle({
          base: LEFT_ALIGN,
          itm: putItm,
          side: 'sell',
          selected: putBidSelected,
          priced: !!put && put.bid > 0,
          interactive: putBidInteractive,
        })}
        title={putBidTitle}
        onClick={putBidInteractive ? () => onCellClick(put!, 'sell') : undefined}
      >
        {put ? fmtPrice(put.bid) : ''}
      </td>
      <td
        style={tradeCellStyle({
          base: LEFT_ALIGN,
          itm: putItm,
          side: 'buy',
          selected: putAskSelected,
          priced: !!put && put.ask > 0,
          interactive: putAskInteractive,
        })}
        title={putAskTitle}
        onClick={putAskInteractive ? () => onCellClick(put!, 'buy') : undefined}
      >
        {put ? fmtPrice(put.ask) : ''}
      </td>
      <td style={{ ...LEFT_ALIGN, background: putItm ? ITM_BG : 'transparent', color: '#8a8f98' }}>
        {formatMetricValue(metricB, put, metricCtx)}
      </td>
      <td style={{ ...LEFT_ALIGN, background: putItm ? ITM_BG : 'transparent', color: '#8a8f98' }}>
        {formatMetricValue(metricA, put, metricCtx)}
      </td>
    </tr>
  );
}
