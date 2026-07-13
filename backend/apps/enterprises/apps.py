import logging
import os
import sys

from django.apps import AppConfig

logger = logging.getLogger(__name__)


class EnterprisesConfig(AppConfig):
    name = 'apps.enterprises'
    default_auto_field = 'django.db.models.BigAutoField'

    def ready(self):
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
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.cron import CronTrigger
            from apscheduler.triggers.interval import IntervalTrigger

            from apps.enterprises.sync import sync_all_enterprises
            from utils.email import send_nightly_digest

            scheduler = BackgroundScheduler(timezone='UTC')
            scheduler.add_job(
                sync_all_enterprises,
                trigger=IntervalTrigger(hours=1),
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
            logger.info('APScheduler started (sync every 1h, digest at midnight UTC)')
        except Exception as exc:
            logger.exception('Failed to start APScheduler: %s', exc)
