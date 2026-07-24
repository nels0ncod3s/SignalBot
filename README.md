# SignalBot

BTC/USDT 4H trend-pullback signal bot (paper trading / research only — no real orders are placed).

## Setup

```
npm install
cp config.example.json config.json
```

Fill in `config.json` with your Telegram bot token (from [@BotFather](https://t.me/BotFather)) and your chat ID. `config.json` is gitignored — never commit it.

## Scripts

- `npm run bot` — starts `telegram_bot.js`, an on-demand bot: send `/signal` (or tap the "📊 Get Signal" button) in Telegram and it replies with the current BTC/USDT 4H signal. Long-polls Telegram, so it just needs to stay running with outbound internet access — no public URL/webhook needed.
- `npm run backtest` — runs `backtest.js` against `btc_4h_history.csv` and writes `trade_log.json`.
- `node fetch_data_4h.js` — refreshes `btc_4h_history.csv` from Bybit.
- `node paper_trade_bot.js` — one-shot scheduled variant: checks/closes any open paper trade and opens a new one if a signal fires, pushing Telegram alerts. Intended to be run on a schedule (e.g. cron every 4h) rather than long-running. Not currently wired up to anything — kept for later if you want scheduled alerts in addition to on-demand.

`strategy.js` holds the shared indicator math (EMA/SMA/ATR) and entry-signal rule used by both `backtest.js` and the bots, so backtested results and live signals can't drift apart.

## Running the bot continuously

`telegram_bot.js` needs to run 24/7 somewhere with internet access to reach `api.telegram.org` and Bybit's API — it won't respond to `/signal` while it's stopped. Options, roughly cheapest/simplest to most robust:

- **Fly.io** — free small-VM allowance is normally enough for a bot this light. `fly launch` picks up the included `Dockerfile` automatically; set `telegramBotToken`/`telegramChatId` either by shipping `config.json` as a secret file or adapting `telegram_bot.js` to read them from env vars via `fly secrets set`.
- **Railway** — connect the GitHub repo, it builds the `Dockerfile` automatically; add `config.json`'s contents as a mounted file or env vars in the project settings.
- **A small VPS** (Hetzner/DigitalOcean, ~$4-6/mo) — clone the repo, `npm install`, run `node telegram_bot.js` under `pm2` or a `systemd` service so it restarts on crash/reboot.

Any of these keeps the bot reachable even when your own computer is off.
