# SignalBot

BTC/USDT 30m trend-pullback signal bot (paper trading / research only — no real orders are placed).

## Setup

```
npm install
cp config.example.json config.json
```

Fill in `config.json` with your Telegram bot token (from [@BotFather](https://t.me/BotFather)) and your chat ID. `config.json` is gitignored — never commit it.

On a hosting platform, you can skip `config.json` entirely and set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` as environment variables/secrets instead — `telegram_bot.js` checks those first.

## Scripts

- `npm run bot` — starts `telegram_bot.js`: send `/signal` (or tap the "📊 Get Signal" button) anytime for the current BTC/USDT 30m signal, and it also auto-alerts your chat the moment a real signal fires (checks every 15 minutes in the background — no need to ask). Long-polls Telegram, so it just needs to stay running with outbound internet access — no public URL/webhook needed.
- `npm run backtest` — runs `backtest.js` against `btc_4h_history.csv` (the legacy 4H dataset) and writes `trade_log.json`. Pass a different CSV to backtest another timeframe, e.g. `node backtest.js btc_30m_history.csv` (writes `trade_log_30m.json` instead, so it doesn't clobber the default).
- `node fetch_data_4h.js [timeframe] [years]` — fetches/refreshes historical candles from Bybit into `btc_<timeframe>_history.csv`, e.g. `node fetch_data_4h.js 30m 3` for 3 years of 30m bars.

`strategy.js` holds the shared indicator math (EMA/SMA/ATR) and entry-signal rule used by both `backtest.js` and the bot, so backtested results and live signals can't drift apart. The current entry rule (trend EMA 50 / pullback EMA 8, 2.0×ATR stop, 3.0× reward, volume filter) was chosen by grid-searching 384 parameter combinations over 3 years of 30m data and picking the one with the most consistent in-sample vs. out-of-sample expectancy — see `strategy.js` for the exact numbers. Past backtested performance doesn't guarantee future results, especially at this granularity — re-check periodically with `analyze_recent.js`-style tooling.

## Running the bot continuously

`telegram_bot.js` needs to run 24/7 somewhere with internet access to reach `api.telegram.org` and Bybit's API — it won't respond to `/signal` while it's stopped. It also opens a small HTTP health-check server on `PORT` (default 3000) for platforms that expect a bound port to consider the app "up"; that's unused on plain background-worker hosts. Options, roughly cheapest/simplest to most robust:

- **Fly.io** — `fly launch` picks up the included `Dockerfile` automatically; set `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` via `fly secrets set`. Make sure the app isn't configured to auto-stop idle machines, since this isn't a request-driven web service.
- **Railway** — connect the GitHub repo, it builds the `Dockerfile` automatically; set `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` as project variables.
- **pxxl.app** (or similar "web app" PaaS) — should work since the bot now binds to `PORT`; set `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` as environment variables in its dashboard. Double-check the platform actually keeps a non-HTTP-driven process alive continuously rather than only while serving requests.
- **A small VPS** (Hetzner/DigitalOcean, ~$4-6/mo) — clone the repo, `npm install`, run `node telegram_bot.js` under `pm2` or a `systemd` service so it restarts on crash/reboot.

Any of these keeps the bot reachable even when your own computer is off.
