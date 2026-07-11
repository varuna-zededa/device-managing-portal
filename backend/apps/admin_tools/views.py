import csv
import io
import ipaddress
import json
import logging
from datetime import timedelta
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.http import HttpResponse
from django.utils import timezone
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
from apps.devices.models import Device, Lab, CONDITION_CHOICES
from apps.devices.serializers import DeviceSerializer
from apps.clusters.models import Cluster
from apps.device_models.models import DeviceModel
from apps.users.models import Team
from .models import RequestLog
from utils.permissions import get_user_email, IsAdminPortalUser, IsPortalUser

_VALID_CONDITIONS = {c[0] for c in CONDITION_CHOICES}

logger = logging.getLogger(__name__)


class ExportView(APIView):
    permission_classes = [IsAdminPortalUser]

    def get(self, request):

        fmt = request.query_params.get('fmt', 'json').lower()
        devices = Device.objects.select_related('model', 'cluster', 'lab', 'team').all().order_by('name')

        ts = timezone.now().strftime('%Y%m%d_%H%M%S')
        filename_base = f'holocron_device_inventory_{ts}'

        if fmt == 'csv':
            output = io.StringIO()
            writer = csv.writer(output)
            header = [
                'id', 'name', 'serial_number', 'description',
                'cluster', 'cluster_device_name', 'model', 'customer_partner_name',
                'team', 'owner_email', 'lab', 'location_detail', 'condition',
                'idrac_ip', 'idrac_username', 'eve_version', 'device_connectivity',
                'status', 'last_purpose_text', 'created_at', 'updated_at',
            ]
            writer.writerow(header)
            for d in devices:
                writer.writerow([
                    d.id, d.name, d.serial_number, d.description,
                    d.cluster.name if d.cluster else '',
                    d.cluster_device_name or '',
                    d.model.name if d.model else '',
                    d.model.customer_partner_name if d.model else '',
                    d.team.name if d.team else '', d.owner_email or '', d.lab.name, d.location_detail or '',
                    d.condition, d.idrac_ip or '', d.idrac_username or '',
                    d.eve_version or '',
                    json.dumps(d.device_connectivity) if d.device_connectivity else '',
                    d.status or '', d.last_purpose_text or '',
                    d.created_at.isoformat(), d.updated_at.isoformat(),
                ])
            response = HttpResponse(output.getvalue(), content_type='text/csv')
            response['Content-Disposition'] = f'attachment; filename="{filename_base}.csv"'
            return response

        serializer = DeviceSerializer(devices, many=True)
        resp = HttpResponse(
            json.dumps(serializer.data, default=str),
            content_type='application/json',
        )
        resp['Content-Disposition'] = f'attachment; filename="{filename_base}.json"'
        return resp


