"""Celery application and scheduled task definitions.

Configures periodic tasks for market data collection,
signal generation, and portfolio updates.
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from src.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "trading_agents",
    broker=settings.celery.broker_url,
    backend=settings.celery.result_backend,
    include=["src.infrastructure.messaging.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        # Collect market data every minute
        "collect-market-data": {
            "task": "src.infrastructure.messaging.tasks.collect_market_data",
            "schedule": 60.0,
            "args": (["BTC-USDT-SWAP", "ETH-USDT-SWAP"], "1h"),
        },
        # Collect news every 5 minutes
        "collect-news": {
            "task": "src.infrastructure.messaging.tasks.collect_news",
            "schedule": 300.0,
            "args": (["BTC", "ETH"],),
        },
        # Generate signals every hour
        "generate-signals": {
            "task": "src.infrastructure.messaging.tasks.generate_signals",
            "schedule": crontab(minute="0"),
            "args": (["BTC-USDT-SWAP", "ETH-USDT-SWAP"], "4h"),
        },
        # Update paper trading positions every 30 seconds
        "update-paper-positions": {
            "task": "src.infrastructure.messaging.tasks.update_paper_positions",
            "schedule": 30.0,
        },
    },
)
