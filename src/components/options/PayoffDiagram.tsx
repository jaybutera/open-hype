import { useMemo } from 'react';
import type { Leg } from '../../services/options/types.ts';
import { analyticalBreakevens, buildPayoffCurve, expirationExtrema } from '../../services/options/payoff.ts';

interface Props {
  legs: Leg[];
  underlyingPrice: number;
  qtyScalar: number;
  /** Unix seconds used as "today" for the BS curve. Default = process now. */
  nowSec?: number;
  /** Overall rendered width in px. Default 316 (fits the 340px right column). */
  width?: number;
  /** Overall rendered height in px. Default 160. */
  height?: number;
}

const COL_SELL = '#0ecb81'; // green — profit
const COL_BUY = '#f6465d'; // red — loss
const COL_AXIS = '#2a2f3e';
const COL_GRID = '#1a1f2e';
const COL_TEXT = '#8a8f98';
const COL_SPOT = '#3861fb';

function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
  return `${v < 0 ? '-' : ''}$${abs.toFixed(0)}`;
}

function fmtPrice(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(2);
}

export function PayoffDiagram({
  legs, underlyingPrice, qtyScalar, nowSec, width = 316, height = 160,
}: Props) {
  const curve = useMemo(
    () => buildPayoffCurve(legs, underlyingPrice, { qtyScalar, nowSec, samples: 121 }),
    [legs, underlyingPrice, qtyScalar, nowSec],
  );

  const extrema = useMemo(() => expirationExtrema(legs, qtyScalar), [legs, qtyScalar]);

  const breakevens = useMemo(() => {
    const all = analyticalBreakevens(legs, qtyScalar);
    return all.filter((b) => b >= curve.xMin && b <= curve.xMax);
  }, [legs, qtyScalar, curve.xMin, curve.xMax]);

  if (legs.length === 0 || (curve.yMin === 0 && curve.yMax === 0)) {
    return null;
  }

  const padL = 36;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  // Add a ~5% vertical margin so the curves aren't flush with the frame.
  const yMargin = (curve.yMax - curve.yMin) * 0.08 || 1;
  const yMin = curve.yMin - yMargin;
  const yMax = curve.yMax + yMargin;

  const xScale = (price: number) => padL + ((price - curve.xMin) / (curve.xMax - curve.xMin)) * plotW;
  const yScale = (pnl: number) => padT + (1 - (pnl - yMin) / (yMax - yMin)) * plotH;

  // Expiration curve as signed polyline segments so we can color positive green / negative red.
  const pathExp = curve.samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xScale(s.price).toFixed(2)} ${yScale(s.expiration).toFixed(2)}`)
    .join(' ');

  const pathToday = curve.samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xScale(s.price).toFixed(2)} ${yScale(s.today).toFixed(2)}`)
    .join(' ');

  const zeroY = yScale(0);
  const spotX = xScale(underlyingPrice);

  // Filled region above/below the expiration curve, clipped at zero,
  // to give the profit/loss bands their Robinhood-legend feel.
  // Build two fill polygons: one for positive (green) one for negative (red).
  const aboveZero: string[] = [];
  const belowZero: string[] = [];
  aboveZero.push(`${xScale(curve.samples[0].price).toFixed(2)} ${zeroY.toFixed(2)}`);
  belowZero.push(`${xScale(curve.samples[0].price).toFixed(2)} ${zeroY.toFixed(2)}`);
  for (const s of curve.samples) {
    const x = xScale(s.price).toFixed(2);
    const yE = yScale(s.expiration);
    if (s.expiration >= 0) {
      aboveZero.push(`${x} ${yE.toFixed(2)}`);
      belowZero.push(`${x} ${zeroY.toFixed(2)}`);
    } else {
      aboveZero.push(`${x} ${zeroY.toFixed(2)}`);
      belowZero.push(`${x} ${yE.toFixed(2)}`);
    }
  }
  aboveZero.push(
    `${xScale(curve.samples[curve.samples.length - 1].price).toFixed(2)} ${zeroY.toFixed(2)}`,
  );
  belowZero.push(
    `${xScale(curve.samples[curve.samples.length - 1].price).toFixed(2)} ${zeroY.toFixed(2)}`,
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', background: '#0d1117' }}
    >
      {/* Plot frame */}
      <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke={COL_AXIS} />

      {/* Profit/loss fills */}
      <polygon points={aboveZero.join(' ')} fill={COL_SELL} fillOpacity={0.10} />
      <polygon points={belowZero.join(' ')} fill={COL_BUY} fillOpacity={0.10} />

      {/* Max-profit / max-loss zones — contiguous bands where the extremum holds.
          Only shown when the zone spans a real interval (not a single point)
          and is bounded, since unbounded zones collapse to atPrice. */}
      {extrema.maxProfit.bounded && extrema.maxProfit.value > 0
        && extrema.maxProfit.zone.max > extrema.maxProfit.zone.min && (() => {
        const xl = Math.max(curve.xMin, extrema.maxProfit.zone.min);
        const xr = Math.min(curve.xMax, extrema.maxProfit.zone.max);
        if (xr <= xl) return null;
        const zx = xScale(xl);
        const zw = xScale(xr) - zx;
        return (
          <rect
            x={zx} y={padT} width={zw} height={plotH}
            fill={COL_SELL} fillOpacity={0.08}
          />
        );
      })()}
      {extrema.maxLoss.bounded && extrema.maxLoss.value < 0
        && extrema.maxLoss.zone.max > extrema.maxLoss.zone.min && (() => {
        const xl = Math.max(curve.xMin, extrema.maxLoss.zone.min);
        const xr = Math.min(curve.xMax, extrema.maxLoss.zone.max);
        if (xr <= xl) return null;
        const zx = xScale(xl);
        const zw = xScale(xr) - zx;
        return (
          <rect
            x={zx} y={padT} width={zw} height={plotH}
            fill={COL_BUY} fillOpacity={0.08}
          />
        );
      })()}

      {/* Zero line (bold) */}
      <line
        x1={padL} x2={width - padR} y1={zeroY} y2={zeroY}
        stroke={COL_AXIS} strokeWidth={1}
      />

      {/* Spot line */}
      <line
        x1={spotX} x2={spotX} y1={padT} y2={padT + plotH}
        stroke={COL_SPOT} strokeDasharray="2 3" strokeWidth={1}
      />

      {/* Breakeven markers */}
      {breakevens.map((b, i) => (
        <g key={`be${i}`}>
          <line
            x1={xScale(b)} x2={xScale(b)} y1={padT} y2={padT + plotH}
            stroke={COL_TEXT} strokeDasharray="1 2" strokeWidth={1} opacity={0.7}
          />
          <text
            x={xScale(b)} y={padT - 2}
            fontSize={9} fill={COL_TEXT} textAnchor="middle"
          >
            BE {fmtPrice(b)}
          </text>
        </g>
      ))}

      {/* Today curve (dotted) */}
      <path d={pathToday} fill="none" stroke={COL_TEXT} strokeWidth={1} strokeDasharray="3 3" />

      {/* Expiration curve (solid) */}
      <path d={pathExp} fill="none" stroke={COL_TEXT} strokeWidth={1.5} />

      {/* Max profit / max loss horizontal annotations (bounded only) */}
      {extrema.maxProfit.bounded && extrema.maxProfit.value > 0 && (() => {
        const y = yScale(extrema.maxProfit.value);
        if (y < padT || y > padT + plotH) return null;
        return (
          <g>
            <line
              x1={padL} x2={width - padR} y1={y} y2={y}
              stroke={COL_SELL} strokeDasharray="4 3" strokeWidth={1} opacity={0.7}
            />
            <text
              x={width - padR - 2} y={y - 2}
              fontSize={9} fill={COL_SELL} textAnchor="end" fontWeight={600}
            >
              Max +{fmtMoney(extrema.maxProfit.value)}
            </text>
          </g>
        );
      })()}
      {extrema.maxLoss.bounded && extrema.maxLoss.value < 0 && (() => {
        const y = yScale(extrema.maxLoss.value);
        if (y < padT || y > padT + plotH) return null;
        return (
          <g>
            <line
              x1={padL} x2={width - padR} y1={y} y2={y}
              stroke={COL_BUY} strokeDasharray="4 3" strokeWidth={1} opacity={0.7}
            />
            <text
              x={width - padR - 2} y={y + 9}
              fontSize={9} fill={COL_BUY} textAnchor="end" fontWeight={600}
            >
              Max {fmtMoney(extrema.maxLoss.value)}
            </text>
          </g>
        );
      })()}

      {/* Y-axis labels (min / 0 / max) */}
      <text x={padL - 4} y={padT + 8} fontSize={9} fill={COL_TEXT} textAnchor="end">
        {fmtMoney(yMax)}
      </text>
      <text x={padL - 4} y={zeroY + 3} fontSize={9} fill={COL_TEXT} textAnchor="end">
        0
      </text>
      <text x={padL - 4} y={padT + plotH - 1} fontSize={9} fill={COL_TEXT} textAnchor="end">
        {fmtMoney(yMin)}
      </text>

      {/* X-axis labels (min / spot / max) */}
      <text
        x={padL} y={height - 6}
        fontSize={9} fill={COL_TEXT} textAnchor="start"
      >
        {fmtPrice(curve.xMin)}
      </text>
      <text
        x={spotX} y={height - 6}
        fontSize={9} fill={COL_SPOT} textAnchor="middle" fontWeight={700}
      >
        {fmtPrice(underlyingPrice)}
      </text>
      <text
        x={width - padR} y={height - 6}
        fontSize={9} fill={COL_TEXT} textAnchor="end"
      >
        {fmtPrice(curve.xMax)}
      </text>

      {/* Legend */}
      <g transform={`translate(${padL + 4}, ${padT + 4})`}>
        <line x1={0} x2={10} y1={4} y2={4} stroke={COL_TEXT} strokeWidth={1.5} />
        <text x={12} y={7} fontSize={9} fill={COL_TEXT}>Exp</text>
        <line x1={30} x2={40} y1={4} y2={4} stroke={COL_TEXT} strokeWidth={1} strokeDasharray="3 3" />
        <text x={42} y={7} fontSize={9} fill={COL_TEXT}>Today</text>
      </g>

      {/* Unbounded-risk callouts, top-right */}
      {(!extrema.maxProfit.bounded || !extrema.maxLoss.bounded) && (
        <text
          x={width - padR - 2} y={padT + 9}
          fontSize={9} fill={!extrema.maxLoss.bounded ? COL_BUY : COL_SELL}
          textAnchor="end" fontWeight={700}
        >
          {!extrema.maxLoss.bounded ? 'Unlimited loss' : 'Unlimited profit'}
        </text>
      )}
    </svg>
  );
}
