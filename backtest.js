const fs = require("fs");
const { computeIndicators, indicatorsReady, evaluateEntry } = require("./strategy");

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

// ---------- 2. Load data + compute indicators ----------
const candles = loadCandles('btc_4h_history.csv');
const withIndicators = computeIndicators(candles);

// trim candles where indicators aren't ready yet (nulls)
const data = withIndicators.filter(indicatorsReady);

console.log(`Usable candles after indicator warm-up: ${data.length}`);

// ---------- 4. Backtest simulation loop ----------
const trades = [];
let inTrade = false;
let trade = {};

for (let i = 1; i < data.length; i++) {
  const curr = data[i];
  const prev = data[i - 1];

  if (!inTrade) {
    const signal = evaluateEntry(curr, prev);
    if (signal) {
      trade = { ...signal, entryIdx: i, entryTime: curr.timestamp };
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
