# Open Hype

A fast, keyboard-driven trading frontend for [Hyperliquid](https://hyperliquid.xyz) with built-in paper trading and chart-based order entry.

![screenshot](screenshot.png)

## Features

- **Paper trading engine** — practice with simulated fills, margin, and PnL tracking before going live
- **Chart-based order entry** — shift+click to place limit orders or set TP/SL directly on the chart
- **ICT killzone overlays** — session highlights (Asia, London, NY) with DST-aware timing
- **Risk-first order panel** — set risk in USD, leverage, TP/SL, and let the UI calculate size
- **Multi-asset tabs** — quickly switch between BTC, ETH, S&P 500, Gold, Silver, and more
- **Live trading on Hyperliquid** — connect a browser wallet (MetaMask, Rabby, any EIP-6963 wallet) or an API wallet key; mainnet or testnet

## Live trading

1. Switch the header toggle to **Live** and pick **Mainnet** or **Testnet** (the page reloads; market data, asset ids and signatures all follow the network).
2. **Connect wallet** and choose your wallet. Nothing is signed yet.
3. **Enable trading** asks your wallet to sign one Hyperliquid `ApproveAgent` message. It authorises a trading key generated in this browser, registered under the agent name `OpenHype` (it replaces only a previous `OpenHype` agent, not your other API wallets). That key can place and cancel orders; it cannot withdraw or transfer funds. It is stored in this browser's localStorage per account and network, and **Disconnect** deletes it.
4. Every order shows a review card with the exact rounded size, price and payload; nothing is sent until **Confirm & send**.
5. If the account has sub-accounts, an account selector appears next to the network toggle. Balances, positions, orders and new trades follow the selected account. Orders for a sub-account are signed by the same trading key with Hyperliquid's `vaultAddress` field set to the sub-account, and the review card names the account.

Alternatively, open the connect menu and use **Use an API wallet key** with a key created at app.hyperliquid.xyz/API plus the funded account address. That key is kept in memory only.

Never paste a seed phrase into this or any site.

Market orders are IOC limit orders capped 5% through the mid. TP/SL are reduce-only market triggers. Orders under $10 notional are rejected before signing (exchange minimum).

## Quick Start

```bash
git clone https://github.com/YOUR_USER/hl-frontend.git
cd hl-frontend
npm install
npm run dev
```

Open `http://localhost:5173` and connect a wallet or switch to Paper mode to start trading.

## Tech Stack

React, TypeScript, Vite, Zustand, [Lightweight Charts](https://github.com/nicehash/lightweight-charts)
