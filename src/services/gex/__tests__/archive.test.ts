import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { sampleRecords, lastAtOrBefore, readingAt, etDay, archivedDays, type GexRecord } from '../../../../gex-archive';

const rec = (timestamp: number, spot: number): GexRecord => ({ timestamp, ticker: 'SPX', spot });

describe('sampleRecords', () => {
  it('keeps the last record of each bucket', () => {
    const recs = [rec(100, 1), rec(110, 2), rec(119, 3), rec(130, 4), rec(161, 5)];
    expect(sampleRecords(recs, 30).map(r => r.spot)).toEqual([3, 4, 5]);
  });
});

describe('lastAtOrBefore', () => {
  const recs = [rec(100, 1), rec(130, 2), rec(160, 3)];
  it('finds the last record at or before the time', () => {
    expect(lastAtOrBefore(recs, 99)).toBeNull();
    expect(lastAtOrBefore(recs, 100)?.spot).toBe(1);
    expect(lastAtOrBefore(recs, 159)?.spot).toBe(2);
    expect(lastAtOrBefore(recs, 500)?.spot).toBe(3);
  });
});

describe('readingAt', () => {
  // Two archived days with pre-sampled caches, so no unzip runs in the test.
  let dir: string;
  // 2026-10-16 09:30:00 ET = 13:30 UTC.
  const d16open = Date.UTC(2026, 9, 16, 13, 30) / 1000;
  const d15close = Date.UTC(2026, 9, 15, 19, 59, 30) / 1000;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gex-archive-'));
    for (const [day, recs] of [
      ['2026-10-15', [rec(d15close - 60, 7700), rec(d15close, 7710)]],
      ['2026-10-16', [rec(d16open + 2, 7744), rec(d16open + 62, 7750)]],
    ] as Array<[string, GexRecord[]]>) {
      mkdirSync(join(dir, day), { recursive: true });
      writeFileSync(join(dir, day, 'SPX.zip'), '');
      mkdirSync(join(dir, '.replay', day), { recursive: true });
      writeFileSync(join(dir, '.replay', day, 'SPX_zero.json.gz'), gzipSync(JSON.stringify(recs)));
    }
  });

  it('lists archived days for the ticker', () => {
    expect(archivedDays('SPX', dir)).toEqual(['2026-10-15', '2026-10-16']);
    expect(archivedDays('NDX', dir)).toEqual([]);
  });

  it('serves the last record at or before the cursor', () => {
    const at = (d16open + 30) * 1000;
    expect(etDay(at)).toBe('2026-10-16');
    expect(readingAt('SPX', 'zero', at, dir)).toEqual({ rec: rec(d16open + 2, 7744), day: '2026-10-16' });
    expect(readingAt('SPX', 'zero', (d16open + 62) * 1000, dir)?.rec.spot).toBe(7750);
  });

  it('serves the previous close before the first record of the day', () => {
    const preOpen = (d16open - 1800) * 1000;
    expect(readingAt('SPX', 'zero', preOpen, dir)).toEqual({ rec: rec(d15close, 7710), day: '2026-10-15' });
  });

  it('answers null with nothing archived at or before the time', () => {
    expect(readingAt('SPX', 'zero', (d15close - 7200) * 1000, dir)).toBeNull();
    expect(readingAt('NDX', 'zero', (d16open + 30) * 1000, dir)).toBeNull();
  });
});
