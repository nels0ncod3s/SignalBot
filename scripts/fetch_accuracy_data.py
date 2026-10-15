"""Download a fixed BTC study dataset; do not inspect the reserved period during selection."""
import argparse
import concurrent.futures
import csv
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile


def fetch_month(root, month):
    url = f'https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-{month}.zip'
    archive = root / f'{month}.zip'
    data = archive.read_bytes() if archive.exists() else urllib.request.urlopen(url, timeout=30).read()
    expected = urllib.request.urlopen(url + '.CHECKSUM', timeout=30).read().decode().split()[0]
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise ValueError(f'Checksum mismatch: {month}')
    archive.write_bytes(data)
    with zipfile.ZipFile(io.BytesIO(data)) as zipped:
        rows = list(csv.reader(io.StringIO(zipped.read(zipped.namelist()[0]).decode())))
    candles = []
    for row in rows:
        timestamp = int(row[0])
        # Official spot archive switched from milliseconds to microseconds in 2025.
        if timestamp > 10**14:
            timestamp //= 1000
        candles.append([timestamp, *map(float, row[1:6])])
    return candles, {'url': url, 'sha256': actual, 'candles': len(candles), 'checksumVerified': True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, default=Path('research-data'))
    args = parser.parse_args()
    root = args.data_dir
    root.mkdir(parents=True, exist_ok=True)
    months = [f'{year}-{month:02}' for year in range(2023, 2027) for month in range(1, 13)
              if '2023-07' <= f'{year}-{month:02}' <= '2026-09']
    candles, sources = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for rows, source in pool.map(lambda month: fetch_month(root, month), months):
            candles.extend(rows)
            sources.append(source)
    candles.sort()
    if any(candles[i][0] - candles[i-1][0] != 3600000 for i in range(1, len(candles))):
        raise ValueError('Duplicate or missing hourly candles')
    cutoff = 1785542400000  # 2026-08-01 UTC. Fixed before testing candidates.
    for filename, rows in [('development.csv', [c for c in candles if c[0] < cutoff]),
                           ('sealed-evaluation.csv', [c for c in candles if c[0] >= cutoff])]:
        with (root / filename).open('w', newline='') as output:
            writer = csv.writer(output)
            writer.writerow(['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            writer.writerows(rows)
        print(f'{filename}: {len(rows)} candles')
    (root / 'sources.json').write_text(json.dumps(sources, indent=2) + '\n')


if __name__ == '__main__':
    main()
