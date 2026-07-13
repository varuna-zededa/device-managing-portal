import sys
import os
from django.apps import AppConfig


class EnterprisesConfig(AppConfig):
    name = 'apps.enterprises'
    default_auto_field = 'django.db.models.BigAutoField'

    def ready(self):
        # In Django dev server: the reloader process spawns a child with RUN_MAIN=true.
        # Only start the scheduler in the child (or in production where sys.argv has no 'runserver').
        if 'runserver' in sys.argv and os.environ.get('RUN_MAIN') != 'true':
            return
        self._start_scheduler()

    def _start_scheduler(self):
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.interval import IntervalTrigger
            from apscheduler.triggers.cron import CronTrigger
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
            import logging
            logging.getLogger(__name__).info('APScheduler started (sync every 1h, digest at midnight UTC)')
        except Exception as exc:
            import logging
            logging.getLogger(__name__).exception('Failed to start APScheduler: %s', exc)
