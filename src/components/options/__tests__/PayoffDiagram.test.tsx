// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PayoffDiagram } from '../PayoffDiagram.tsx';
import type { Leg, OptionContract, OptionType } from '../../../services/options/types.ts';

const NOW_SEC = 1_700_000_000; // 2023-11-14; expirations use 1_800_000_000 → ~3.17 years.

function contract(
  partial: Partial<OptionContract> & { type: OptionType; strike: number },
): OptionContract {
  const typeChar = partial.type === 'call' ? 'C' : 'P';
  return {
    symbol: `T${typeChar}${partial.strike}`,
    underlying: 'T',
    expiration: 1_800_000_000,
    bid: 1,
    ask: 1.1,
    last: 1.05,
    iv: 0.3,
    volume: 0,
    openInterest: 0,
    inTheMoney: false,
    ...partial,
  };
}

function leg(side: 'buy' | 'sell', c: OptionContract, qty = 1): Leg {
  return { side, contract: c, qty };
}

// Utility: count SVG elements of a given tag inside the rendered diagram.
function countTag(container: HTMLElement, tag: string): number {
  return container.querySelectorAll(tag).length;
}

describe('PayoffDiagram — guard paths', () => {
  it('renders nothing when legs is empty', () => {
    const { container } = render(
      <PayoffDiagram legs={[]} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders an svg of the requested width/height when legs are present', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    const { container } = render(
      <PayoffDiagram
        legs={[leg('buy', c)]}
        underlyingPrice={100}
        qtyScalar={1}
        nowSec={NOW_SEC}
        width={400}
        height={200}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('400');
    expect(svg?.getAttribute('height')).toBe('200');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 400 200');
  });
});

describe('PayoffDiagram — long call (unbounded profit, bounded loss)', () => {
  // mid = 2, strike = 100. BE at expiration = K + premium = 102. Profit unbounded
  // to the right, loss bounded at -premium × 100 = -$200 on the flat OTM side.
  it('renders exactly one breakeven label at K + premium', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    const { container } = render(
      <PayoffDiagram legs={[leg('buy', c)]} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const beLabels = Array.from(container.querySelectorAll('text'))
      .filter((t) => t.textContent?.startsWith('BE '));
    expect(beLabels.length).toBe(1);
    expect(beLabels[0].textContent).toBe('BE 102');
  });

  it('shows the "Unlimited profit" callout for a long call', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    const { container } = render(
      <PayoffDiagram legs={[leg('buy', c)]} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('Unlimited profit');
    expect(texts).not.toContain('Unlimited loss');
  });

  it('renders a bounded max-loss horizontal line + label for the flat OTM side', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    const { container } = render(
      <PayoffDiagram legs={[leg('buy', c)]} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    // Long call max loss = -premium × 100 = -$200.
    const maxLossLabel = Array.from(container.querySelectorAll('text'))
      .find((t) => t.textContent?.startsWith('Max '));
    expect(maxLossLabel?.textContent).toBe('Max -$200');
  });
});

describe('PayoffDiagram — short call (unbounded loss)', () => {
  it('shows the "Unlimited loss" callout', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    const { container } = render(
      <PayoffDiagram legs={[leg('sell', c)]} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('Unlimited loss');
    expect(texts).not.toContain('Unlimited profit');
  });
});

describe('PayoffDiagram — long straddle (two breakevens, both sides unbounded-ish)', () => {
  // long call K=100 mid=3 + long put K=100 mid=2 → debit $5. BEs at 105 / 95.
  it('renders two breakeven labels straddling the strike', () => {
    const call = contract({ type: 'call', strike: 100, bid: 3, ask: 3 });
    const put = contract({ type: 'put', strike: 100, bid: 2, ask: 2 });
    const { container } = render(
      <PayoffDiagram
        legs={[leg('buy', call), leg('buy', put)]}
        underlyingPrice={100}
        qtyScalar={1}
        nowSec={NOW_SEC}
      />,
    );
    const beLabels = Array.from(container.querySelectorAll('text'))
      .filter((t) => t.textContent?.startsWith('BE '))
      .map((t) => t.textContent);
    // fmtPrice: >= 100 → integer, < 100 → 2dp. 95 → "95.00", 105 → "105".
    expect(beLabels).toEqual(['BE 95.00', 'BE 105']);
  });
});

describe('PayoffDiagram — bull call spread (bounded both sides)', () => {
  // long 100C mid=3 + short 110C mid=1 → net debit $2 per share.
  // Max profit = (10 - 2) × 100 = +$800 for S ≥ 110 (a real zone).
  // Max loss = -$200 for S ≤ 100.
  // BE = 102.
  const long = contract({ type: 'call', strike: 100, bid: 3, ask: 3 });
  const short = contract({ type: 'call', strike: 110, bid: 1, ask: 1 });
  const legs: Leg[] = [leg('buy', long), leg('sell', short)];

  it('renders exactly one breakeven label at K + net-debit', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={105} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const beLabels = Array.from(container.querySelectorAll('text'))
      .filter((t) => t.textContent?.startsWith('BE '))
      .map((t) => t.textContent);
    expect(beLabels).toEqual(['BE 102']);
  });

  it('renders both max-profit and max-loss annotations with expected values', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={105} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const annotations = Array.from(container.querySelectorAll('text'))
      .filter((t) => t.textContent?.startsWith('Max '))
      .map((t) => t.textContent);
    expect(annotations).toContain('Max +$800');
    expect(annotations).toContain('Max -$200');
  });

  it('renders the max-profit zone as a bounded rect above the underlying', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={105} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    // Zone rects use fillOpacity=0.08. Frame rect uses stroke-only (no fill).
    // So any <rect fill-opacity="0.08"> is a profit/loss band.
    const zoneRects = Array.from(container.querySelectorAll('rect'))
      .filter((r) => r.getAttribute('fill-opacity') === '0.08');
    // Bull call spread has a bounded max-profit zone (S >= 110) and a bounded
    // max-loss zone (S <= 100) — both within ±30% of spot=105 → expect 2 rects.
    expect(zoneRects.length).toBe(2);
  });

  it('does not render any "Unlimited …" callout for a fully-bounded spread', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={105} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).not.toContain('Unlimited profit');
    expect(texts).not.toContain('Unlimited loss');
  });
});

