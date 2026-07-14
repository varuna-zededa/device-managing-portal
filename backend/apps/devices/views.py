import logging
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from django.db.models import Q

from .models import Device, Lab, CONDITION_CHOICES, UntrackedDevice
from .serializers import DeviceSerializer, DeviceCreateSerializer, UntrackedDeviceSerializer
from apps.clusters.models import Cluster
from apps.device_models.models import DeviceModel
from apps.reservations.models import ReservationRequest, DevicePurpose, OwnershipHistory
from apps.reservations.serializers import DevicePurposeSerializer, OwnershipHistorySerializer
from apps.users.models import Team, PortalUser
from utils.crypto import encrypt, decrypt
from utils import email as email_utils
from utils.permissions import get_user_email, is_admin, IsPortalUser, IsAdminPortalUser
from services.zedcloud import fetch_device_status, fetch_enterprise_devices, SerialMismatchError, STATUS_MAP
import httpx

logger = logging.getLogger(__name__)

UNAVAILABLE_CONDITIONS = ('out_of_order', 'temporarily_leased', 'dedicated', 'missing')


def _handle_condition_change(device, new_condition, old_condition, changed_by):
    if new_condition == old_condition:
        return
    logger.info('Device %s condition changed: %s → %s by %s', device.name, old_condition, new_condition, changed_by)

    if new_condition in ('out_of_order', 'temporarily_leased', 'missing'):
        old_owner = device.owner_email
        device.owner_email = None
        pending = ReservationRequest.objects.filter(device=device, status='pending')
        pending.update(status='expired')
        OwnershipHistory.objects.create(
            device=device,
            owner_email=old_owner,
            changed_by=changed_by,
            reason='condition_change',
        )
        if new_condition == 'out_of_order':
            email_utils.send_out_of_order_alert(device)

    elif new_condition == 'dedicated':
        old_owner = device.owner_email
        device.owner_email = None
        pending = ReservationRequest.objects.filter(device=device, status='pending')
        pending.update(status='expired')
        OwnershipHistory.objects.create(
            device=device,
            owner_email=old_owner,
            changed_by=changed_by,
            reason='condition_change',
        )


