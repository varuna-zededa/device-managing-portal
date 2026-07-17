import csv
import io
import json
import logging

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from .models import Device, Lab, UntrackedDevice
from .serializers import DeviceSerializer, UntrackedDeviceSerializer
from apps.device_models.models import DeviceModel
from apps.reservations.models import OwnershipHistory
from services.zedcloud import STATUS_MAP
from utils.permissions import get_user_email, IsPortalUser, IsAdminPortalUser

logger = logging.getLogger(__name__)

_UNTRACKED_EXPORT_HEADERS = [
    'name', 'serial_number', 'model', 'cluster', 'cluster_device_name',
    'team', 'lab', 'location_detail', 'admin_condition', 'description',
    'idrac_ip', 'idrac_username', 'owner_email',
]


class UntrackedDeviceListView(APIView):
    permission_classes = [IsPortalUser]

    def get(self, request):
        qs = UntrackedDevice.objects.select_related('enterprise__cluster').all()
        enterprise = request.query_params.get('enterprise', '').strip()
        cluster = request.query_params.get('cluster', '').strip()
        serial = request.query_params.get('serial_number', '').strip()
        if enterprise:
            qs = qs.filter(enterprise__name__icontains=enterprise)
        if cluster:
            qs = qs.filter(enterprise__cluster__name__icontains=cluster)
        if serial:
            qs = qs.filter(serial_number__icontains=serial)
        serializer = UntrackedDeviceSerializer(qs[:200], many=True)
        return Response(serializer.data)


class UntrackedDeviceExportView(APIView):
    permission_classes = [IsAdminPortalUser]

    def get(self, request):
        fmt = request.query_params.get('fmt', 'csv').lower()
        qs = (
            UntrackedDevice.objects
            .filter(run_state='RUN_STATE_ONLINE')
            .select_related('enterprise__cluster')
            .order_by('name')
        )
        logger.info('Untracked online device export (%s) by %s', fmt, get_user_email(request))
        ts = timezone.now().strftime('%Y%m%d_%H%M%S')
        filename_base = f'holocron_online_untracked_{ts}'

        rows = [
            {
                'name': d.name,
                'serial_number': d.serial_number,
                'model': d.model or '',
                'cluster': d.enterprise.cluster.name,
                'cluster_device_name': d.name,
                'team': '',
                'lab': '',
                'location_detail': '',
                'admin_condition': 'normal',
                'description': '',
                'idrac_ip': '',
                'idrac_username': '',
                'owner_email': '',
            }
            for d in qs
        ]

        if fmt == 'json':
            resp = HttpResponse(
                json.dumps(rows, indent=2),
                content_type='application/json',
            )
            resp['Content-Disposition'] = f'attachment; filename="{filename_base}.json"'
            return resp

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=_UNTRACKED_EXPORT_HEADERS)
        writer.writeheader()
        writer.writerows(rows)
        resp = HttpResponse(output.getvalue(), content_type='text/csv')
        resp['Content-Disposition'] = f'attachment; filename="{filename_base}.csv"'
        return resp


class MoveToInventoryView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request, pk):
        try:
            untracked = UntrackedDevice.objects.select_related('enterprise__cluster').get(pk=pk)
        except UntrackedDevice.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        if Device.objects.filter(serial_number=untracked.serial_number).exists():
            return Response(
                {'error': f'Device with serial {untracked.serial_number!r} already exists in inventory'},
                status=status.HTTP_409_CONFLICT,
            )

        lab_name = request.data.get('lab', '')
        if not lab_name:
            return Response({'error': 'lab is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            lab = Lab.objects.get(name=lab_name)
        except Lab.DoesNotExist:
            return Response({'error': f'Lab {lab_name!r} not found'}, status=status.HTTP_400_BAD_REQUEST)

        model_obj = None
        model_id = request.data.get('model')
        if model_id:
            try:
                model_obj = DeviceModel.objects.get(pk=model_id)
            except Exception as exc:
                logger.warning('DeviceModel lookup failed: %s', exc)

        if not model_obj:
            return Response({'error': 'model (device model id) is required'}, status=status.HTTP_400_BAD_REQUEST)

        run_state = untracked.run_state or 'RUN_STATE_UNKNOWN'
        status_str = STATUS_MAP.get(run_state, 'Unknown')

        with transaction.atomic():
            device = Device.objects.create(
                name=untracked.name,
                serial_number=untracked.serial_number,
                model=model_obj,
                lab=lab,
                enterprise=untracked.enterprise,
                cluster=untracked.enterprise.cluster,
                cluster_device_name=untracked.name,
                eve_version=untracked.eve_version,
                device_connectivity=untracked.device_connectivity,
                status=status_str,
                status_fetched_at=untracked.last_seen_at,
            )
            user_email = get_user_email(request)
            OwnershipHistory.objects.create(
                device=device,
                owner_email=None,
                changed_by=user_email or 'system',
                reason='device_added',
            )
            untracked.delete()

        logger.info('Untracked device %s (serial=%s) moved to inventory by %s', device.name, device.serial_number, user_email)
        return Response(DeviceSerializer(device).data, status=status.HTTP_201_CREATED)
