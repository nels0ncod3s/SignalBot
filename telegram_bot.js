// On-demand Telegram bot: reply with the current BTC/USDT 4H signal when asked,
// instead of pushing alerts on a schedule. Long-polls Telegram (no public webhook needed),
// so it just needs to run continuously somewhere with outbound internet access.
const ccxt = require("ccxt");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { computeIndicators, evaluateEntry } = require("./strategy");

// Env vars take priority since most hosting platforms (Fly, Railway, pxxl.app, etc.)
// inject secrets that way rather than mounting a config.json file.
function loadConfig() {
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    return {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: process.env.TELEGRAM_CHAT_ID,
    };
  }
  const configPath = path.join(__dirname, "config.json");
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }
  throw new Error(
    "Missing config: set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars, or provide config.json (see config.example.json).",
  );
}

const config = loadConfig();

const SYMBOL = "BTC/USDT";
const TIMEFRAME = "4h";
const TELEGRAM_API = `https://api.telegram.org/bot${config.telegramBotToken}`;
const ALLOWED_CHAT_ID = String(config.telegramChatId);

const SIGNAL_KEYBOARD = {
  keyboard: [["📊 Get Signal"]],
  resize_keyboard: true,
};

async function telegramCall(method, body) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId, text, extra = {}) {
  const data = await telegramCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    ...extra,
  });
  if (!data.ok) console.error("sendMessage failed:", data);
  return data;
}

// ---------- Signal lookup ----------
async function fetchCurrentCandles() {
  const exchange = new ccxt.bybit();
  const bars = await exchange.fetchOHLCV(SYMBOL, TIMEFRAME, undefined, 300);
  const candles = bars.map(([timestamp, open, high, low, close, volume]) => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  }));

  const withIndicators = computeIndicators(candles);
  // drop the last candle since it's still forming (in-progress)
  const closedCandles = withIndicators.slice(0, withIndicators.length - 1);
  const curr = closedCandles[closedCandles.length - 1];
  const prev = closedCandles[closedCandles.length - 2];
  return { curr, prev };
}

async function getCurrentSignal() {
  const { curr, prev } = await fetchCurrentCandles();
  if (!curr || !prev || !curr.ema200 || !prev.ema20) {
    return { ready: false };
  }

  const signal = evaluateEntry(curr, prev);
  const trend = curr.close > curr.ema200 ? "UPTREND" : curr.close < curr.ema200 ? "DOWNTREND" : "FLAT";

  return { ready: true, signal, curr, trend };
}

function formatSignalMessage({ ready, signal, curr, trend }) {
  if (!ready) {
    return "⏳ Not enough warm-up data from the exchange right now — try again shortly.";
  }

  const asOf = new Date(curr.timestamp).toISOString();

  if (signal) {
    const emoji = signal.direction === "LONG" ? "🟢" : "🔴";
    return (
      `${emoji} *Signal: ${signal.direction}*\n` +
      `${SYMBOL} (4H)\n` +
      `Entry: ${signal.entry.toFixed(2)}\n` +
      `Stop Loss: ${signal.sl.toFixed(2)}\n` +
      `Take Profit: ${signal.tp.toFixed(2)}\n` +
      `As of candle: ${asOf}`
    );
  }

  return (
    `⚪ *No active entry signal right now*\n` +
    `${SYMBOL} (4H)\n` +
    `Trend: ${trend}\n` +
    `Price: ${curr.close.toFixed(2)}\n` +
    `EMA200: ${curr.ema200.toFixed(2)} | EMA20: ${curr.ema20.toFixed(2)}\n` +
    `As of candle: ${asOf}`
  );
}

async function handleSignalRequest(chatId) {
  try {
    const result = await getCurrentSignal();
    await sendMessage(chatId, formatSignalMessage(result));
  } catch (err) {
    console.error("Error computing signal:", err);
    await sendMessage(chatId, `⚠️ Error fetching signal: ${err.message}`);
  }
}

// ---------- Auto-alert loop ----------
// Real signals only exist on a freshly-closed 4H candle, so polling every hour is plenty
// responsive without hammering the exchange API. State is persisted to disk (not just in
// memory) so a restart doesn't miss a candle that closed while the process was down, and
// doesn't re-alert for a candle it already sent.
const ALERT_STATE_PATH = path.join(__dirname, "alert_state.json");
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

function loadAlertState() {
  try {
    return JSON.parse(fs.readFileSync(ALERT_STATE_PATH, "utf-8"));
  } catch {
    return { lastAlertedCandleTime: null };
  }
}

function saveAlertState(state) {
  fs.writeFileSync(ALERT_STATE_PATH, JSON.stringify(state));
}

async function checkForAutoAlert() {
  try {
    const result = await getCurrentSignal();
    if (!result.ready || !result.signal) return;

    const state = loadAlertState();
    if (state.lastAlertedCandleTime === result.curr.timestamp) return;

    await sendMessage(ALLOWED_CHAT_ID, formatSignalMessage(result));
    saveAlertState({ lastAlertedCandleTime: result.curr.timestamp });
    console.log(`Auto-alert sent for candle ${new Date(result.curr.timestamp).toISOString()}`);
  } catch (err) {
    console.error("Auto-alert check failed:", err.message);
  }
}

function startAutoAlertLoop() {
  checkForAutoAlert();
  setInterval(checkForAutoAlert, CHECK_INTERVAL_MS);
}

// ---------- Update handling ----------
async function handleUpdate(update) {
  const message = update.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  if (String(chatId) !== ALLOWED_CHAT_ID) {
    console.log(`Ignoring message from unauthorized chat ${chatId}`);
    return;
  }

  const text = message.text.trim();

  if (text === "/start") {
    await sendMessage(
      chatId,
      "👋 BTC signal bot ready.\n" +
        "📊 Get Signal / /signal — current real strategy signal.\n" +
        "🔔 Also watching in the background — you'll get a message here automatically whenever a real signal fires, no need to ask.",
      { reply_markup: SIGNAL_KEYBOARD },
    );
  } else if (text === "/signal" || text === "📊 Get Signal") {
    await handleSignalRequest(chatId);
  }
}

// ---------- Long polling loop ----------
async function pollLoop() {
  let offset = 0;
  console.log("Telegram bot started, long-polling for updates...");

  while (true) {
    try {
      const data = await telegramCall("getUpdates", {
        offset,
        timeout: 30,
      });

      if (!data.ok) {
        console.error("getUpdates failed:", data);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      for (const update of data.result) {
        offset = update.update_id + 1;
        handleUpdate(update).catch((err) =>
          console.error("Error handling update:", err),
        );
      }
    } catch (err) {
      console.error("Polling error:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Some hosting platforms (Render, Railway web services, pxxl.app, etc.) expect the
// process to bind to a port for health checks / to consider the deploy "up", even
// though this bot's real work happens over Telegram long-polling, not HTTP. Harmless
// no-op on hosts that don't check it (Fly.io machines, a plain VPS).
function startHealthServer() {
  const port = process.env.PORT || 3000;
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("SignalBot is running.");
    })
    .listen(port, () => console.log(`Health check server listening on :${port}`));
}

startHealthServer();
startAutoAlertLoop();
pollLoop();