class DeviceListCreateView(APIView):
    permission_classes = [IsPortalUser]

    def get(self, request):
        qs = Device.objects.select_related('model', 'cluster', 'lab', 'team', 'enterprise').all()

        q = request.query_params.get('q', '').strip()
        available = request.query_params.get('available', 'all').strip().lower()
        team = request.query_params.get('team', '').strip()
        lab = request.query_params.get('lab', '').strip()
        condition = request.query_params.get('condition', '').strip()

        if team == 'unassigned':
            qs = qs.filter(team__isnull=True)
        elif team:
            qs = qs.filter(team__name=team)
        if lab:
            qs = qs.filter(lab__name=lab)
        if condition:
            qs = qs.filter(condition=condition)

        if available == 'true':
            qs = qs.filter(owner_email__isnull=True).exclude(condition__in=UNAVAILABLE_CONDITIONS)
        elif available == 'false':
            qs = qs.filter(
                Q(owner_email__isnull=False) | Q(condition__in=UNAVAILABLE_CONDITIONS)
            )

        if q:
            owner_emails = list(
                PortalUser.objects.filter(name__icontains=q).values_list('email', flat=True)
            )
            qs = qs.filter(
                Q(name__icontains=q)
                | Q(model__name__icontains=q)
                | Q(model__customer_partner_name__icontains=q)
                | Q(cluster__name__icontains=q)
                | Q(eve_version__icontains=q)
                | Q(last_purpose_text__icontains=q)
                | Q(owner_email__in=owner_emails)
            )

        owner_lookup = {u.email: u.name for u in PortalUser.objects.only('email', 'name')}
        serializer = DeviceSerializer(qs.order_by('name'), many=True, context={'owner_lookup': owner_lookup})
        return Response(serializer.data)

    def post(self, request):
        user_email = get_user_email(request)
        serial = request.data.get('serial_number', '')
        if Device.objects.filter(serial_number=serial).exists():
            return Response({'error': 'Serial number already exists'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = DeviceCreateSerializer(data=request.data)
        if serializer.is_valid():
            with transaction.atomic():
                device = serializer.save()
                idrac_password = request.data.get('idrac_password', '').strip()
                if idrac_password:
                    device.idrac_password_enc = encrypt(idrac_password)
                    device.save(update_fields=['idrac_password_enc', 'updated_at'])
                OwnershipHistory.objects.create(
                    device=device,
                    owner_email=device.owner_email,
                    changed_by=user_email or 'system',
                    reason='device_added',
                )
            UntrackedDevice.objects.filter(serial_number=serial).delete()
            logger.info('Device %s (serial=%s) added to inventory by %s', device.name, serial, user_email)
            return Response(DeviceSerializer(device).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class DeviceDetailView(APIView):
    permission_classes = [IsPortalUser]

    def _get_device(self, pk):
        try:
            return Device.objects.select_related('model', 'cluster', 'lab', 'team', 'enterprise').get(pk=pk)
        except Device.DoesNotExist:
            return None

    def put(self, request, pk):
        device = self._get_device(pk)
        if not device:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        user_email = get_user_email(request)
        data = request.data.copy()
        data.pop('serial_number', None)

        old_condition = device.condition
        new_condition = data.get('condition', old_condition)

        if new_condition == 'dedicated' and not data.get('team', device.team):
            return Response({'error': 'team is required when condition is dedicated'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = DeviceSerializer(device, data=data, partial=True)
        if serializer.is_valid():
            with transaction.atomic():
                _handle_condition_change(device, new_condition, old_condition, user_email)
                serializer.save()
                idrac_password = request.data.get('idrac_password', '').strip()
                if idrac_password:
                    device.idrac_password_enc = encrypt(idrac_password)
                    device.save(update_fields=['idrac_password_enc', 'updated_at'])
            logger.info('Device %s updated by %s', device.name, user_email)
            return Response(DeviceSerializer(device).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        user_email = get_user_email(request)
        if not is_admin(user_email):
            return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)
        device = self._get_device(pk)
        if not device:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        logger.info('Device %s (serial=%s) deleted by %s', device.name, device.serial_number, user_email)
        device.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DeviceReserveView(APIView):
    permission_classes = [IsPortalUser]

    def post(self, request, pk):
        requester_email = get_user_email(request)
        if not requester_email:
            return Response({'error': 'X-User-Email header required'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            try:
                device = Device.objects.select_for_update().get(pk=pk)
            except Device.DoesNotExist:
                return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

            if device.is_available:
                device.owner_email = requester_email
                device.reserved_at = timezone.now()
                device.save(update_fields=['owner_email', 'reserved_at', 'updated_at'])
                OwnershipHistory.objects.create(
                    device=device,
                    owner_email=requester_email,
                    changed_by=requester_email,
                    reason='reserved',
                )
                logger.info('Device %s directly reserved by %s', device.name, requester_email)
                return Response(DeviceSerializer(device).data)

        existing = ReservationRequest.objects.filter(device=device, status='pending').first()
        if existing:
            requester_name = existing.requester_email
            try:
                u = PortalUser.objects.get(email=existing.requester_email)
                requester_name = u.name
            except PortalUser.DoesNotExist:
                pass
            except Exception as e:
                logger.warning('PortalUser lookup for requester %s: %s', existing.requester_email, e)
            return Response(
                {'error': 'A pending request already exists', 'requester': requester_name, 'requester_email': existing.requester_email, 'expires_at': existing.expires_at},
                status=status.HTTP_409_CONFLICT,
            )

        token = secrets.token_hex(32)
        expires_at = timezone.now() + timedelta(hours=3)
        reservation = ReservationRequest.objects.create(
            device=device,
            requester_email=requester_email,
            expires_at=expires_at,
            token=token,
        )

        owner_user = None
        try:
            owner_user = PortalUser.objects.get(email=device.owner_email)
        except PortalUser.DoesNotExist:
            pass
        except Exception as e:
            logger.warning('PortalUser lookup for owner %s on device %s: %s', device.owner_email, device.name, e)

        requester_user = None
        try:
            requester_user = PortalUser.objects.get(email=requester_email)
        except PortalUser.DoesNotExist:
            pass
        except Exception as e:
            logger.warning('PortalUser lookup for requester %s: %s', requester_email, e)

        logger.info('Reservation request for device %s from %s (owner: %s)', device.name, requester_email, device.owner_email)
        email_utils.send_reservation_request(device, requester_user or requester_email, owner_user or device.owner_email, token)
        return Response({'message': 'Reservation request sent to device owner'}, status=status.HTTP_202_ACCEPTED)


class DeviceForceAssignView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request, pk):
        user_email = get_user_email(request)

        try:
            device = Device.objects.get(pk=pk)
        except Device.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        assignee_email = request.data.get('assignee_email', '').strip()
        if not assignee_email:
            return Response({'error': 'assignee_email is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not PortalUser.objects.filter(email=assignee_email).exists():
            return Response({'error': f'{assignee_email!r} is not a registered user'}, status=status.HTTP_400_BAD_REQUEST)

        displaced_owner = device.owner_email
        overridden_emails = []

        with transaction.atomic():
            device.owner_email = assignee_email
            device.reserved_at = timezone.now()
            device.save(update_fields=['owner_email', 'reserved_at', 'updated_at'])

            OwnershipHistory.objects.create(
                device=device,
                owner_email=assignee_email,
                changed_by=user_email,
                reason='force_assigned',
            )

            pending = list(ReservationRequest.objects.filter(device=device, status='pending'))
            overridden_emails = [r.requester_email for r in pending if r.requester_email != assignee_email]
            ReservationRequest.objects.filter(device=device, status='pending').update(status='expired')

        logger.info('Device %s force-assigned to %s by %s (displaced: %s)', device.name, assignee_email, user_email, displaced_owner or 'none')
        for req_email in overridden_emails:
            email_utils.send_reservation_overridden(device, req_email)

        if displaced_owner and displaced_owner != assignee_email:
            assignee_name = assignee_email
            try:
                u = PortalUser.objects.get(email=assignee_email)
                assignee_name = u.name
            except PortalUser.DoesNotExist:
                pass
            except Exception as e:
                logger.warning('PortalUser lookup for assignee %s: %s', assignee_email, e)
            email_utils.send_force_assign_notice(device, displaced_owner, assignee_name)

        return Response(DeviceSerializer(device).data)


class DeviceReleaseView(APIView):
    permission_classes = [IsPortalUser]

    def post(self, request, pk):
        user_email = get_user_email(request)
        if not user_email:
            return Response({'error': 'X-User-Email header required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            device = Device.objects.get(pk=pk)
        except Device.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        if device.owner_email != user_email:
            return Response({'error': 'Only the owner can release a device'}, status=status.HTTP_403_FORBIDDEN)

        approved_email = None
        with transaction.atomic():
            pending = ReservationRequest.objects.filter(device=device, status='pending').order_by('requested_at').first()
            if pending:
                device.owner_email = pending.requester_email
                device.reserved_at = timezone.now()
                device.save(update_fields=['owner_email', 'reserved_at', 'updated_at'])
                pending.status = 'approved'
                pending.save(update_fields=['status'])
                OwnershipHistory.objects.create(
                    device=device,
                    owner_email=pending.requester_email,
                    changed_by=user_email,
                    reason='request_approved',
                )
                approved_email = pending.requester_email
            else:
                device.owner_email = None
                device.reserved_at = None
                device.save(update_fields=['owner_email', 'reserved_at', 'updated_at'])
                OwnershipHistory.objects.create(
                    device=device,
                    owner_email=None,
                    changed_by=user_email,
                    reason='released',
                )

        if approved_email:
            logger.info('Device %s released by %s; pending request auto-approved for %s', device.name, user_email, approved_email)
            email_utils.send_reservation_approved(device, approved_email)
        else:
            logger.info('Device %s released by %s', device.name, user_email)

        return Response(DeviceSerializer(device).data)


class DeviceStatusView(APIView):
    permission_classes = [IsPortalUser]

    def post(self, request, pk):
        try:
            device = Device.objects.select_related('cluster', 'enterprise__cluster').get(pk=pk)
        except Device.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        enterprise_id = request.data.get('enterprise_id')

        if enterprise_id:
            try:
                from apps.enterprises.models import Enterprise
                enterprise = Enterprise.objects.select_related('cluster').get(pk=enterprise_id)
            except Enterprise.DoesNotExist:
                return Response({'error': 'Enterprise not found'}, status=status.HTTP_400_BAD_REQUEST)
        elif device.enterprise_id:
            enterprise = device.enterprise
        else:
            return Response(
                {'error': 'No enterprise assigned to this device and no enterprise_id provided'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        same_enterprise = (not enterprise_id or enterprise.pk == device.enterprise_id)
        use_single = same_enterprise and bool(device.cluster_device_name)

        try:
            bearer_token = decrypt(bytes(enterprise.bearer_token_enc))
        except Exception:
            return Response(
                {'error': 'Stored bearer token is corrupt — re-enter it in the Clusters & Enterprises tab'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            if use_single:
                eve_version, device_connectivity, dev_status = fetch_device_status(
                    cluster=enterprise.cluster,
                    cluster_device_name=device.cluster_device_name,
                    bearer_token=bearer_token,
                    device=device,
                )
            else:
                from apps.enterprises.sync import _extract_eve_version, _extract_connectivity  # noqa: PLC0415
                raw_devices = fetch_enterprise_devices(enterprise.cluster.host, bearer_token)
                matched = next(
                    (
                        d for d in raw_devices
                        if (
                            d.get('minfo', {}).get('serialNumber', '')
                            or d.get('hardwareInfo', {}).get('serialNum', '')
                        ) == device.serial_number
                    ),
                    None,
                )
                if not matched:
                    return Response(
                        {'error': f'Serial {device.serial_number!r} not found in enterprise {enterprise.name!r}'},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                run_state = matched.get('runState', 'RUN_STATE_UNKNOWN')
                dev_status = STATUS_MAP.get(run_state, 'Unknown')
                eve_version = _extract_eve_version(matched.get('swInfo', []))
                device_connectivity = _extract_connectivity(matched.get('netStatusList', []))
                device_name = matched.get('name')
                if device_name:
                    device.cluster_device_name = device_name

            device.eve_version = eve_version
            device.device_connectivity = device_connectivity
            device.status = dev_status
            device.status_fetched_at = timezone.now()
            device.save(update_fields=[
                'cluster_device_name',
                'eve_version', 'device_connectivity', 'status', 'status_fetched_at', 'updated_at',
            ])
            return Response(DeviceSerializer(device).data)

        except SerialMismatchError as e:
            return Response(
                {'error': 'Serial number mismatch', 'expected': e.expected, 'actual': e.actual},
                status=status.HTTP_409_CONFLICT,
            )
        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            if code == 404:
                device.eve_version = 'Unknown'
                device.device_connectivity = None
                device.status = 'Unknown'
                device.status_fetched_at = timezone.now()
                device.save(update_fields=['eve_version', 'device_connectivity', 'status', 'status_fetched_at', 'updated_at'])
                return Response(DeviceSerializer(device).data)
            if code in (401, 403):
                return Response({'error': 'Bearer token invalid or expired'}, status=status.HTTP_403_FORBIDDEN)
            logger.exception('ZedCloud HTTP error %s for device %s', code, device.name)
            return Response({'error': f'ZedCloud returned HTTP {code}'}, status=status.HTTP_502_BAD_GATEWAY)
        except Exception as e:
            logger.exception('Failed to fetch status for device %s', device.name)
            return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


class DevicePurposeView(APIView):
    permission_classes = [IsPortalUser]

    def get(self, request, pk):
        entries = DevicePurpose.objects.filter(device_id=pk).order_by('-created_at')[:10]
        serializer = DevicePurposeSerializer(entries, many=True)
        return Response(serializer.data)

    def post(self, request, pk):
        try:
            device = Device.objects.get(pk=pk)
        except Device.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        author_email = get_user_email(request)
        text = request.data.get('text', '').strip()

        if not text:
            if not is_admin(author_email) and device.owner_email != author_email:
                return Response({'error': 'Only the device owner or an admin can clear the purpose.'}, status=status.HTTP_403_FORBIDDEN)
            device.last_purpose_text = None
            device.last_purpose_by = None
            device.last_purpose_at = None
            device.save(update_fields=['last_purpose_text', 'last_purpose_by', 'last_purpose_at', 'updated_at'])
            logger.info('Device %s purpose cleared by %s', device.name, author_email)
            return Response({}, status=status.HTTP_200_OK)

        entry = DevicePurpose.objects.create(device=device, author_email=author_email, text=text)

        old_ids = DevicePurpose.objects.filter(device=device).order_by('-created_at').values_list('id', flat=True)[10:]
        if old_ids:
            DevicePurpose.objects.filter(id__in=list(old_ids)).delete()

        device.last_purpose_text = entry.text
        device.last_purpose_by = author_email
        device.last_purpose_at = entry.created_at
        device.save(update_fields=['last_purpose_text', 'last_purpose_by', 'last_purpose_at', 'updated_at'])

        logger.info('Device %s purpose set by %s', device.name, author_email)
        return Response(DevicePurposeSerializer(entry).data, status=status.HTTP_201_CREATED)


class DeviceOwnershipHistoryView(APIView):
    permission_classes = [IsAdminPortalUser]

    def get(self, request, pk):
        entries = list(OwnershipHistory.objects.filter(device_id=pk).order_by('-changed_at')[:51])
        has_more = len(entries) == 51
        serializer = OwnershipHistorySerializer(entries[:50], many=True)
        return Response({'results': serializer.data, 'has_more': has_more})


class ChoicesView(APIView):
    permission_classes = [IsPortalUser]

    def get(self, request):
        from apps.enterprises.models import Enterprise
        enterprises = list(
            Enterprise.objects.select_related('cluster').values('id', 'name', 'cluster__name')
        )
        return Response({
            'labs': list(Lab.objects.values_list('name', flat=True)),
            'teams': list(Team.objects.values_list('name', flat=True)),
            'conditions': [c[0] for c in CONDITION_CHOICES],
            'enterprises': [
                {'id': e['id'], 'name': e['name'], 'cluster_name': e['cluster__name']}
                for e in enterprises
            ],
        })


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
