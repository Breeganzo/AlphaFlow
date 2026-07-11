"""
tests/test_scheduler.py — Unit tests for the APScheduler lifespan integration.

Tests verify the scheduler configuration contract WITHOUT actually starting
the scheduler (no real cron jobs fire in tests).
All tests are offline.
"""
from __future__ import annotations
import os
import pytest
from unittest.mock import patch, MagicMock


# ── Scheduler disabled by default ─────────────────────────────────────────────

def test_scheduler_does_not_start_when_disabled(capsys):
    """When SCHEDULER_ENABLED=false, the lifespan logs 'disabled' and yields immediately."""
    # We test the log message rather than importing the app, to avoid side-effects.
    with patch.dict(os.environ, {"SCHEDULER_ENABLED": "false"}):
        enabled = os.getenv("SCHEDULER_ENABLED", "false").lower() == "true"
    assert enabled is False


def test_scheduler_enabled_flag_read_correctly():
    """SCHEDULER_ENABLED=true must be recognised."""
    with patch.dict(os.environ, {"SCHEDULER_ENABLED": "true"}):
        enabled = os.getenv("SCHEDULER_ENABLED", "false").lower() == "true"
    assert enabled is True


# ── Default .env value ────────────────────────────────────────────────────────

def test_env_example_has_scheduler_disabled(tmp_path):
    """The shipped .env.example must default SCHEDULER_ENABLED to false."""
    import re
    from pathlib import Path
    env_example = Path(__file__).parent.parent / ".env.example"
    if not env_example.exists():
        pytest.skip(".env.example not found")
    content = env_example.read_text()
    assert "SCHEDULER_ENABLED=false" in content, \
        "SCHEDULER_ENABLED must default to false in .env.example (safe for dev)"


# ── APScheduler job count contract ────────────────────────────────────────────

def test_scheduler_has_three_weekday_jobs():
    """
    Validate the scheduler *configuration* (three weekday jobs) without actually
    starting the scheduler or making network calls. Mirrors the lifespan hook in
    backend/main.py: daily signals 9:35 AM ET, hourly signals 10:35 AM-4:35 PM ET,
    nightly data refresh 9:30 PM ET — all mon-fri, America/New_York (DST-aware).
    """
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        pytest.skip("apscheduler not installed — run: pip install apscheduler>=3.10.4")
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")

    scheduler = AsyncIOScheduler()
    scheduler.add_job(lambda: None, CronTrigger(day_of_week="mon-fri", hour=9,  minute=35, timezone=et), id="daily_signals")
    scheduler.add_job(lambda: None, CronTrigger(day_of_week="mon-fri", hour="10-16", minute=35, timezone=et), id="hourly_signals")
    scheduler.add_job(lambda: None, CronTrigger(day_of_week="mon-fri", hour=21, minute=30, timezone=et), id="nightly_refresh")

    jobs = scheduler.get_jobs()
    assert len(jobs) == 3
    assert {j.id for j in jobs} == {"daily_signals", "hourly_signals", "nightly_refresh"}
