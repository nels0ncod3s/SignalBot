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

// Tuned via grid search over 3 years of 30m BTC/USDT candles (52,560 bars): the pair
// below was the most robust match of in-sample vs out-of-sample expectancy (+0.085R vs
// +0.086R) among all combos that were net-positive on both halves, out of 384 tested.
const TREND_EMA_PERIOD = 50;
const PULLBACK_EMA_PERIOD = 8;
const ATR_PERIOD = 14;
const VOL_SMA_PERIOD = 10;
const RISK_ATR_MULT = 2.0;
const REWARD_R_MULT = 3.0;

// Added after a separate threshold sweep (not part of the grid search above): requiring
// volume to clear 2x its 10-period average, instead of just >1x, roughly doubled
// expectancy on the same dataset (+0.085R -> +0.189R) and held up in-sample vs
// out-of-sample (+0.178R vs +0.215R). Re-validate periodically, same as the params above.
const VOL_MULT = 2.0;

// Attaches trendEma/pullbackEma/atr/volSma onto each candle. Returns a new array.
function computeIndicators(candles) {
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
  return (
    c.trendEma !== null &&
    c.pullbackEma !== null &&
    c.atr !== null &&
    c.volSma !== null
  );
}

// Trend/pullback/volume entry rule. `curr` and `prev` must already have indicators attached.
// Returns { direction, entry, sl, tp } or null if no entry condition is met.
function evaluateEntry(curr, prev) {
  if (!indicatorsReady(curr) || !indicatorsReady(prev)) return null;

  const isUptrend = curr.close > curr.trendEma;
  const isDowntrend = curr.close < curr.trendEma;
  const longPullback = prev.low <= prev.pullbackEma && curr.close > curr.pullbackEma;
  const shortPullback = prev.high >= prev.pullbackEma && curr.close < curr.pullbackEma;
  const volOk = curr.volume > curr.volSma * VOL_MULT;

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
  ema,
  sma,
  atr,
  computeIndicators,
  indicatorsReady,
  evaluateEntry,
  REWARD_R_MULT,
};
