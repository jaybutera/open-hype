# Options Paper Trading

Build a paper options trading feature into hl-frontend. Real option chains from Yahoo Finance, Robinhood-Legend-style chain UI with up to 4-leg spread building, paper fills against live bid/ask, Black-Scholes Greeks computed client-side.

Read LEARNINGS.md first to see what's been done and what's been learned across prior iterations.

## Mission

Each iteration, pick the single most important unfinished task from this spec and complete it. Don't try to do everything at once. Commit locally at the end of each iteration with a short message. Never push to remote.

Work on branch `options-paper`. Create it from `master` if it doesn't exist. All work stays on that branch.

## Constraints

- **No push to remote** — all commits stay local
- **No deployment** — local dev only
- **No backend service** in production scope — the Yahoo proxy is a Vite dev plugin only. Document production-proxy needs but don't build one.
- **Don't break existing perps paper trading** — run `npm test` after each iteration and make sure it stays green. Don't modify perps code unless genuinely necessary.
- **Options coexist with perps** inside the same paper account (shared USD balance, shared positions list, shared PnL). Do not create a second account system.
- **Market-hours only** — options features hidden/disabled when US equities market is closed. Show a "Market closed" indicator; do not serve stale data as if live.
- **Typecheck clean** — `npx tsc --noEmit` must pass after each iteration.

## Architecture

### Data source: Yahoo Finance (verified working)

Endpoint: `GET /api/options/:symbol` (Vite dev middleware, proxied to Yahoo).

The proxy performs a 3-step handshake server-side:
1. GET `https://finance.yahoo.com/quote/{SYMBOL}/options` with browser User-Agent → captures `Set-Cookie` (A1S etc.)
2. GET `https://query1.finance.yahoo.com/v1/test/getcrumb` with that cookie → crumb token
3. GET `https://query1.finance.yahoo.com/v7/finance/options/{SYMBOL}?crumb={CRUMB}` with that cookie → full chain JSON

Cookie + crumb are cached in memory for the process lifetime; refresh only on 401/403/429 upstream.

**Critical gotcha:** Node's default `fetch` (undici 16KB header limit) crashes on Yahoo's huge response headers. Must use `undici` with `new Agent({ maxHeaderSize: 128 * 1024 })`. Without this the plugin silently fails.

