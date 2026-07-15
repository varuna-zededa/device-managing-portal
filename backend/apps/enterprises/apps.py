import faulthandler
import logging
import os
import sys
import threading

from django.apps import AppConfig

logger = logging.getLogger(__name__)

_scheduler = None


def get_scheduler():
    return _scheduler


def _thread_excepthook(args: threading.ExceptHookArgs) -> None:
    logger.error(
        'Unhandled exception in thread %s',
        args.thread.name if args.thread else 'unknown',
        exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
    )


class EnterprisesConfig(AppConfig):
    name = 'apps.enterprises'
    default_auto_field = 'django.db.models.BigAutoField'

    def ready(self):
        faulthandler.enable()
        threading.excepthook = _thread_excepthook

        if 'runserver' in sys.argv:
            # Dev server: the reloader spawns a child with RUN_MAIN=true.
            # Only start in the child to avoid double-scheduling.
            if os.environ.get('RUN_MAIN') != 'true':
                return
        elif os.environ.get('START_SCHEDULER', '').lower() != 'true':
            # Production (gunicorn, uwsgi) and management commands (migrate, shell, etc.):
            # require explicit opt-in via START_SCHEDULER=true so manage.py commands
            # don't inadvertently start background threads before tables exist, and so
            # gunicorn workers don't each start their own scheduler.
            return
        self._start_scheduler()

    def _start_scheduler(self):
        global _scheduler
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.cron import CronTrigger
            from apscheduler.triggers.interval import IntervalTrigger

            from apps.enterprises.sync import sync_all_enterprises
            from utils.email import send_nightly_digest

            try:
                from apps.enterprises.models import PortalSettings
                interval_minutes = PortalSettings.get().sync_interval_minutes
            except Exception:
                interval_minutes = 60

            scheduler = BackgroundScheduler(timezone='UTC')
            scheduler.add_job(
                sync_all_enterprises,
                trigger=IntervalTrigger(minutes=interval_minutes),
                id='sync_enterprises',
                replace_existing=True,
                max_instances=1,
                misfire_grace_time=300,
            )
            scheduler.add_job(
                send_nightly_digest,
                trigger=CronTrigger(hour=0, minute=0, timezone='UTC'),
                id='nightly_digest',
                replace_existing=True,
                max_instances=1,
            )
            scheduler.start()
            _scheduler = scheduler
            logger.info('APScheduler started (sync every %d min, digest at midnight UTC)', interval_minutes)
        except Exception as exc:
            logger.exception('Failed to start APScheduler: %s', exc)
