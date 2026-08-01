# AI AGENTS

## News Agent
- **Input:** CoinDesk, Cointelegraph, Reuters, RSS, Binance/OKX Announcements
- **Ingestion Pipeline:** URL Canonicalization, Title Normalization, Jaccard & Cosine TF-IDF Deduplication, Symbol & Topic Extraction, Deterministic 0-100 Importance Scoring.
- **Output:** Summary, Importance, Bullish/Bearish, Confidence

------------------------------------------------

## Market Agent
- **Input:** RSI, EMA, MACD, ATR, Volume, Funding, OI, Liquidation
- **Output:** Bullish, Bearish, Neutral

------------------------------------------------

## Social Agent
- **Input:** Reddit, Twitter, Telegram, Fear & Greed Index
- **Ingestion Pipeline:** Alternative.me Fear & Greed Observation Normalization, Reddit Public JSON / OAuth Ingestion with SHA256 Author Hashing.
- **Output:** Sentiment Score

------------------------------------------------

## OnChain Agent
- **Input:** Whale, Exchange Flow, Stablecoin Flow
- **Output:** Bullish Score

------------------------------------------------

## Macro Agent
- **Input:** CPI, FOMC, Interest Rate, DXY, GDP, Nonfarm Payrolls
- **Ingestion Pipeline:** Scheduled Economic Calendar Normalization, Manual CSV/JSON Importer with Dry-Run Validation.
- **Output:** Macro Risk

------------------------------------------------

## Decision Agent
- **Input:** Every Agent
- **Output:** Signal, Entry, TP, SL, Confidence, Reasons

------------------------------------------------

## Judge Agent
- **Input:** Decision
- **Responsibilities:** Approve, Reject, Request More Data

------------------------------------------------

## Memory Agent
- **Store:** Every decision, Every result, Every prediction
- **Evaluate:** Historical performance

------------------------------------------------

## Performance Agent
- **Output:** Daily Report, Weekly Report, Monthly Report, Win Rate, ROI, Profit Factor, Sharpe Ratio, Drawdown