describe('PayoffDiagram — iron condor (two breakevens, two zones)', () => {
  // Short 95P @ mid=1, Long 90P @ mid=0.5 → $0.5 credit on the put wing.
  // Short 105C @ mid=1, Long 110C @ mid=0.5 → $0.5 credit on the call wing.
  // Net credit $1. Max profit = +$100 between 95 and 105.
  // Max loss = (5 - 1) × 100 = -$400 at the wings (S<=90 or S>=110).
  const longPut = contract({ type: 'put', strike: 90, bid: 0.5, ask: 0.5 });
  const shortPut = contract({ type: 'put', strike: 95, bid: 1, ask: 1 });
  const shortCall = contract({ type: 'call', strike: 105, bid: 1, ask: 1 });
  const longCall = contract({ type: 'call', strike: 110, bid: 0.5, ask: 0.5 });
  const legs: Leg[] = [
    leg('buy', longPut),
    leg('sell', shortPut),
    leg('sell', shortCall),
    leg('buy', longCall),
  ];

  it('renders two breakeven labels', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const beLabels = Array.from(container.querySelectorAll('text'))
      .filter((t) => t.textContent?.startsWith('BE '));
    expect(beLabels.length).toBe(2);
  });

  it('renders both max-profit and max-loss zone rects', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const zoneRects = Array.from(container.querySelectorAll('rect'))
      .filter((r) => r.getAttribute('fill-opacity') === '0.08');
    expect(zoneRects.length).toBe(2);
  });

  it('is fully bounded — no "Unlimited" callout', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).not.toContain('Unlimited profit');
    expect(texts).not.toContain('Unlimited loss');
  });

  it('renders both max-profit (+$100) and max-loss (-$400) annotations', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const annotations = Array.from(container.querySelectorAll('text'))
      .filter((t) => t.textContent?.startsWith('Max '))
      .map((t) => t.textContent);
    expect(annotations).toContain('Max +$100');
    expect(annotations).toContain('Max -$400');
  });
});

describe('PayoffDiagram — structural elements', () => {
  // Use a simple long call so there's always an SVG to assert against.
  const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
  const legs = [leg('buy', c)];

  it('renders today + expiration path curves', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    // Two <path> elements: today (dashed) + expiration (solid).
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    const dasharrays = Array.from(paths).map((p) => p.getAttribute('stroke-dasharray'));
    expect(dasharrays).toContain('3 3'); // today
    expect(dasharrays).toContain(null);  // expiration (solid, no dasharray)
  });

  it('renders profit (green) + loss (red) fill polygons', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const polygons = container.querySelectorAll('polygon');
    // Always 2: one above-zero green band, one below-zero red band.
    expect(polygons.length).toBe(2);
  });

  it('renders x-axis labels for xMin, spot, and xMax', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    // ±30% of 100 → xMin=70, xMax=130. fmtPrice: < 100 uses 2dp → "70.00";
    // >= 100 uses integer → "100", "130".
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('70.00');
    expect(texts).toContain('100');
    expect(texts).toContain('130');
  });

  it('renders a zero line and a dashed spot line', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const lines = Array.from(container.querySelectorAll('line'));
    // At minimum: zero line (solid) + spot line (dashed "2 3") + 1 breakeven line (dashed "1 2") + 1 max-loss line (dashed "4 3").
    // Assert the distinct dash patterns are present.
    const dashes = new Set(lines.map((l) => l.getAttribute('stroke-dasharray')));
    expect(dashes.has('2 3')).toBe(true); // spot
    expect(dashes.has('1 2')).toBe(true); // breakeven
  });

  it('renders the "Exp" / "Today" legend', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('Exp');
    expect(texts).toContain('Today');
  });

  it('renders the y-axis zero label', () => {
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('0');
  });

  it('uses "$Xk" formatting for values ≥ $1,000', () => {
    // 10-lot long call with bid=ask=20 → yMax ~+$36k at far-right of range,
    // yMin = -$20k at OTM. Values ≥ 1000 render as e.g. "$20k" / "-$20k".
    const big = contract({ type: 'call', strike: 100, bid: 20, ask: 20 });
    const { container } = render(
      <PayoffDiagram
        legs={[leg('buy', big, 10)]}
        underlyingPrice={100}
        qtyScalar={1}
        nowSec={NOW_SEC}
      />,
    );
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');
    const hasK = texts.some((t) => /\$\d+(\.\d)?k/.test(t));
    expect(hasK).toBe(true);
  });

  it('renders the expected total SVG element count for a long call', () => {
    // Structural canary — if major sections are accidentally removed (frame,
    // fills, zero line, spot line, BE, curves, labels, legend), this count will
    // drift meaningfully and prompt a review. Counts exclude <text> (noisy).
    const { container } = render(
      <PayoffDiagram legs={legs} underlyingPrice={100} qtyScalar={1} nowSec={NOW_SEC} />,
    );
    // 2 rects: plot frame + bounded max-loss zone band ([S=0, S=K] for a long call).
    expect(countTag(container, 'rect')).toBe(2);
    expect(countTag(container, 'polygon')).toBe(2);  // above + below fills
    expect(countTag(container, 'path')).toBe(2);     // today + expiration
  });
});
