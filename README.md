# SignalBot

Telegram research alerts for **BTC/USDT and XAU/USD**, using 30-minute trend/pullback candles. No orders are placed. Each market is checked independently every minute; every qualifying fresh entry can alert, including entries that overlap earlier signals.

## Setup

Requires **Node.js 24+**.

```sh
npm ci
cp config.example.json config.json
npm start
```

Fill in your Telegram bot token and chat ID in `config.json`, or set the corresponding environment variables on your host. Environment variables override individual file fields. Secrets and local state are gitignored. Only the configured chat can use the bot.

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token from Telegram BotFather |
| `TELEGRAM_CHAT_ID` | Destination and authorised chat ID |
| `OANDA_API_TOKEN` | OANDA v20 personal API token; required for gold |
| `OANDA_ACCOUNT_ID` | OANDA v20 account ID offering `XAU_USD`; required for gold |
| `OANDA_ENVIRONMENT` | `practice` (default) or `live`; must match the token/account |
| `STATE_DIR` | Writable persistent directory for delivery state; default project directory, `/data` in Docker |
| `PORT` | HTTP health server port; default `3000` |

### Enable gold

Gold uses **OANDA XAU_USD**, not a tokenized-gold cryptocurrency or a crypto perpetual. Obtain the token and account ID from your OANDA v20 account and confirm that its available instruments include XAU_USD. Availability depends on the account's OANDA entity/region. A practice account is sufficient if it offers this instrument. Do not select `live` unless your credentials belong to that environment.

Set `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`, and `OANDA_ENVIRONMENT`, then restart/redeploy. The equivalent `config.json` fields are `oandaApiToken`, `oandaAccountId`, and `oandaEnvironment`. Without those credentials, gold reports unavailable while Bitcoin continues to run. The bot never opens or closes broker positions, even when using a live data account.

The OANDA candle and pricing APIs supply closed midpoint candles and the account's bid/ask quote. Gold's profile uses EMA50/EMA8, a 2×ATR stop and a reference 3R target, **without BTC's volume filter**: OANDA volume counts price updates, not exchange-traded gold volume. This is an **unvalidated gold research baseline**. No XAU/USD performance or accuracy is claimed. Export your account's history, backtest with realistic costs, and forward-test before relying on it.

## Telegram commands

- `/start` or `/help`: instructions and buttons.
- `/signal` or **📊 Get Signal**: checks both markets; reports a signal or the reason none qualifies for each.
- `/btc`: Bitcoin only.
- `/gold` or `/xau`: gold only.
- `/status`: last market-check statuses and missing gold configuration.

Automatic alerts are deduplicated per symbol/timeframe/candle. Only successful Telegram deliveries are recorded, so rejected sends are retried on subsequent checks while the signal remains fresh. Use one running bot replica and a persistent state volume. Telegram has no idempotency key: a crash between remote delivery and local state saving can still produce a duplicate.

## What qualifies as a fresh alert?

- Valid numeric OHLCV data, strictly increasing candle timestamps, and enough indicator warm-up.
- The newest completed candle closed **within the last three minutes**; forming candles are excluded by time and OANDA's `complete` flag. Candle gaps skip entry across that gap.
- Strategy entry conditions: EMA50 trend, EMA8 pullback/reclaim; BTC additionally requires volume above 2× its 10-candle SMA.
- A tradeable quote, no more than 60 seconds old.
- Bid/ask spread no greater than **0.10×ATR**.
- Current direction-specific bid/ask within **0.25×ATR** of the reference entry.

These limits are explicit in `markets.js` and `signals.js`. They are conservative baseline rules, not optimised gold parameters. Gold's daily/session breaks and weekends naturally produce no fresh entry; broker pricing also supplies tradeability status.

Messages show the **reference candle-close entry**, current indicative bid/ask, stop, target, candle-close UTC time and expiry. The reference 3:1 ratio can differ from the ratio at a later execution price. A qualifying signal is a rule match, not evidence of a profitable trade. If Telegram is unavailable until expiry, that alert is deliberately skipped rather than sent late.

## Backtesting and history

```sh
npm test
npm run backtest
node backtest.js --mode single
node fetch_data_4h.js 30m 3 BTC/USDT
node fetch_data_4h.js 30m 3 XAU/USD
node backtest.js xau_30m_history.csv --market XAU/USD --spread 0.40 --slippage 0.05
node analyze_by_year.js trade_log_xau_30m_history.json
node analyze_recent.js trade_log_xau_30m_history.json
```

`fetch_data_4h.js` retains its old filename for compatibility but supports both markets and 5m, 15m, 30m, 1h, 4h, 1d. It exports available completed candles; requested years do not guarantee that the provider retains that much history. Coverage is printed. CSV format: `timestamp,open,high,low,close,volume`, with UTC timestamps in **milliseconds**. A different timeframe must also be passed to the backtest, e.g. `node backtest.js btc_4h_history.csv --timeframe 4h`.

Backtest `--mode independent` (default) models every entry independently, matching the bot's overlapping-alert policy. `--mode single` is available to study one-position execution. Signals are evaluated at candle close and filled at the next contiguous candle's open; entries outside the live price-drift/spread limits are skipped. Stops crossing a gap use the adverse opening price; when a bar touches stop and target, stop wins conservatively. Open final positions are retained with `result: OPEN` and excluded from completed-trade scoring.

Costs are calculated per trade relative to its actual stop distance: `--fee` is the **round-trip decimal rate**, `--spread` is the round-trip price-unit spread, `--slippage` is price units per side. BTC defaults to a 0.0015 round-trip fee assumption; gold defaults to zero fees and warns when spread is omitted. The gold command above uses **illustrative**, not measured, spread/slippage. Use your broker's costs. Shared reports use actual gross/net R, eliminating the old 2.5R-versus-3R scoring error. Legacy logs without cost fields cannot provide cost-adjusted results.

The bundled BTC history ends in July 2026. The corrected all-entry simulation on that history is negative after the default cost assumption; the code does not claim a proven trading edge. Calendar splits are labelled diagnostic, not untouched out-of-sample validation. Historical execution approximates fills; it cannot reproduce quote freshness, variable live spreads, intrabar sequence or all alert transport delays. Overlapping R totals are not a portfolio return or independent statistical observations.

## Hosting and health

Deploy the Dockerfile or run `npm start` as a continuous worker. Mount persistent storage at `/data` in Docker, or point `STATE_DIR` at your host's persistent volume. Configure Telegram and OANDA secrets on the host. Keep the process running; do not allow an idle HTTP service to sleep.

- `/` and `/live`: process liveness, HTTP 200 (preserves existing deployment probes).
- `/health`: dependency readiness, HTTP 503 when Telegram polling or either data feed has failed/is overdue; includes per-market statuses. A closed/stale market with a successful check is not a provider outage.

The bot uses bounded network timeouts, serialized alert cycles and per-market failure isolation. Tests use mocked data and Telegram responses, so running tests does not send messages. GitHub Actions runs tests and the bundled backtest on Node 24.
