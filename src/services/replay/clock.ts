/**
 * App-wide virtual clock. While replay mode is active the replay store
 * installs an override returning the replay cursor time, so paper fills,
 * ledger entries, and journal notes are stamped with historical time and
 * stay consistent with the replayed candles (wick-guard, trade windows).
 */
let override: (() => number) | null = null;

export function setReplayClock(fn: (() => number) | null): void {
  override = fn;
}

export function appNow(): number {
  return override ? override() : Date.now();
}
