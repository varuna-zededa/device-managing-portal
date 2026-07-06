import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import ReservationRequest, OwnershipHistory
from .serializers import ReservationRequestSerializer
from apps.users.models import PortalUser
from utils import email as email_utils

logger = logging.getLogger(__name__)


def _get_user_email(request):
    return request.META.get('HTTP_X_USER_EMAIL', '').strip()


class PendingReservationsView(APIView):
    def get(self, request):
        user_email = _get_user_email(request)
        if not user_email:
            return Response({'error': 'X-User-Email header required'}, status=status.HTTP_400_BAD_REQUEST)
        reservations = ReservationRequest.objects.filter(
            device__owner_email=user_email, status='pending'
        ).select_related('device').order_by('-requested_at')
        serializer = ReservationRequestSerializer(reservations, many=True)
        return Response(serializer.data)


class MyReservationsView(APIView):
    def get(self, request):
        user_email = _get_user_email(request)
        if not user_email:
            return Response({'error': 'X-User-Email header required'}, status=status.HTTP_400_BAD_REQUEST)
        reservations = ReservationRequest.objects.filter(
            requester_email=user_email
        ).select_related('device').order_by('-requested_at')
        serializer = ReservationRequestSerializer(reservations, many=True)
        return Response(serializer.data)


class ReservationDetailView(APIView):
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
            logger.debug(str(e))

        return Response({
            'device_name': reservation.device.name,
            'requester_name': requester_name,
            'expires_at': reservation.expires_at,
            'status': reservation.status,
        })


class ReservationApproveView(APIView):
    def post(self, request, token):
        try:
            reservation = ReservationRequest.objects.select_related('device').get(token=token)
        except ReservationRequest.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        if reservation.status != 'pending':
            return Response({'error': f'Reservation is already {reservation.status}'}, status=status.HTTP_400_BAD_REQUEST)

        device = reservation.device
        old_owner = device.owner_email
        device.owner_email = reservation.requester_email
        device.save(update_fields=['owner_email', 'updated_at'])

        reservation.status = 'approved'
        reservation.save(update_fields=['status'])

        OwnershipHistory.objects.create(
            device=device,
            owner_email=reservation.requester_email,
            changed_by=old_owner or 'system',
            reason='request_approved',
        )

        email_utils.send_reservation_approved(device, reservation.requester_email)
        return Response({'message': 'Reservation approved', 'device': device.name, 'new_owner': reservation.requester_email})


class ReservationRejectView(APIView):
    def post(self, request, token):
        try:
            reservation = ReservationRequest.objects.select_related('device').get(token=token)
        except ReservationRequest.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        if reservation.status != 'pending':
            return Response({'error': f'Reservation is already {reservation.status}'}, status=status.HTTP_400_BAD_REQUEST)

        reservation.status = 'rejected'
        reservation.save(update_fields=['status'])

        email_utils.send_reservation_rejected(reservation.device, reservation.requester_email)
        return Response({'message': 'Reservation rejected'})
