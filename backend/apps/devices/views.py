import logging
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from django.db.models import Q

from .models import Device, Lab, CONDITION_CHOICES
from .serializers import DeviceSerializer, DeviceCreateSerializer
from apps.clusters.models import Cluster
from apps.device_models.models import DeviceModel
from apps.reservations.models import ReservationRequest, DeviceComment, OwnershipHistory
from apps.reservations.serializers import DeviceCommentSerializer, OwnershipHistorySerializer
from apps.users.models import Team, PortalUser
from apps.vault.models import Vault
from utils.crypto import encrypt, decrypt
from utils import email as email_utils
from services.zedcloud import fetch_device_status, SerialMismatchError
import httpx

logger = logging.getLogger(__name__)

UNAVAILABLE_CONDITIONS = ('out_of_order', 'temporarily_leased', 'dedicated', 'missing')


def _get_user_email(request):
    return request.META.get('HTTP_X_USER_EMAIL', '').strip()


def _is_admin(email):
    try:
        user = PortalUser.objects.get(email=email)
        return user.user_type == 'admin'
    except PortalUser.DoesNotExist:
        return False
    except Exception as e:
        logger.warning(str(e))
        return False


def _handle_condition_change(device, new_condition, old_condition, changed_by):
    if new_condition == old_condition:
        return

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
    def get(self, request):
        qs = Device.objects.select_related('model', 'cluster').all()

        q = request.query_params.get('q', '').strip()
        available = request.query_params.get('available', 'all').strip().lower()
        team = request.query_params.get('team', '').strip()
        lab = request.query_params.get('lab', '').strip()
        condition = request.query_params.get('condition', '').strip()

        if team == 'unassigned':
            qs = qs.filter(team__isnull=True)
        elif team:
            qs = qs.filter(team=team)
        if lab:
            qs = qs.filter(lab=lab)
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
                | Q(last_comment_text__icontains=q)
                | Q(owner_email__in=owner_emails)
            )

        serializer = DeviceSerializer(qs.order_by('name'), many=True)
        return Response(serializer.data)

    def post(self, request):
        serial = request.data.get('serial_number', '')
        if Device.objects.filter(serial_number=serial).exists():
            return Response({'error': 'Serial number already exists'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = DeviceCreateSerializer(data=request.data)
        if serializer.is_valid():
            device = serializer.save()
            idrac_password = request.data.get('idrac_password', '').strip()
            if idrac_password:
                device.idrac_password_enc = encrypt(idrac_password)
                device.save(update_fields=['idrac_password_enc', 'updated_at'])
            user_email = _get_user_email(request)
            OwnershipHistory.objects.create(
                device=device,
                owner_email=device.owner_email,
                changed_by=user_email or 'system',
                reason='device_added',
            )
            return Response(DeviceSerializer(device).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class DeviceDetailView(APIView):
    def _get_device(self, pk):
        try:
            return Device.objects.select_related('model', 'cluster').get(pk=pk)
        except Device.DoesNotExist:
            return None

    def put(self, request, pk):
        device = self._get_device(pk)
        if not device:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        user_email = _get_user_email(request)
        data = request.data.copy()
        data.pop('serial_number', None)

        old_condition = device.condition
        new_condition = data.get('condition', old_condition)

        if new_condition == 'dedicated' and not data.get('team', device.team):
            return Response({'error': 'team is required when condition is dedicated'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = DeviceSerializer(device, data=data, partial=True)
        if serializer.is_valid():
            _handle_condition_change(device, new_condition, old_condition, user_email)
            serializer.save()
            idrac_password = request.data.get('idrac_password', '').strip()
            if idrac_password:
                device.idrac_password_enc = encrypt(idrac_password)
                device.save(update_fields=['idrac_password_enc', 'updated_at'])
            return Response(DeviceSerializer(device).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        user_email = _get_user_email(request)
        if not _is_admin(user_email):
            return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)
        device = self._get_device(pk)
        if not device:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        device.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DeviceReserveView(APIView):
    def post(self, request, pk):
        requester_email = _get_user_email(request)
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
                logger.warning(str(e))
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
            logger.warning(str(e))

        requester_user = None
        try:
            requester_user = PortalUser.objects.get(email=requester_email)
        except PortalUser.DoesNotExist:
            pass
        except Exception as e:
            logger.warning(str(e))

        email_utils.send_reservation_request(device, requester_user or requester_email, owner_user or device.owner_email, token)
        return Response({'message': 'Reservation request sent to device owner'}, status=status.HTTP_202_ACCEPTED)


class DeviceForceAssignView(APIView):
    def post(self, request, pk):
        user_email = _get_user_email(request)
        if not _is_admin(user_email):
            return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)

        try:
            device = Device.objects.get(pk=pk)
        except Device.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        assignee_email = request.data.get('assignee_email', '').strip()
        if not assignee_email:
            return Response({'error': 'assignee_email is required'}, status=status.HTTP_400_BAD_REQUEST)

        displaced_owner = device.owner_email
        device.owner_email = assignee_email
        device.reserved_at = timezone.now()
        device.save(update_fields=['owner_email', 'reserved_at', 'updated_at'])

        OwnershipHistory.objects.create(
            device=device,
            owner_email=assignee_email,
            changed_by=user_email,
            reason='force_assigned',
        )

        pending = ReservationRequest.objects.filter(device=device, status='pending')
        for req in pending:
            if req.requester_email != assignee_email:
                email_utils.send_reservation_overridden(device, req.requester_email)
        pending.update(status='expired')

        if displaced_owner and displaced_owner != assignee_email:
            assignee_name = assignee_email
            try:
                u = PortalUser.objects.get(email=assignee_email)
                assignee_name = u.name
            except PortalUser.DoesNotExist:
                pass
            except Exception as e:
                logger.warning(str(e))
            email_utils.send_force_assign_notice(device, displaced_owner, assignee_name)

        return Response(DeviceSerializer(device).data)


class DeviceReleaseView(APIView):
    def post(self, request, pk):
        user_email = _get_user_email(request)
        if not user_email:
            return Response({'error': 'X-User-Email header required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            device = Device.objects.get(pk=pk)
        except Device.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        if device.owner_email != user_email:
            return Response({'error': 'Only the owner can release a device'}, status=status.HTTP_403_FORBIDDEN)

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
            email_utils.send_reservation_approved(device, pending.requester_email)
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

        return Response(DeviceSerializer(device).data)


class DeviceStatusView(APIView):
    def post(self, request, pk):
        try:
            device = Device.objects.select_related('cluster').get(pk=pk)
        except Device.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        bearer_token = request.data.get('bearer_token', '').strip()
        cluster_id = request.data.get('cluster_id')
        cluster_device_name = request.data.get('cluster_device_name', '').strip()
        user_email = _get_user_email(request)

        if cluster_id:
            try:
                cluster = Cluster.objects.get(pk=cluster_id)
                device.cluster = cluster
            except Cluster.DoesNotExist:
                return Response({'error': 'Cluster not found'}, status=status.HTTP_400_BAD_REQUEST)
            except Exception as e:
                logger.warning(str(e))

        if cluster_device_name:
            device.cluster_device_name = cluster_device_name

        if not device.cluster:
            return Response({'error': 'Device has no cluster assigned'}, status=status.HTTP_400_BAD_REQUEST)

        if not device.cluster_device_name:
            return Response({'error': 'cluster_device_name is required'}, status=status.HTTP_400_BAD_REQUEST)

        resolved_token = bearer_token
        if not resolved_token:
            try:
                vault = Vault.objects.get(user_email=user_email, cluster=device.cluster)
                resolved_token = decrypt(bytes(vault.bearer_token_enc))
            except Vault.DoesNotExist:
                return Response({'error': 'No bearer token provided and none stored in vault'}, status=status.HTTP_400_BAD_REQUEST)
            except Exception as e:
                logger.warning(str(e))
                return Response({'error': 'Failed to retrieve stored token'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        try:
            eve_version, device_connectivity, dev_status = fetch_device_status(
                cluster=device.cluster,
                cluster_device_name=device.cluster_device_name,
                bearer_token=resolved_token,
                device=device,
            )
            if bearer_token:
                Vault.objects.update_or_create(
                    user_email=user_email,
                    cluster=device.cluster,
                    defaults={'bearer_token_enc': encrypt(bearer_token)},
                )
            device.eve_version = eve_version
            device.device_connectivity = device_connectivity
            device.status = dev_status
            device.status_fetched_at = timezone.now()
            device.save(update_fields=['cluster', 'cluster_device_name', 'eve_version', 'device_connectivity', 'status', 'status_fetched_at', 'updated_at'])
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
            return Response(
                {'error': f'ZedCloud returned HTTP {code}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as e:
            logger.exception('Failed to fetch status for device %s', device.name)
            return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


class DeviceCommentListCreateView(APIView):
    def get(self, request, pk):
        comments = DeviceComment.objects.filter(device_id=pk).order_by('-created_at')[:10]
        serializer = DeviceCommentSerializer(comments, many=True)
        return Response(serializer.data)

    def post(self, request, pk):
        try:
            device = Device.objects.get(pk=pk)
        except Device.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        author_email = _get_user_email(request)
        text = request.data.get('text', '').strip()
        if not text:
            return Response({'error': 'text is required'}, status=status.HTTP_400_BAD_REQUEST)

        comment = DeviceComment.objects.create(device=device, author_email=author_email, text=text)

        old_ids = DeviceComment.objects.filter(device=device).order_by('-created_at').values_list('id', flat=True)[10:]
        if old_ids:
            DeviceComment.objects.filter(id__in=list(old_ids)).delete()

        device.last_comment_text = comment.text
        device.last_comment_by = author_email
        device.last_comment_at = comment.created_at
        device.save(update_fields=['last_comment_text', 'last_comment_by', 'last_comment_at', 'updated_at'])

        return Response(DeviceCommentSerializer(comment).data, status=status.HTTP_201_CREATED)


class DeviceOwnershipHistoryView(APIView):
    def get(self, request, pk):
        user_email = _get_user_email(request)
        if not _is_admin(user_email):
            return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)
        history = OwnershipHistory.objects.filter(device_id=pk).order_by('-changed_at')
        serializer = OwnershipHistorySerializer(history, many=True)
        return Response(serializer.data)


class ChoicesView(APIView):
    def get(self, request):
        return Response({
            'labs': list(Lab.objects.values_list('name', flat=True)),
            'teams': list(Team.objects.values_list('name', flat=True)),
            'conditions': [c[0] for c in CONDITION_CHOICES],
        })
