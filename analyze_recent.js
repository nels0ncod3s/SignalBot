const fs = require('fs');

const trades = JSON.parse(fs.readFileSync('trade_log.json', 'utf-8'));

function scoreTrades(list) {
  const wins = list.filter((t) => t.result === 'WIN').length;
  const losses = list.filter((t) => t.result === 'LOSS').length;
  const total = wins + losses;
  const winRate = total ? wins / total : 0;
  const expectancy = total ? winRate * 2.5 - (1 - winRate) * 1.0 : 0;
  return { total, wins, losses, winRate, expectancy };
}

// ---------- 1. Month-by-month breakdown for the most recent 18 months ----------
const now = Date.now();
const eighteenMonthsAgo = now - 18 * 30 * 24 * 60 * 60 * 1000;

const recentTrades = trades.filter((t) => t.entryTime >= eighteenMonthsAgo);

const byMonth = {};
for (const t of recentTrades) {
  const d = new Date(t.entryTime);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (!byMonth[key]) byMonth[key] = [];
  byMonth[key].push(t);
}

const months = Object.keys(byMonth).sort();

console.log('=== Month-by-month (last 18 months) ===\n');
console.log('Month    | Trades | Win Rate | Expectancy | Net R');
console.log('---------|--------|----------|------------|-------');

for (const month of months) {
  const { total, winRate, expectancy } = scoreTrades(byMonth[month]);
  const netR = expectancy * total;
  console.log(
    `${month}  | ${String(total).padStart(6)} | ${(winRate * 100).toFixed(1).padStart(7)}% | ${
      expectancy >= 0 ? '+' : ''
    }${expectancy.toFixed(3).padStart(9)}R | ${netR >= 0 ? '+' : ''}${netR.toFixed(1)}R`
  );
}

// ---------- 2. Statistical significance test: early period vs recent period ----------
// Split trades in half by entry time (not by count) - first half of calendar time vs second half
const sortedByTime = [...trades].sort((a, b) => a.entryTime - b.entryTime);
const midpointTime = (sortedByTime[0].entryTime + sortedByTime[sortedByTime.length - 1].entryTime) / 2;

const earlyPeriod = trades.filter((t) => t.entryTime < midpointTime);
const latePeriod = trades.filter((t) => t.entryTime >= midpointTime);

const early = scoreTrades(earlyPeriod);
const late = scoreTrades(latePeriod);

console.log('\n=== Early half vs Late half (split by calendar time, not trade count) ===\n');
console.log(`Early period: ${early.total} trades, ${(early.winRate * 100).toFixed(1)}% win rate`);
console.log(`Late period:  ${late.total} trades, ${(late.winRate * 100).toFixed(1)}% win rate`);

// two-proportion z-test
const p1 = early.winRate;
const p2 = late.winRate;
const n1 = early.total;
const n2 = late.total;
const pPooled = (early.wins + late.wins) / (n1 + n2);
const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));
const z = (p1 - p2) / se;

// approximate two-tailed p-value from z-score using a standard normal approximation
function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}
function erf(x) {
  // Abramowitz-Stegun approximation
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
const pValue = 2 * (1 - normalCdf(Math.abs(z)));

console.log(`\nZ-score: ${z.toFixed(3)}`);
console.log(`Approx two-tailed p-value: ${pValue.toFixed(4)}`);
console.log(
  pValue < 0.05
    ? '=> Statistically significant difference (p < 0.05): the win rate drop is unlikely to be pure noise.'
    : '=> NOT statistically significant (p >= 0.05): this difference is plausibly just random noise given the sample size.'
);