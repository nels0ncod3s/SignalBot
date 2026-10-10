// Shared indicator math + entry-signal logic used by backtest.js and telegram_bot.js
// so the live/on-demand signal always matches what was backtested.

function ema(values, period) {
  const k = 2 / (period + 1);
  const result = new Array(values.length).fill(null);
  let prevEma = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (prevEma === null) {
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

function sma(values, period) {
  const result = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    result[i] = slice.reduce((a, b) => a + b, 0) / period;
  }
  return result;
}

// Wilder's smoothed moving average of True Range.
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

// Legacy BTC 30m parameters. Earlier tuning evaluated a single active trade and
// reused the dataset for selection. Those results are not untouched validation and
// do not establish profitability for all-alert execution or for XAU/USD.
const TREND_EMA_PERIOD = 50;
const PULLBACK_EMA_PERIOD = 8;
const ATR_PERIOD = 14;
const VOL_SMA_PERIOD = 10;
const RISK_ATR_MULT = 2.0;
const REWARD_R_MULT = 3.0;

// BTC exchange-volume threshold. Gold uses its explicit price-only market profile;
// a broker's tick/update volume cannot inherit BTC volume calibration.
const VOL_MULT = 2.0;

// Attaches trendEma/pullbackEma/atr/volSma onto each candle. Returns a new array.
function validateCandles(candles) {
  if (!Array.isArray(candles)) throw new Error("Candles must be an array");
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.timestamp, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) ||
        c.timestamp < 0 || c.volume < 0 || c.low <= 0 ||
        c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close) ||
        (i > 0 && c.timestamp <= candles[i - 1].timestamp)) {
      throw new Error(`Invalid or unordered candle at row ${i + 1}`);
    }
  }
}

function computeIndicators(candles) {
  validateCandles(candles);
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const trendEma = ema(closes, TREND_EMA_PERIOD);
  const pullbackEma = ema(closes, PULLBACK_EMA_PERIOD);
  const atrVals = atr(candles, ATR_PERIOD);
  const volSma = sma(volumes, VOL_SMA_PERIOD);

  return candles.map((c, i) => ({
    ...c,
    trendEma: trendEma[i],
    pullbackEma: pullbackEma[i],
    atr: atrVals[i],
    volSma: volSma[i],
  }));
}

function indicatorsReady(c) {
  return Boolean(c && [c.trendEma, c.pullbackEma, c.atr, c.volSma].every(Number.isFinite) && c.atr > 0);
}

// Trend/pullback/volume entry rule. `curr` and `prev` must already have indicators attached.
// Returns { direction, entry, sl, tp } or null if no entry condition is met.
function evaluateEntry(curr, prev, { volumeMultiplier = VOL_MULT } = {}) {
  if (!indicatorsReady(curr) || !indicatorsReady(prev)) return null;

  const isUptrend = curr.close > curr.trendEma;
  const isDowntrend = curr.close < curr.trendEma;
  const longPullback = prev.low <= prev.pullbackEma && curr.close > curr.pullbackEma;
  const shortPullback = prev.high >= prev.pullbackEma && curr.close < curr.pullbackEma;
  const volOk = volumeMultiplier === null || curr.volume > curr.volSma * volumeMultiplier;

  if (isUptrend && longPullback && volOk) {
    const entry = curr.close;
    const risk = Math.max(RISK_ATR_MULT * curr.atr, entry - curr.low);
    return { direction: "LONG", entry, sl: entry - risk, tp: entry + REWARD_R_MULT * risk };
  }
  if (isDowntrend && shortPullback && volOk) {
    const entry = curr.close;
    const risk = Math.max(RISK_ATR_MULT * curr.atr, curr.high - entry);
    return { direction: "SHORT", entry, sl: entry + risk, tp: entry - REWARD_R_MULT * risk };
  }
  return null;
}

module.exports = {
  validateCandles,
  ema,
  sma,
  atr,
  computeIndicators,
  indicatorsReady,
  evaluateEntry,
  REWARD_R_MULT,
};
