const fs = require("fs");

// ---------- 1. Load CSV ----------
function loadCandles(path) {
  const raw = fs.readFileSync(path, "utf-8").trim().split("\n");
  const rows = raw.slice(1); // skip header
  return rows.map((line) => {
    const [timestamp, open, high, low, close, volume] = line
      .split(",")
      .map(Number);
    return { timestamp, open, high, low, close, volume };
  });
}

// ---------- 2. Indicator math ----------

// Exponential Moving Average
function ema(values, period) {
  const k = 2 / (period + 1);
  const result = new Array(values.length).fill(null);
  let prevEma = null;

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue; // not enough data yet
    if (prevEma === null) {
      // seed with a simple average of the first `period` values
      const seed =
        values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
      prevEma = seed;
      result[i] = seed;
    } else {
      prevEma = values[i] * k + prevEma * (1 - k);
      result[i] = prevEma;
    }
  }
  return result;
}

// Simple Moving Average
function sma(values, period) {
  const result = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    result[i] = slice.reduce((a, b) => a + b, 0) / period;
  }
  return result;
}

// Average True Range
function atr(candles, period) {
  const trValues = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
  });

  // ATR is typically a smoothed (Wilder's) moving average of TR, not a plain SMA.
  // Wilder's smoothing: first value = SMA of first `period` TRs, then recursive smoothing.
  const result = new Array(candles.length).fill(null);
  let prevAtr = null;

  for (let i = 0; i < trValues.length; i++) {
    if (i < period - 1) continue;
    if (prevAtr === null) {
      const seed =
        trValues.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) /
        period;
      prevAtr = seed;
      result[i] = seed;
    } else {
      prevAtr = (prevAtr * (period - 1) + trValues[i]) / period;
      result[i] = prevAtr;
    }
  }
  return result;
}

// ---------- 3. Load data + compute indicators ----------
const candles = loadCandles('btc_4h_history.csv');

const closes = candles.map((c) => c.close);
const volumes = candles.map((c) => c.volume);

const ema200 = ema(closes, 200);
const ema20 = ema(closes, 20);
const atr14 = atr(candles, 14);
const volSma10 = sma(volumes, 10);

// attach indicators back onto each candle
for (let i = 0; i < candles.length; i++) {
  candles[i].ema200 = ema200[i];
  candles[i].ema20 = ema20[i];
  candles[i].atr = atr14[i];
  candles[i].volSma = volSma10[i];
}

// trim candles where indicators aren't ready yet (nulls)
const data = candles.filter(
  (c) =>
    c.ema200 !== null &&
    c.ema20 !== null &&
    c.atr !== null &&
    c.volSma !== null,
);

console.log(`Usable candles after indicator warm-up: ${data.length}`);

// ---------- 4. Backtest simulation loop ----------
const trades = [];
let inTrade = false;
let trade = {};

for (let i = 1; i < data.length; i++) {
  const curr = data[i];
  const prev = data[i - 1];

  if (!inTrade) {
    const isUptrend = curr.close > curr.ema200;
    const isDowntrend = curr.close < curr.ema200;
    const longPullback = prev.low <= prev.ema20 && curr.close > curr.ema20;
    const shortPullback = prev.high >= prev.ema20 && curr.close < curr.ema20;
    const volOk = curr.volume > curr.volSma;

    if (isUptrend && longPullback && volOk) {
      const entry = curr.close;
      const risk = Math.max(1.5 * curr.atr, entry - curr.low);
      trade = {
        direction: "LONG",
        entry,
        sl: entry - risk,
        tp: entry + 2.5 * risk,
        entryIdx: i,
        entryTime: curr.timestamp,
      };
      inTrade = true;
    } else if (isDowntrend && shortPullback && volOk) {
      const entry = curr.close;
      const risk = Math.max(1.5 * curr.atr, curr.high - entry);
      trade = {
        direction: "SHORT",
        entry,
        sl: entry + risk,
        tp: entry - 2.5 * risk,
        entryIdx: i,
        entryTime: curr.timestamp,
      };
      inTrade = true;
    }
  } else {
    if (trade.direction === "LONG") {
      if (curr.low <= trade.sl) {
        trade.result = "LOSS";
        trade.exitIdx = i;
        inTrade = false;
      } else if (curr.high >= trade.tp) {
        trade.result = "WIN";
        trade.exitIdx = i;
        inTrade = false;
      }
    } else {
      if (curr.high >= trade.sl) {
        trade.result = "LOSS";
        trade.exitIdx = i;
        inTrade = false;
      } else if (curr.low <= trade.tp) {
        trade.result = "WIN";
        trade.exitIdx = i;
        inTrade = false;
      }
    }

    if (!inTrade) {
      trades.push(trade);
      trade = {};
    }
  }
}

// ---------- 5. Score results ----------
function scoreTrades(tradeList, label) {
  const wins = tradeList.filter((t) => t.result === "WIN").length;
  const losses = tradeList.filter((t) => t.result === "LOSS").length;
  const total = wins + losses;
  const winRate = total ? wins / total : 0;
  const expectancy = winRate * 2.5 - (1 - winRate) * 1.0;

  console.log(`\n--- ${label} ---`);
  console.log(`Total trades: ${total}`);
  console.log(`Wins: ${wins} | Losses: ${losses}`);
  console.log(`Win rate: ${(winRate * 100).toFixed(1)}%`);
  console.log(
    `Expectancy: ${expectancy >= 0 ? "+" : ""}${expectancy.toFixed(2)}R per trade`,
  );
  console.log(`Net R over period: ${(expectancy * total).toFixed(1)}R`);

  return { total, winRate, expectancy };
}

const completedTrades = trades.filter((t) => t.result);

// Full dataset score
scoreTrades(completedTrades, "FULL DATASET");

// Out-of-sample split: first 70% vs last 30%
const splitIdx = Math.floor(completedTrades.length * 0.7);
const inSample = completedTrades.slice(0, splitIdx);
const outOfSample = completedTrades.slice(splitIdx);

scoreTrades(inSample, "IN-SAMPLE (first 70%)");
scoreTrades(outOfSample, "OUT-OF-SAMPLE (last 30%)");

// Fee-adjusted (assume 0.15% round-trip cost per trade, expressed in R terms is tricky —
// simplest approximation: subtract a flat R deduction per trade for fees/slippage)
const feeDragPerTradeR = 0.05; // rough estimate, ~5% of a full R unit per trade
const feeAdjustedExpectancy =
  completedTrades.length > 0
    ? completedTrades.reduce(
        (acc, t) => acc + (t.result === "WIN" ? 2.5 : -1.0),
        0,
      ) /
        completedTrades.length -
      feeDragPerTradeR
    : 0;

console.log(`\n--- FEE-ADJUSTED (rough estimate) ---`);
console.log(
  `Expectancy after ~${feeDragPerTradeR}R/trade fee & slippage drag: ${
    feeAdjustedExpectancy >= 0 ? "+" : ""
  }${feeAdjustedExpectancy.toFixed(2)}R per trade`,
);

// Save full trade log for inspection
fs.writeFileSync("trade_log.json", JSON.stringify(completedTrades, null, 2));
console.log(`\nFull trade log saved to trade_log.json`);
