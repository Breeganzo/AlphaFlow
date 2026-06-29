# alpha_flow/execution/

This folder is reserved for Phase 2: live order submission to Alpaca paper trading.

## Current status: stub only

AlphaFlow currently generates signals but does **not** place any trades. The `__init__.py` file contains a `submit_order()` function that returns a stub response and logs the intent. No real or paper orders are placed.

This is deliberate. Validating signal quality before connecting execution is good practice in quantitative trading — you should know that your alpha is real before putting capital behind it.

## What Phase 2 will add

Phase 2 will replace the stub with a real Alpaca API integration:

1. Connect to Alpaca paper trading using `alpaca-py` (already in `requirements.txt`)
2. Read a signal card from `signals/signal_generator.py`
3. Submit a market order for the BUY or SELL signal
4. Apply position limits: maximum 2% of portfolio per single signal
5. Monitor fills and log order status back to `data/app.db`

## How to call the stub (for testing)

```python
from alpha_flow.execution import submit_order

result = submit_order(ticker="AAPL", signal="BUY", confidence=0.72, qty=10)
print(result)
# {"status": "stub", "ticker": "AAPL", "side": "buy", "qty": 10, ...}
```

## API keys needed for Phase 2

Add these to your `.env` file (see `.env.example`):
```
ALPACA_API_KEY=your_key_here
ALPACA_SECRET_KEY=your_secret_here
ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2
```

Paper trading means real market prices but no real money.
