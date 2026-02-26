# Bitcoin Prediction App (Easy Setup)

This app gives you:
- Current Bitcoin price
- Estimated floor price
- 68% and 95% trading ranges
- RSI / ATR / Bollinger indicators
- Saved prediction history on your computer

## Easiest way (double click)

1. Open Finder.
2. Go to:

`/Users/cheungbryan/Documents/New project`

3. Double-click:

`start_app.command`

4. Your browser should open automatically to:

`http://127.0.0.1:8080`

## Terminal way (if you prefer)

1. Open Terminal.
2. Run:

```bash
cd "/Users/cheungbryan/Documents/New project"
python3 server.py
```

3. Open your browser and go to:

`http://127.0.0.1:8080`

## Stop the app

- If started from Terminal: press `Control + C` in that Terminal window.
- If started with `start_app.command`: close that Terminal window or press `Control + C` there.

## If it doesn't start

- If you see `python3: command not found`, install Python 3 from [python.org](https://www.python.org/downloads/).
- If browser cannot connect, make sure the app window is still open.
- If you see `Address already in use`, something else is using port `8080`.

## Where history is saved

The app creates this local file in the same folder:
- `predictions.db`

Your saved prediction history is stored there.

## Important

This is a statistical helper tool, not financial advice.
