# DEFINITION OF DONE

***A phase is considered COMPLETE only when:***

✓ Project compiles
✓ Docker starts successfully
✓ Frontend starts
✓ Backend starts
✓ Database migration successful
✓ Redis connected
✓ APIs tested
✓ WebSocket connected
✓ No runtime errors
✓ No TypeScript errors
✓ No ESLint errors
✓ README updated
✓ Tests pass

## Phase 3 additions

✓ Binance Futures and OKX Futures implement the common adapter contract
✓ Provider DTOs remain inside infrastructure code
✓ Symbols, intervals, dates, and decimal strings are normalized
✓ Private repository access is scoped by session user and connection ID
✓ Credentials remain encrypted and secret values never enter responses/logs
✓ Public caching and private rate limiting have separate scopes
✓ Timeout, bounded safe retries, timestamp resync, and normalized errors work
✓ No trading mutation or realtime streaming endpoint exists
✓ Production exchange connections are disabled by default
✓ Connection list/create/detail/test/enable/disable/delete UI works

## Phase 5 additions

✓ Public RSS/Atom feeds, exchange announcements (Binance/OKX), Fear & Greed, and Reddit ingested reliably
✓ SSRF IP/hostname blocking and XXE entity resolution protection verified
✓ URL canonicalization and title normalization strip tracking parameters cleanly
✓ Exact and near-duplicate similarity deduplication (Jaccard + Cosine TF-IDF) groups duplicated articles
✓ Metadata extraction maps symbols ($BTC, $ETH, $LINK), topics, and entities automatically
✓ Deterministic 0-100 importance score formula implemented with score factor breakdown
✓ BullMQ background ingestion queue and repeatable schedulers running cleanly
✓ WebSocket `/external-data` gateway streams realtime high-importance news alerts
✓ Manual CSV/JSON macro import importer with dry-run preview table verified
✓ Cross-user bookmarks and read states strictly isolated per user
✓ Frontend UI pages (`/news`, `/news/:id`, `/macro`, `/sentiment`, `/settings/data-sources`, `/system/providers`) fully interactive
✓ All unit, integration, and workspace production build checks pass cleanly

**Only then continue to the next phase.**
