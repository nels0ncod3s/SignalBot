const ccxt = require("ccxt");
const fs = require("fs");
const path = require("path");
const { computeIndicators, evaluateEntry } = require("./strategy");

const CONFIG_PATH = path.join(__dirname, "config.json");
const OPEN_TRADES_PATH = path.join(__dirname, "open_trades.json");
const CLOSED_TRADES_PATH = path.join(__dirname, "closed_trades.json");

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

// ---------- Telegram ----------
async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("Telegram send failed:", data);
    } else {
      console.log("Telegram alert sent.");
    }
  } catch (err) {
    console.error("Telegram send error:", err.message);
  }
}

// ---------- Load/save helpers ----------
function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}
function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ---------- Main ----------
async function run() {
  const exchange = new ccxt.bybit();
  const symbol = "BTC/USDT";
  const timeframe = "4h";

  // fetch enough candles for EMA200 warm-up plus a safety buffer
  const bars = await exchange.fetchOHLCV(symbol, timeframe, undefined, 300);
  const candles = bars.map(([timestamp, open, high, low, close, volume]) => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  }));

  const withIndicators = computeIndicators(candles);

  // drop the last candle if it's still forming (in-progress), keep only fully closed candles
  // ccxt/bybit typically includes the current forming candle last - safer to use the second-to-last as "current closed"
  const closedCandles = withIndicators.slice(0, withIndicators.length - 1);
  const curr = closedCandles[closedCandles.length - 1];
  const prev = closedCandles[closedCandles.length - 2];

  if (!curr.ema200 || !prev.ema20) {
    console.log("Not enough warm-up data yet, skipping this run.");
    return;
  }

  // ---------- 1. Check open trades against the latest closed candle ----------
  let openTrades = loadJson(OPEN_TRADES_PATH, []);
  const closedTrades = loadJson(CLOSED_TRADES_PATH, []);
  const stillOpen = [];

  for (const trade of openTrades) {
    let result = null;
    if (trade.direction === "LONG") {
      if (curr.low <= trade.sl) result = "LOSS";
      else if (curr.high >= trade.tp) result = "WIN";
    } else {
      if (curr.high >= trade.sl) result = "LOSS";
      else if (curr.low <= trade.tp) result = "WIN";
    }

    if (result) {
      trade.result = result;
      trade.exitTime = curr.timestamp;
      closedTrades.push(trade);
      const emoji = result === "WIN" ? "✅" : "❌";
      await sendTelegram(
        `${emoji} *Paper trade closed: ${result}*\n` +
          `${trade.direction} ${symbol}\n` +
          `Entry: ${trade.entry}\n` +
          `${result === "WIN" ? "TP" : "SL"} hit: ${result === "WIN" ? trade.tp : trade.sl}\n` +
          `Opened: ${new Date(trade.entryTime).toISOString()}`,
      );
    } else {
      stillOpen.push(trade);
    }
  }
  saveJson(CLOSED_TRADES_PATH, closedTrades);

  // ---------- 2. Check for a new signal (only if no trade currently open) ----------
  if (stillOpen.length === 0) {
    const signal = evaluateEntry(curr, prev);
    const newTrade = signal ? { ...signal, entryTime: curr.timestamp } : null;

    if (newTrade) {
      stillOpen.push(newTrade);
      const emoji = newTrade.direction === "LONG" ? "🟢" : "🔴";
      await sendTelegram(
        `${emoji} *New paper signal: ${newTrade.direction}*\n` +
          `${symbol} (4H)\n` +
          `Entry: ${newTrade.entry.toFixed(2)}\n` +
          `Stop Loss: ${newTrade.sl.toFixed(2)}\n` +
          `Take Profit: ${newTrade.tp.toFixed(2)}\n` +
          `Time: ${new Date(newTrade.entryTime).toISOString()}\n\n` +
          `_This is a paper trade — no real money involved._`,
      );
      console.log("New signal found and logged.");
    } else {
      console.log("No new signal this run.");
    }
  } else {
    console.log(
      `Trade still open, waiting for SL/TP. (${stillOpen.length} open)`,
    );
  }

  saveJson(OPEN_TRADES_PATH, stillOpen);
}

run().catch(async (err) => {
  console.error("Error in paper_trade_bot:", err);
});
