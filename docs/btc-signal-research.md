# BTC signal filtering experiment — 10 October 2026

## Outcome

The bot now requires a close beyond the previous candle's range and rejects cost-heavy BTC entries. This improves entry confirmation and reduces estimated fee drag. **It does not establish a profitable strategy or materially improve measured win probability.** The newest evaluation block remains negative after the cost assumption.

## Data and method

52,560 contiguous 30-minute BTC/USDT candles, July 2023–July 2026. Independent overlapping entries, next-bar-open fills, 2×ATR stops, conservative stop-first exits, gap-aware stops and 0.15% assumed round-trip fees. Spread and slippage are zero in this historical comparison; live screening also includes the observed spread.

Selection diagnostics use the earlier 60% of candle time and the following 20%. The final 20% was evaluated after choosing the two trial candidates below, and was not used to set their parameters in this experiment. However, the dataset had already been viewed and tuned on before this work. It is **not fresh untouched out-of-sample data**.

Twelve limited variants tested slope, true EMA reclaim, previous-range confirmation, a 0.15R fee budget, completed 4h EMA trend confirmation, and combinations. A second set of twelve tested 1h/4h timeframes, both directions/long-only, and 2R/3R/4R targets. No robust profitability result emerged. In particular, the 1h 4R candidate was weakly positive in selection periods but failed final evaluation. It was not deployed.

The deployed filter is a research screen that removes expensive, unconfirmed entries. It was not selected as a proven profitable strategy. Positive performance in one calendar window is insufficient evidence.

## Comparison

Net expectancy means estimated R per completed trade after the assumed fee.

| Profile | Earlier 60% trades / net expectancy | Validation 20% trades / net expectancy | Final 20% trades / net expectancy |
| --- | --- | --- | --- |
| Previous 30m entries | 1,049 / −0.1302R | 371 / −0.1362R | 353 / −0.0150R |
| 30m range confirmation + fee budget | 344 / −0.0111R | 70 / +0.0831R | 113 / −0.0103R |
| 1h both directions, 4R target — rejected | 579 / +0.0403R | 224 / +0.0073R | 218 / −0.1922R |

Across the full history, the baseline has 1,776 completed trades, 27.48% wins and −0.1102R net expectancy. The deployed historical filter has 529 completed trades, 27.60% wins and −0.00255R net expectancy. It removes approximately 70% of entries. This is mainly improved cost economics, **not a substantial accuracy improvement**. Results exclude portfolio constraints and do not assume overlapping trades are independent observations.

## Live rule changes

1. Long candles must close above the previous high; short candles below the previous low.
2. Estimated round-trip fees must fit within 0.15R of the stop distance.
3. At delivery, fees plus the actual bid/ask spread are checked again using the indicative current entry and original stop.
4. Telegram shows estimated cost drag and potential net reward/risk, rather than treating the reference entry's 3R ratio as the current execution ratio.

The fee assumption is 0.15% round trip. It is configurable in `markets.js`; it must match the intended execution venue. It excludes slippage, funding, borrowing and unexpected gaps. The shown net reward/risk is a payoff scenario **if the target is reached**, not expected return or a confidence percentage.

## Reproduction and next evidence needed

Run `npm run research` for all selection diagnostics and the three final-block comparisons. Run `npm run backtest` for the deployed filter. Tests cover unconfirmed breakouts, cost rejection, and live spread inclusion alongside existing delivery/data regressions.

Fresh post-July BTC data and forward paper execution are still needed. The development environment could not reach Bybit for fresh market data, so no new-history or live-accuracy claim is made. Do not tune again against the final block and call it independent validation.
