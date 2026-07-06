import csv
import io
import json
import logging
from datetime import date
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.http import HttpResponse
from apps.devices.models import Device
from apps.devices.serializers import DeviceSerializer
from apps.clusters.models import Cluster
from apps.device_models.models import DeviceModel
from apps.users.models import PortalUser

logger = logging.getLogger(__name__)


def _get_user_email(request):
    return request.META.get('HTTP_X_USER_EMAIL', '').strip()


def _is_admin(email):
    try:
        user = PortalUser.objects.get(email=email)
        return user.user_type == 'admin'
    except PortalUser.DoesNotExist:
        return False
    except Exception as e:
        logger.debug(str(e))
        return False


class ExportView(APIView):
    def get(self, request):
        user_email = _get_user_email(request)
        if not _is_admin(user_email):
            return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)

        fmt = request.query_params.get('format', 'json').lower()
        devices = Device.objects.select_related('model', 'cluster').all().order_by('name')

        today = date.today().isoformat()

        if fmt == 'csv':
            output = io.StringIO()
            writer = csv.writer(output)
            header = [
                'id', 'name', 'serial_number', 'description',
                'cluster', 'cluster_device_name', 'model', 'customer_partner_name',
                'team', 'owner_email', 'lab', 'location_detail', 'condition',
                'idrac_ip', 'idrac_username', 'eve_version', 'device_connectivity',
                'status', 'last_comment_text', 'created_at', 'updated_at',
            ]
            writer.writerow(header)
            for d in devices:
                writer.writerow([
                    d.id, d.name, d.serial_number, d.description,
                    d.cluster.name if d.cluster else '',
                    d.cluster_device_name or '',
                    d.model.name if d.model else '',
                    d.model.customer_partner_name if d.model else '',
                    d.team or '', d.owner_email or '', d.lab, d.location_detail or '',
                    d.condition, d.idrac_ip or '', d.idrac_username or '',
                    d.eve_version or '',
                    json.dumps(d.device_connectivity) if d.device_connectivity else '',
                    d.status or '', d.last_comment_text or '',
                    d.created_at.isoformat(), d.updated_at.isoformat(),
                ])
            response = HttpResponse(output.getvalue(), content_type='text/csv')
            response['Content-Disposition'] = f'attachment; filename="devices_{today}.csv"'
            return response

        serializer = DeviceSerializer(devices, many=True)
        resp = HttpResponse(
            json.dumps(serializer.data, default=str),
            content_type='application/json',
        )
        resp['Content-Disposition'] = f'attachment; filename="devices_{today}.json"'
        return resp


class ImportView(APIView):
    def post(self, request):
        user_email = _get_user_email(request)
        if not _is_admin(user_email):
            return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)

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
            logger.debug(str(e))
            return Response({'error': f'Failed to parse file: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)

        for i, row in enumerate(rows):
            try:
                serial = (row.get('serial_number') or '').strip()
                if not serial:
                    errors.append({'row': i + 1, 'error': 'serial_number is required'})
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
                        defaults={'host': f'zedcontrol.{cluster_name}.zededa.net'},
                    )

                defaults = {}
                for field in ('name', 'description', 'team', 'owner_email', 'lab',
                              'location_detail', 'condition', 'idrac_ip', 'eve_version', 'status'):
                    if row.get(field) is not None:
                        defaults[field] = row[field]
                if model_obj:
                    defaults['model'] = model_obj
                if cluster_obj:
                    defaults['cluster'] = cluster_obj

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
                    lab = defaults.get('lab', '')
                    if not lab:
                        errors.append({'row': i + 1, 'error': 'lab is required for new devices'})
                        skipped += 1
                        continue
                    Device.objects.create(serial_number=serial, **defaults)
                    created += 1

            except Exception as e:
                logger.debug(str(e))
                errors.append({'row': i + 1, 'error': str(e)})
                skipped += 1

        return Response({'created': created, 'updated': updated, 'skipped': skipped, 'errors': errors})


def _parse_csv(uploaded_file):
    text = uploaded_file.read().decode('utf-8-sig')
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


def _parse_json(uploaded_file):
    data = json.loads(uploaded_file.read().decode('utf-8'))
    if isinstance(data, list):
        return data
    return data.get('results', data.get('devices', []))