class ImportView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request):

        uploaded_file = request.FILES.get('file')
        mode = request.data.get('mode', 'create_only')
        if not uploaded_file:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        filename = uploaded_file.name.lower()
        created = updated = skipped = 0
        errors = []

        try:
            if filename.endswith('.csv'):
                rows = _parse_csv(uploaded_file)
            elif filename.endswith('.json'):
                rows = _parse_json(uploaded_file)
            else:
                return Response({'error': 'Unsupported file type. Use CSV or JSON.'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.warning(str(e))
            return Response({'error': f'Failed to parse file: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)

        lab_cache = {lab.name: lab for lab in Lab.objects.all()}
        team_cache = {team.name: team for team in Team.objects.all()}
        valid_labs = set(lab_cache)
        valid_teams = set(team_cache)

        for i, row in enumerate(rows):
            try:
                serial = (row.get('serial_number') or '').strip()
                if not serial:
                    errors.append({'row': i + 1, 'error': 'serial_number is required'})
                    skipped += 1
                    continue

                row_errors = _validate_import_row(row, i + 1, valid_labs, valid_teams)
                if row_errors:
                    errors.extend([{'row': i + 1, 'error': e} for e in row_errors])
                    skipped += 1
                    continue

                model_name = (row.get('model') or row.get('model__name') or '').strip()
                cluster_name = (row.get('cluster') or row.get('cluster__name') or '').strip()

                model_obj = None
                if model_name:
                    model_obj, _ = DeviceModel.objects.get_or_create(name=model_name)

                cluster_obj = None
                if cluster_name:
                    cluster_obj, _ = Cluster.objects.get_or_create(
                        name=cluster_name,
                        defaults={'host': f'zcloud.{cluster_name}.zededa.net'},
                    )

                lab_name = (row.get('lab') or '').strip()
                team_name = (row.get('team') or '').strip()

                defaults = {}
                for field in ('name', 'description', 'owner_email',
                              'location_detail', 'condition', 'idrac_ip', 'eve_version',
                              'status', 'cluster_device_name'):
                    if row.get(field) not in (None, ''):
                        defaults[field] = row[field]
                if 'condition' in defaults:
                    defaults['condition'] = _normalize_condition(defaults['condition'])
                if model_obj:
                    defaults['model'] = model_obj
                if cluster_obj:
                    defaults['cluster'] = cluster_obj
                if lab_name and lab_name in lab_cache:
                    defaults['lab'] = lab_cache[lab_name]
                if team_name and team_name in team_cache:
                    defaults['team'] = team_cache[team_name]

                existing = Device.objects.filter(serial_number=serial).first()
                if existing:
                    if mode == 'create_only':
                        skipped += 1
                        continue
                    for k, v in defaults.items():
                        setattr(existing, k, v)
                    existing.save()
                    updated += 1
                else:
                    if not model_obj:
                        errors.append({'row': i + 1, 'error': 'model is required for new devices'})
                        skipped += 1
                        continue
                    if not defaults.get('lab'):
                        errors.append({'row': i + 1, 'error': 'lab is required for new devices'})
                        skipped += 1
                        continue
                    Device.objects.create(serial_number=serial, **defaults)
                    created += 1

            except Exception as e:
                logger.warning(str(e))
                errors.append({'row': i + 1, 'error': str(e)})
                skipped += 1

        return Response({'created': created, 'updated': updated, 'skipped': skipped, 'errors': errors})


_FIELD_ALIASES = {
    'serial': 'serial_number',
    'serial_no': 'serial_number',
    'device_name': 'name',
    'model_name': 'model',
    'cluster_name': 'cluster',
    'name_in_cluster': 'cluster_device_name',
    'cluster_device': 'cluster_device_name',
    'location': 'location_detail',
    'lab_location': 'lab',
}

def _normalize_key(key):
    k = key.strip().lower().replace(' ', '_').replace('-', '_').rstrip('.')
    return _FIELD_ALIASES.get(k, k)


def _normalize_condition(value):
    """Convert any casing/spacing variant to the DB snake_case format."""
    if not value:
        return value
    return value.strip().lower().replace(' ', '_').replace('-', '_')

_TEMPLATE_HEADERS = [
    'name', 'serial_number', 'model', 'cluster', 'cluster_device_name',
    'team', 'lab', 'location_detail', 'condition', 'description',
    'idrac_ip', 'idrac_username', 'owner_email',
]

_TEMPLATE_EXAMPLE = [
    'My-Device-01', 'SN123456', 'Dell-XR12', 'hummingbird', 'My-Device-01',
    'ST', 'SanJose Lab', 'Rack 3 Shelf 2', 'normal', 'Example device — delete this row',
    '10.0.0.1', 'root', '',
]


class ImportTemplateView(APIView):
    permission_classes = [IsPortalUser]

    def get(self, request):
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(_TEMPLATE_HEADERS)
        writer.writerow(_TEMPLATE_EXAMPLE)
        response = HttpResponse(output.getvalue(), content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="device_import_template.csv"'
        return response


def _validate_import_row(row, row_num, valid_labs, valid_teams):
    """Returns a list of error strings for fields that fail validation."""
    errs = []

    email = (row.get('owner_email') or '').strip()
    if email:
        try:
            validate_email(email)
        except DjangoValidationError:
            errs.append(f'owner_email "{email}" is not a valid email address')

    ip = (row.get('idrac_ip') or '').strip()
    if ip:
        try:
            ipaddress.ip_address(ip)
        except ValueError:
            errs.append(f'idrac_ip "{ip}" is not a valid IP address')

    condition = (row.get('condition') or '').strip()
    if condition:
        normalized = _normalize_condition(condition)
        if normalized not in _VALID_CONDITIONS:
            errs.append(f'condition "{condition}" is not valid — must be one of: {", ".join(sorted(_VALID_CONDITIONS))}')

    lab = (row.get('lab') or '').strip()
    if lab and lab not in valid_labs:
        errs.append(f'lab "{lab}" is not recognised — must be one of: {", ".join(sorted(valid_labs))}')

    team = (row.get('team') or '').strip()
    if team and team not in valid_teams:
        errs.append(f'team "{team}" is not recognised — must be one of: {", ".join(sorted(valid_teams))}')

    return errs


def _parse_csv(uploaded_file):
    text = uploaded_file.read().decode('utf-8-sig')
    reader = csv.DictReader(io.StringIO(text))
    return [{_normalize_key(k): v for k, v in row.items()} for row in reader]


def _parse_json(uploaded_file):
    data = json.loads(uploaded_file.read().decode('utf-8'))
    if isinstance(data, list):
        return data
    return data.get('results', data.get('devices', []))


def _percentile(sorted_values, pct):
    if not sorted_values:
        return 0
    k = (len(sorted_values) - 1) * pct / 100
    lo, hi = int(k), min(int(k) + 1, len(sorted_values) - 1)
    return round(sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (k - lo))


class LatencyView(APIView):
    permission_classes = [IsAdminPortalUser]
    SLOW_THRESHOLD_MS = 1000
    SLOW_LIMIT = 20
    RETENTION_DAYS = 30

    def get(self, request):

        now = timezone.now()
        window_24h = now - timedelta(hours=24)
        window_7d = now - timedelta(days=7)

        logs_7d = list(
            RequestLog.objects.filter(timestamp__gte=window_7d)
            .values('method', 'path', 'duration_ms', 'status_code', 'timestamp')
            .order_by('timestamp')
        )

        # Group by method+path
        groups: dict[tuple, list[int]] = {}
        counts_24h: dict[tuple, int] = {}
        for row in logs_7d:
            key = (row['method'], row['path'])
            groups.setdefault(key, []).append(row['duration_ms'])
            if row['timestamp'] >= window_24h:
                counts_24h[key] = counts_24h.get(key, 0) + 1

        summary = []
        for (method, path), durations in sorted(groups.items()):
            durations.sort()
            summary.append({
                'method': method,
                'path': path,
                'count_7d': len(durations),
                'count_24h': counts_24h.get((method, path), 0),
                'p50_ms': _percentile(durations, 50),
                'p95_ms': _percentile(durations, 95),
                'p99_ms': _percentile(durations, 99),
                'max_ms': durations[-1],
            })

        # Sort summary by p95 descending so slowest endpoints appear first
        summary.sort(key=lambda r: r['p95_ms'], reverse=True)

        slow = list(
            RequestLog.objects.filter(
                timestamp__gte=window_7d,
                duration_ms__gte=self.SLOW_THRESHOLD_MS,
            )
            .values('method', 'path', 'status_code', 'duration_ms', 'timestamp')
            .order_by('-duration_ms')[:self.SLOW_LIMIT]
        )

        return Response({
            'summary': summary,
            'slow_requests': slow,
            'retention_days': self.RETENTION_DAYS,
            'slow_threshold_ms': self.SLOW_THRESHOLD_MS,
            'total_7d': len(logs_7d),
        })
