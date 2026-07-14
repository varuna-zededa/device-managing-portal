import logging
from django.db import transaction
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import ReservationRequest, OwnershipHistory
from .serializers import ReservationRequestSerializer, PendingReservationSerializer
from apps.devices.models import Device
from apps.users.models import PortalUser
from utils import email as email_utils
from utils.permissions import get_user_email, is_admin, IsPortalUser

_UNAVAILABLE_CONDITIONS = ('out_of_order', 'temporarily_leased', 'dedicated', 'missing')

logger = logging.getLogger(__name__)


class PendingReservationsView(APIView):
    permission_classes = [IsPortalUser]

    def get(self, request):
        user_email = get_user_email(request)
        reservations = ReservationRequest.objects.filter(
            device__owner_email=user_email, status='pending'
        ).select_related('device').order_by('-requested_at')
        serializer = PendingReservationSerializer(reservations, many=True)
        return Response(serializer.data)


class MyReservationsView(APIView):
    permission_classes = [IsPortalUser]

    def get(self, request):
        user_email = get_user_email(request)
        reservations = ReservationRequest.objects.filter(
            requester_email=user_email
        ).select_related('device').order_by('-requested_at')
        serializer = ReservationRequestSerializer(reservations, many=True)
        return Response(serializer.data)


class ReservationDetailView(APIView):
    permission_classes = []  # token-based, accessed from email link without portal login

    def get(self, request, token):
        try:
            reservation = ReservationRequest.objects.select_related('device').get(token=token)
        except ReservationRequest.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        requester_name = reservation.requester_email
        try:
            u = PortalUser.objects.get(email=reservation.requester_email)
            requester_name = u.name
        except PortalUser.DoesNotExist:
            pass
        except Exception as e:
            logger.warning('PortalUser lookup for requester %s: %s', reservation.requester_email, e)

        return Response({
            'device_name': reservation.device.name,
            'requester_name': requester_name,
            'expires_at': reservation.expires_at,
            'status': reservation.status,
        })


class ReservationApproveView(APIView):
    permission_classes = []  # token-based, accessed from email link without portal login

    def post(self, request, token):
        user_email = get_user_email(request)

        with transaction.atomic():
            try:
                reservation = ReservationRequest.objects.select_for_update().select_related('device').get(token=token)
            except ReservationRequest.DoesNotExist:
                return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

            if reservation.status != 'pending':
                return Response({'error': f'Reservation is already {reservation.status}'}, status=status.HTTP_400_BAD_REQUEST)

            if reservation.expires_at < timezone.now():
                reservation.status = 'expired'
                reservation.save(update_fields=['status'])
                return Response({'error': 'Reservation request has expired'}, status=status.HTTP_410_GONE)

            device = Device.objects.select_for_update().get(pk=reservation.device_id)

            if user_email and user_email != device.owner_email and not is_admin(user_email):
                return Response({'error': 'Only the device owner can approve this request'}, status=status.HTTP_403_FORBIDDEN)

            if device.condition in _UNAVAILABLE_CONDITIONS:
                reservation.status = 'expired'
                reservation.save(update_fields=['status'])
                return Response({'error': 'Device is no longer available for reservation'}, status=status.HTTP_409_CONFLICT)

            old_owner = device.owner_email
            device.owner_email = reservation.requester_email
            device.reserved_at = timezone.now()
            device.save(update_fields=['owner_email', 'reserved_at', 'updated_at'])

            reservation.status = 'approved'
            reservation.save(update_fields=['status'])

            OwnershipHistory.objects.create(
                device=device,
                owner_email=reservation.requester_email,
                changed_by=old_owner or user_email or 'email_link',
                reason='request_approved',
            )

        logger.info('Reservation approved: device=%s, new_owner=%s, approved_by=%s', device.name, reservation.requester_email, user_email or 'email_link')
        email_utils.send_reservation_approved(device, reservation.requester_email)
        return Response({'message': 'Reservation approved', 'device': device.name, 'new_owner': reservation.requester_email})


class ReservationRejectView(APIView):
    permission_classes = []  # token-based, accessed from email link without portal login

    def post(self, request, token):
        user_email = get_user_email(request)

        try:
            reservation = ReservationRequest.objects.select_related('device').get(token=token)
        except ReservationRequest.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        if reservation.status != 'pending':
            return Response({'error': f'Reservation is already {reservation.status}'}, status=status.HTTP_400_BAD_REQUEST)

        if user_email and user_email != reservation.device.owner_email and not is_admin(user_email):
            return Response({'error': 'Only the device owner can reject this request'}, status=status.HTTP_403_FORBIDDEN)

        reservation.status = 'rejected'
        reservation.save(update_fields=['status'])

        logger.info('Reservation rejected: device=%s, requester=%s, rejected_by=%s', reservation.device.name, reservation.requester_email, user_email or 'email_link')
        email_utils.send_reservation_rejected(reservation.device, reservation.requester_email)
        return Response({'message': 'Reservation rejected'})
