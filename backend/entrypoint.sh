#!/bin/sh
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py loaddata clusters_seed.json
if [ "$LOAD_DEMO_DATA" = "true" ]; then
  echo "Loading demo fixture..."
  python manage.py loaddata demo_fixture.json
fi
exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2
