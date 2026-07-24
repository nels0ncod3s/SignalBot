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

// group trades by the calendar year of their entry time
const byYear = {};
for (const t of trades) {
  const year = new Date(t.entryTime).getFullYear();
  if (!byYear[year]) byYear[year] = [];
  byYear[year].push(t);
}

const years = Object.keys(byYear).sort();

console.log('Year-by-year breakdown:\n');
console.log('Year  | Trades | Win Rate | Expectancy | Net R');
console.log('------|--------|----------|------------|-------');

for (const year of years) {
  const { total, winRate, expectancy } = scoreTrades(byYear[year]);
  const netR = expectancy * total;
  console.log(
    `${year}  | ${String(total).padStart(6)} | ${(winRate * 100).toFixed(1).padStart(7)}% | ${
      expectancy >= 0 ? '+' : ''
    }${expectancy.toFixed(3).padStart(9)}R | ${netR >= 0 ? '+' : ''}${netR.toFixed(1)}R`
  );
}

console.log('\n(Note: 2022 was BTC\'s major bear market year — check that row specifically.)');