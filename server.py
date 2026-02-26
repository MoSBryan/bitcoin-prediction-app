#!/usr/bin/env python3
import json
import math
import sqlite3
import statistics
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "0.0.0.0"
PORT = 8080
DB_FILE = Path("predictions.db")


def fetch_ohlc(days: int):
    url = (
    "https://api.binance.com/api/v3/klines"
    f"?symbol=BTCUSDT&interval=1d&limit={days}"
    )    
    req = urllib.request.Request(url, headers={"User-Agent": "btc-floor-app/1.0"})
    with urllib.request.urlopen(req, timeout=20) as res:
        data = json.loads(res.read().decode("utf-8"))
    points = []
    for row in data:
        # row: [timestamp, open, high, low, close]
        points.append(
            {
                "ts": int(row[0]),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
            }
        )
    return points


def percentile(sorted_vals, p: float):
    if not sorted_vals:
        return 0.0
    idx = (len(sorted_vals) - 1) * p
    low = math.floor(idx)
    high = math.ceil(idx)
    if low == high:
        return sorted_vals[low]
    w = idx - low
    return sorted_vals[low] * (1 - w) + sorted_vals[high] * w


def rolling_sma(values, window: int):
    out = [None] * len(values)
    if len(values) < window:
        return out
    for i in range(window - 1, len(values)):
        out[i] = sum(values[i - window + 1 : i + 1]) / window
    return out


def rolling_std(values, window: int):
    out = [None] * len(values)
    if len(values) < window:
        return out
    for i in range(window - 1, len(values)):
        out[i] = statistics.pstdev(values[i - window + 1 : i + 1])
    return out


def compute_rsi(closes, period: int = 14):
    if len(closes) < period + 1:
        return None
    gains = []
    losses = []
    for i in range(1, len(closes)):
        change = closes[i] - closes[i - 1]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = ((avg_gain * (period - 1)) + gains[i]) / period
        avg_loss = ((avg_loss * (period - 1)) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def compute_model(points, horizon_days: int):
    closes = [p["close"] for p in points]
    highs = [p["high"] for p in points]
    lows = [p["low"] for p in points]

    spot = closes[-1]

    returns = []
    for i in range(1, len(closes)):
        returns.append(math.log(closes[i] / closes[i - 1]))

    mean_return = sum(returns) / max(1, len(returns))
    daily_vol = statistics.stdev(returns) if len(returns) >= 2 else 0.0

    drawdowns = sorted([(c - spot) / spot for c in closes])
    severe_drawdown = abs(percentile(drawdowns, 0.12))

    floor_by_drawdown = spot * (1 - severe_drawdown)
    floor_by_recent_low = min(lows[-min(30, len(lows)) :])
    floor = max(floor_by_drawdown, floor_by_recent_low * 0.96)

    horizon_scale = math.sqrt(max(1, horizon_days))
    drift = mean_return * horizon_days
    sigma = daily_vol * horizon_scale

    # 68% and 95% confidence bands for log-normal projection.
    z68 = 1.0
    z95 = 1.96

    range68_low = spot * math.exp(drift - z68 * sigma)
    range68_high = spot * math.exp(drift + z68 * sigma)
    range95_low = spot * math.exp(drift - z95 * sigma)
    range95_high = spot * math.exp(drift + z95 * sigma)

    true_ranges = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        true_ranges.append(tr)
    atr14 = sum(true_ranges[-14:]) / min(14, len(true_ranges)) if true_ranges else 0.0

    sma20 = rolling_sma(closes, 20)
    std20 = rolling_std(closes, 20)
    boll_mid = sma20[-1] if sma20 else None
    boll_std = std20[-1] if std20 else None
    boll_upper = boll_mid + 2 * boll_std if boll_mid is not None and boll_std is not None else None
    boll_lower = boll_mid - 2 * boll_std if boll_mid is not None and boll_std is not None else None

    rsi14 = compute_rsi(closes, 14)

    return {
        "spot": spot,
        "floor": floor,
        "floor_by_drawdown": floor_by_drawdown,
        "drawdown_risk": severe_drawdown,
        "daily_vol": daily_vol,
        "range68": {"low": range68_low, "high": range68_high},
        "range95": {"low": range95_low, "high": range95_high},
        "indicators": {
            "rsi14": rsi14,
            "atr14": atr14,
            "bollinger20": {
                "mid": boll_mid,
                "upper": boll_upper,
                "lower": boll_lower,
            },
        },
    }


def init_db():
    conn = sqlite3.connect(DB_FILE)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            lookback_days INTEGER NOT NULL,
            horizon_days INTEGER NOT NULL,
            spot REAL NOT NULL,
            floor REAL NOT NULL,
            range68_low REAL NOT NULL,
            range68_high REAL NOT NULL,
            range95_low REAL NOT NULL,
            range95_high REAL NOT NULL,
            rsi14 REAL,
            atr14 REAL
        )
        """
    )
    conn.commit()
    conn.close()


def save_prediction(payload, lookback_days, horizon_days):
    conn = sqlite3.connect(DB_FILE)
    conn.execute(
        """
        INSERT INTO predictions (
            created_at, lookback_days, horizon_days, spot, floor,
            range68_low, range68_high, range95_low, range95_high, rsi14, atr14
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            datetime.now(timezone.utc).isoformat(),
            lookback_days,
            horizon_days,
            payload["spot"],
            payload["floor"],
            payload["range68"]["low"],
            payload["range68"]["high"],
            payload["range95"]["low"],
            payload["range95"]["high"],
            payload["indicators"]["rsi14"],
            payload["indicators"]["atr14"],
        ),
    )
    conn.commit()
    conn.close()


def load_history(limit: int = 12):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT id, created_at, lookback_days, horizon_days, spot, floor,
               range68_low, range68_high, range95_low, range95_high, rsi14, atr14
        FROM predictions
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


class AppHandler(SimpleHTTPRequestHandler):
    def _send_json(self, payload, code=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/analyze":
            query = urllib.parse.parse_qs(parsed.query)
            lookback_days = int(query.get("lookback", ["90"])[0])
            horizon_days = int(query.get("horizon", ["7"])[0])

            lookback_days = max(30, min(365, lookback_days))
            horizon_days = max(1, min(30, horizon_days))

            selected_days = lookback_days

            try:
                points = fetch_ohlc(selected_days)
                if len(points) < 25:
                    raise ValueError("Not enough data from provider.")
                model = compute_model(points, horizon_days)

                payload = {
                    "meta": {
                        "requested_lookback_days": lookback_days,
                        "actual_lookback_days": selected_days,
                        "horizon_days": horizon_days,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                    "series": points,
                    "model": model,
                }

                save_prediction(payload["model"], lookback_days, horizon_days)
                self._send_json(payload)
                return
            except Exception as exc:
                self._send_json({"error": str(exc)}, 500)
                return

        if parsed.path == "/api/history":
            query = urllib.parse.parse_qs(parsed.query)
            limit = int(query.get("limit", ["12"])[0])
            limit = max(1, min(50, limit))
            self._send_json({"rows": load_history(limit)})
            return

        return super().do_GET()


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"Bitcoin app running at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
