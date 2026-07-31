"""Application entry point.

Run with:
    uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload

Or via the Makefile:
    make run-dev
"""

from src.api.app import app

__all__ = ["app"]