**Reference working implementation:** see `/tmp/yahoo-proxy-test/vite.config.ts` (scratch prototype built during design — port its logic, don't re-derive).

Optional: add a second dev endpoint `GET /api/options/:symbol?date={UNIX}` for specific expiration (Yahoo supports `&date=` param).

### Data source: Deribit (future hook, not v1)

Spec writes an adapter interface (see below). Deribit adapter is out of scope for v1; document the interface so it's addable later.

### Adapter interface

```ts
// src/services/options/types.ts
export interface OptionContract {
  symbol: string;         // e.g. "TSLA260417C00300000"
  underlying: string;     // "TSLA"
  type: 'call' | 'put';
  strike: number;
  expiration: number;     // unix seconds
  bid: number;
  ask: number;
  last: number;
  iv: number;             // implied volatility, decimal (0.5 = 50%)
  volume: number;
  openInterest: number;
  inTheMoney: boolean;
}

export interface OptionChain {
  underlying: string;
  underlyingPrice: number;
  underlyingBid?: number;
  underlyingAsk?: number;
  expirations: number[];      // all available expirations (unix seconds)
  strikes: number[];          // all strikes for the currently-loaded expiration
  calls: OptionContract[];
  puts: OptionContract[];
  loadedExpiration: number;   // which expiration is loaded in calls/puts
  asOf: number;               // unix seconds — when chain was fetched
}

export interface OptionsAdapter {
  id: 'yahoo' | 'deribit' | 'tradier';
  getChain(symbol: string, expiration?: number): Promise<OptionChain>;
  searchSymbols(query: string): Promise<SymbolHit[]>;  // for symbol dropdown
}
```

Yahoo adapter is the only one implemented in v1. Put it behind this interface from day 1 so a later swap is a one-file change.

### Greeks computation (client-side)

Yahoo returns IV but no Greeks. Compute Black-Scholes Greeks in the browser from `(underlyingPrice, strike, T, r, iv, type)`:

- Delta, Gamma, Vega, Theta, Rho
- Assume `r = 0.045` (reasonable 2026 short-rate; make it a `const` we can tune)
- T in years (`(expiration - now) / 31_536_000`)
- Standard Black-Scholes for European. US equity options are American, but Black-Scholes is close enough for paper trading and lets us skip binomial pricing complexity. Document this as a known simplification.

Module: `src/services/options/greeks.ts`. Pure function, tested.

### Paper engine extension

Extend the existing paper engine (don't fork). Options are new instrument type alongside perps:

```ts
type Instrument =
  | { kind: 'perp'; coin: string }
  | { kind: 'option'; symbol: string; underlying: string; expiration: number; strike: number; type: 'call'|'put' };
```

New position type: `OptionPosition`. Multi-leg spreads stored as `OptionPosition[]` sharing a `spreadId`.

**Fills:** paper-fill each leg individually at selected fill model (mid / bid for sell / ask for buy). No combo-order matching against a fake book.

**Settlement:** at expiration, auto-exercise ITM legs at intrinsic value (cash-settled, no synthetic share delivery). OTM legs expire worthless. Run this check each time chain refreshes (simplest) or on a tick timer. Debit/credit the account accordingly; write a ledger entry tagged `expiration`.

**Margin:** for v1, require full cash for long options (debit premium × 100 × qty), and for short options require conservative cash margin (e.g. premium × 100 × qty × 5) — not CBOE-correct, but keeps paper traders from blowing past sane limits. Document as simplification.

**No early exercise.** American-style is ignored; options only resolve at expiration in paper.

### Account model

Same `PaperAccount` store (`src/store/usePaperAccountsStore.ts`). Options positions and perp positions coexist in the same account. Balance is shared. PnL view shows both.

### Market-hours gate

US equities market hours: M-F, 9:30–16:00 ET, excluding US holidays. Implement a `isMarketOpen()` helper that returns true only during regular session:

- Build from `Intl.DateTimeFormat` with `America/New_York` timezone
- Include a hardcoded US market holiday list for 2026 (NYSE schedule — NYE, MLK, Presidents, Good Friday, Memorial, Juneteenth, July 4, Labor, Thanksgiving, Christmas)
- When closed: show "Options market closed" banner, disable trade submission, freeze chain at last fetch

## UX

### Route

`#/options` — new page alongside existing `#/pnl`.

Top of the page: symbol search input + expiration dropdown + "Market open/closed" pill.

### Symbol search

- Text input with debounced dropdown (300ms)
- Yahoo has no good free symbol-search endpoint for the proxy. Options:
  1. Ship a static list of popular underlyings (200-500 entries — S&P 500 + major ETFs + IBIT/FBTC for crypto exposure) bundled in the repo
  2. Free-type any symbol: if user types "AMZN" and hits enter, just try to fetch its chain; show "no options found" if 404
- Do both: static list as dropdown suggestions, free-form entry as fallback.
- Persist "recent symbols" (last 10) in localStorage.

### Chain grid (Robinhood Legend-style)

Layout per row:
```
[ call metrics | call bid | call ask ]  STRIKE  [ put bid | put ask | put metrics ]
```

- Calls on the left, puts on the right, strike centered
- Metrics columns configurable (v1: IV, delta, volume, OI — pick 2 defaults, let user toggle)
- ITM rows shaded subtly (existing color tokens)
- Click a **bid cell = Sell**, click an **ask cell = Buy**. No separate buy/sell buttons.
- Each click appends a leg to the Order Form (up to 4 legs)
- Clicking the same cell twice removes that leg
- Sort strikes ascending

### Expiration selector

Tabs above the chain (scrollable horizontally). Labels: `Apr 17 (1d)`, `Apr 24 (8d)`, `May 16 (30d)`, etc. Each tab independently owned by each leg — default is chain's current expiration. Changing a leg's expiration (for calendars/diagonals): click a cell on a different expiration tab.

### Order form

Right-side panel. Each leg is a row:
- Buy/Sell badge (from which cell was clicked, editable)
- Contract string (e.g. `TSLA 4/17 $300 Call`)
- Mark price (mid)
- Qty stepper (default 1, max 4-digit int)
- Remove button

Footer:
- Net debit/credit (signed, per contract and total)
- Breakevens (computed from leg intrinsic values)
- Max profit / max loss (limited strategies only; show "undefined" for naked shorts)
- Net Greeks (sum of per-leg Greeks × signed qty)
- Limit price input (default = net mid), order type (Limit/Market), qty scalar (applies to all legs)
- Submit → "Buy" or "Sell to Open" if single leg, "Open Spread" if multi

### Positions view

Existing positions list gains an Options section:
- Group spread legs under their `spreadId`; show one row per spread with expand-to-see-legs
- Show: strategy name (auto-detect common ones: Vertical, Calendar, Diagonal, Iron Condor, Straddle, Strangle; fall back to "Custom 2-leg" etc.), net entry credit/debit, current net mark, unrealized PnL, net Greeks, DTE
- Click spread → Close panel (mirror entry with opposite sides)

### Payoff diagram (nice-to-have, not v1-blocker)

If there's cycles left: render a P&L-vs-underlying chart for the current order-form legs. X-axis: underlying price range (± 30% of current), Y-axis: P&L at expiration. Solid line at expiration, dotted line for today (computed from BS with today's T and IV).

## File layout

```
src/
  services/
    options/
      types.ts              # adapter interface, OptionContract, OptionChain
      greeks.ts             # Black-Scholes delta/gamma/vega/theta/rho
      greeks.test.ts
      yahooAdapter.ts       # calls /api/options/:symbol, normalizes response
      marketHours.ts        # isMarketOpen(), nextOpen()
      marketHours.test.ts
      symbols.ts            # static popular-symbols list + recent-symbols storage
  engine/
    paper/
      options/
        OptionPosition.ts
        pricing.ts          # mark, unrealized pnl, settlement
        settlement.ts       # expiration auto-exercise
        margin.ts           # cash requirements for short legs
        __tests__/
  components/
    options/
      OptionsPage.tsx       # top-level, route target
      SymbolSearch.tsx
      ExpirationTabs.tsx
      ChainGrid.tsx
      ChainRow.tsx
      OrderForm.tsx
      LegRow.tsx
      NetSummary.tsx
      PayoffDiagram.tsx     # nice-to-have
      PositionsOptions.tsx  # options-positions subview
      MarketClosedBanner.tsx
vite.config.ts              # add yahoo-options-proxy plugin
```

## Testing discipline

- Every pure helper (greeks, marketHours, spread-strategy detector, settlement math, margin calc) gets a vitest unit test
- Use fixture JSON from a real Yahoo response (capture a sample and commit it to `src/services/options/__fixtures__/tsla_chain.json`)
- Don't mock fetch in component tests — use the fixture-driven adapter
- Run `npm test` and `npx tsc --noEmit` after every change

## Iteration order (suggested, adjust as needed)

Roughly dependency-ordered. Each bullet = one iteration. Pick the highest-priority unblocked one each loop.

1. Port the Vite Yahoo proxy plugin from `/tmp/yahoo-proxy-test/vite.config.ts` into the main project. Verify with curl.
2. Capture a real TSLA chain response as a fixture JSON.
3. Build `services/options/types.ts` + `yahooAdapter.ts` + parse fixture into `OptionChain`.
4. Build `services/options/greeks.ts` with BS formulas + tests.
5. Build `services/options/marketHours.ts` + tests (NYSE hours, 2026 holidays).
6. Build `services/options/symbols.ts` (static popular list + localStorage recents).
7. Wire `#/options` route into `App.tsx`. Empty page scaffold.
8. `SymbolSearch` component (dropdown + free-form).
9. `ExpirationTabs`.
10. `ChainGrid` + `ChainRow` (render only, no interaction).
11. Click-to-add-leg interaction (updates an in-memory `legs[]`, highlights selected cells).
12. `OrderForm` with leg rows, qty, net debit/credit.
13. Net Greeks summary.
14. Extend `PaperEngine` to hold option positions. Start with types + storage; no trading yet.
15. Wire Submit → place option paper trade; persist spread as linked legs; debit/credit balance.
16. `PositionsOptions` view: list open spreads + per-leg details + unrealized PnL.
17. Close-position flow.
18. Market-hours gating (banner + disable submit).
19. Strategy auto-detection (Vertical / Calendar / Straddle / Iron Condor / etc).
20. Expiration auto-exercise on chain refresh.
21. Short-leg cash-margin check at submit time.
22. Payoff diagram.
23. Chain-metrics column customization.
24. Polish: loading states, error states, empty states, 4-leg limit enforcement.

## Out of scope for v1

- Deribit / crypto options (keep adapter interface ready)
- Real-time streaming (chain refreshes on interval / user action)
- American early-exercise
- CBOE-correct margin
- Order book visualization
- Multi-account option segregation
- Production proxy (dev-only via Vite plugin)

## References

- Yahoo options endpoint: `https://query1.finance.yahoo.com/v7/finance/options/{SYMBOL}`
- Robinhood Legend docs: https://robinhood.com/us/en/support/articles/trading-with-robinhood-legend/
- Working Vite-proxy prototype: `/tmp/yahoo-proxy-test/` (reference only; port don't copy blindly)
- Existing paper engine: `src/engine/paper/PaperEngine.ts`
- Existing account store: `src/store/usePaperAccountsStore.ts`

## When you finish an iteration

1. Run `npm test` — must pass
2. Run `npx tsc --noEmit` — must pass
3. Commit with short message (no "Co-Authored-By", no emoji) on branch `options-paper`
4. Append to LEARNINGS.md:
   ```
   ## Iteration: YYYY-MM-DD HH:MM

   ### Picked
   [which task from iteration list, why it was highest priority]

   ### Did
   [concrete changes — files, behavior]

   ### Discovered
   [gotchas, surprises, things future iterations should know]

   ### Next
   [what seems most important next, why]
   ```
5. If spec is fully complete, say so in LEARNINGS.md under a `## DONE` header and exit.

## Now

Work on what you think is most important to do next. Don't propose, do.
