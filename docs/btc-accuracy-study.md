# BTC accuracy study — 15 October 2026

## Decision

**No replacement strategy was promoted.** Twelve new entry/target combinations and one fixed predictive model failed their predefined development-validation checks. Production BTC alerts remain on the previously deployed filtered 30m profile. These results do not demonstrate higher live accuracy.

## Fresh data and isolation

Downloaded 39 official Binance monthly BTCUSDT **1h** archives, July 2023–September 2026. All 39 archive hashes were checked against the publisher's `.CHECKSUM` files. There are 28,512 hourly candles, with no duplicate or missing timestamps.

- Development: July 2023–July 2026, 27,048 hourly candles.
- Reserved evaluation: August–September 2026, 1,464 candles.
- Selection training: entries before 1 August 2025; positions crossing the cutoff excluded.
- Selection validation: August 2025–July 2026.

The reserved period was downloaded but its strategy outcomes were **not evaluated**, because no development candidate qualified. Reading timestamps/counts and verifying archive hashes does not use future price outcomes for selection. Earlier market history overlaps previously viewed BTC data, so development performance is not independent evidence. Binance spot volume and prices differ from the Bybit live feed; a successful result would still need venue-specific validation and forward testing.

Official format/source documentation: https://github.com/binance/binance-public-data . Spot archive timestamps from 2025 onward are microseconds; the downloader normalizes them to milliseconds. Exact source URLs, SHA-256 hashes and row counts are in `docs/research/accuracy-data-sources.json`.

## Twelve new rule candidates

Three concepts: RSI14 trend pullback, short RSI2 reversal in the EMA200 trend, and Bollinger-band reclaim in that trend. Each was tested on 1h/4h candles with 1R/1.5R targets and 2×ATR stops. There was no volume-spike requirement. Candidate definitions and thresholds are fixed in `scripts/accuracy_candidates.cjs`.

Execution assumptions: next-bar-open fills; maximum entry drift 0.25×ATR; stop-first when stop and target touch in the same bar; adverse opening fills across stops; independent overlapping trades; 0.15% assumed round-trip fees; no extra spread/slippage/funding/borrowing. Estimated entry fees must fit within 0.15R. The historical cost assumptions are optimistic relative to additional execution frictions.

Predefined selection requirements: at least 100 completed training trades and 30 validation trades, positive net expectancy in both, and at least 50% validation hit rate. Zero candidates qualified. No threshold was relaxed after seeing the results.

| Candidate | Training trades / hit rate / net R per trade | Validation trades / hit rate / net R per trade |
| --- | --- | --- |
| RSI14 pullback, 1h, 1R | 253 / 57.7% / +0.055R | 119 / 50.4% / −0.099R |
| RSI2 reversal, 1h, 1R | 930 / 53.2% / −0.037R | 430 / 52.3% / −0.060R |
| Band reclaim, 1h, 1R | 213 / 61.5% / +0.126R | 83 / 51.8% / −0.069R |

Higher hit rates alone do not imply better trades: the 1R targets pay less than the current reference 3R target. All rule-candidate results, including the failed 4h variants, are recorded in `docs/research/accuracy-candidates.json`.

## Predictive model check

A fixed gradient-boosting classifier used 100 trees, depth 2, learning rate 0.05, minimum leaf size 100 and random seed 7. Inputs use only candle-close information: RSI2/14, ATR/price, EMA gaps/slope, candle range/body, relative volume, band location, past returns, hour-of-day features, and direction. Targets use next-open fills, 2×ATR stops, 1.5R targets and a maximum holding period of 48 hourly bars. Unresolved trades are marked to the holding-period close. Fees use the same 0.15% assumption.

Training labels crossing the split are excluded; the model also purges 48 hours on each side of the split. There were 25,300 training examples and 11,146 eligible validation examples. At the preselected raw model-probability threshold of 0.60, **zero validation entries qualified**. This provides no supported accuracy estimate and fails the minimum 30-trade requirement. The probabilities were not claimed to be calibrated confidence scores. This model was not deployed.

Overlap between trade labels still reduces effective sample size. No independent-observation significance claim is made. Counts and results are in `docs/research/accuracy-model.json`.

## Reproduce

From the repository root:

```sh
python3 scripts/fetch_accuracy_data.py
node scripts/accuracy_candidates.cjs research-data
python3 -m pip install -r requirements-research.txt
OPENBLAS_NUM_THREADS=1 python3 scripts/accuracy_model.py --data-dir research-data
```

The Python dependencies are optional research tools; they are not used by the Node Telegram bot. Generated archives, CSVs and experiment outputs stay in the gitignored `research-data/` folder. Both selectors read **only** `development.csv`; neither reads the reserved evaluation prices. `locked-candidate.json` contains `null` when no rule candidate qualifies.

This experiment improves the evidence and repeatability of strategy selection. It did not find a deployable accuracy improvement. Any further study must disclose these additional trials and avoid repeatedly tuning against the same validation history until a positive result appears.
