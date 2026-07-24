// Shared indicator math + entry-signal logic used by backtest.js, paper_trade_bot.js,
// and telegram_bot.js so the live/on-demand signal always matches what was backtested.

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

// Attaches ema200/ema20/atr/volSma onto each candle. Returns a new array.
function computeIndicators(candles) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const ema200 = ema(closes, 200);
  const ema20 = ema(closes, 20);
  const atr14 = atr(candles, 14);
  const volSma10 = sma(volumes, 10);

  return candles.map((c, i) => ({
    ...c,
    ema200: ema200[i],
    ema20: ema20[i],
    atr: atr14[i],
    volSma: volSma10[i],
  }));
}

function indicatorsReady(c) {
  return (
    c.ema200 !== null &&
    c.ema20 !== null &&
    c.atr !== null &&
    c.volSma !== null
  );
}

// Trend/pullback/volume entry rule. `curr` and `prev` must already have indicators attached.
// Returns { direction, entry, sl, tp } or null if no entry condition is met.
function evaluateEntry(curr, prev) {
  if (!indicatorsReady(curr) || !indicatorsReady(prev)) return null;

  const isUptrend = curr.close > curr.ema200;
  const isDowntrend = curr.close < curr.ema200;
  const longPullback = prev.low <= prev.ema20 && curr.close > curr.ema20;
  const shortPullback = prev.high >= prev.ema20 && curr.close < curr.ema20;
  const volOk = curr.volume > curr.volSma;

  if (isUptrend && longPullback && volOk) {
    const entry = curr.close;
    const risk = Math.max(1.5 * curr.atr, entry - curr.low);
    return { direction: "LONG", entry, sl: entry - risk, tp: entry + 2.5 * risk };
  }
  if (isDowntrend && shortPullback && volOk) {
    const entry = curr.close;
    const risk = Math.max(1.5 * curr.atr, curr.high - entry);
    return { direction: "SHORT", entry, sl: entry + risk, tp: entry - 2.5 * risk };
  }
  return null;
}

module.exports = { ema, sma, atr, computeIndicators, indicatorsReady, evaluateEntry };
