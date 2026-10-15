import { appendFileSync } from 'node:fs';

/**
 * Clock for a sim session (dev server started with SIM=1). The agent drives a
 * normal Claude Code session; this decides when replay time moves.
 *
 *   busy  the agent is working; the replay cursor stands still.
 *   idle  the agent ended its turn (Stop hook -> POST /api/sim/idle); the
 *         caller steps the replay until a wait the agent is blocked on
 *         resolves, which is what wakes the agent.
 *   ended the cursor reached `end` or the data ran out.
 *
 * A wait that resolves while the agent is still busy (it ran the wait, then
 * kept working) wakes it again after its turn ends, so the next Stop is
 * absorbed instead of going idle. If no sign of the agent follows within
 * WAKE_GRACE_MS, the wake is assumed lost (a foreground wait, say) and the
 * clock goes idle anyway.
 */
export interface SimParams {
  asset: string;
  interval: string;
  /** Replay window, UTC ms. */
  start: number;
  end: number;
}

export type SimState = 'off' | 'starting' | 'busy' | 'idle' | 'ended';

const WAKE_GRACE_MS = 30_000;

export class SimClock {
  state: SimState = 'off';
  params: SimParams | null = null;
  cursor = 0;
  endReason: string | null = null;
  private pendingWake = false;
  private woken = new Set<string>();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private idleListeners = new Set<() => void>();

  constructor(private logFile: string | null, private log: (msg: string) => void = () => {}) {}

  get active(): boolean { return this.state !== 'off'; }

  event(type: string, data: Record<string, unknown> = {}): void {
    const row = { type, cursor: this.cursor, at: Date.now(), ...data };
    this.log(`${type} ${JSON.stringify(data)}`);
    if (!this.logFile) return;
    try { appendFileSync(this.logFile, JSON.stringify(row) + '\n'); } catch { /* best effort */ }
  }

  begin(params: SimParams): void {
    this.params = params;
    this.state = 'starting';
    this.cursor = params.start;
    this.event('start', { ...params });
  }

  started(cursor: number): void {
    this.cursor = cursor;
    this.state = 'busy';
  }

  onIdle(fn: () => void): void { this.idleListeners.add(fn); }

  /** Stop hook: the agent's turn ended. */
  idle(): void {
    if (this.state !== 'busy') return;
    if (this.pendingWake) {
      this.pendingWake = false;
      this.event('stop-absorbed');
      this.armGrace();
      return;
    }
    this.goIdle('stop');
  }

  /**
   * PreToolUse / UserPromptSubmit hook: the agent is working. Cancels a wake
   * grace timer, and stops the clock if it was running (a wake we did not see).
   */
  activity(): void {
    this.clearGrace();
    if (this.state === 'idle') {
      this.state = 'busy';
      this.event('busy', { cause: 'activity-while-idle' });
    }
  }

  private clearGrace(): void {
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
  }

  /** A wait the agent ran has resolved (alert fired, proposal decided). Once per key. */
  wake(key: string, cause: string): void {
    if (this.woken.has(key) || !this.active) return;
    this.woken.add(key);
    if (this.state === 'idle') {
      this.state = 'busy';
      this.event('wake', { key, cause });
    } else if (this.state === 'busy') {
      this.pendingWake = true;
      this.event('wake-while-busy', { key, cause });
    }
  }

  finish(reason: string): void {
    if (this.state === 'ended' || this.state === 'off') return;
    this.state = 'ended';
    this.endReason = reason;
    this.clearGrace();
    this.event('end', { reason });
  }

  private goIdle(cause: string): void {
    this.state = 'idle';
    this.event('idle', { cause });
    for (const fn of this.idleListeners) fn();
  }

  private armGrace(): void {
    this.clearGrace();
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.state === 'busy') this.goIdle('wake-grace-expired');
    }, WAKE_GRACE_MS);
    (this.graceTimer as { unref?: () => void }).unref?.();
  }
}
