#!/bin/sh
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py loaddata clusters_seed.json
exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2
