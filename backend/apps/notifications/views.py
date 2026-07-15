from django.db.models import Q
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Notification
from .serializers import NotificationSerializer
from utils.permissions import IsPortalUser, get_user_email, is_admin


class NotificationListView(APIView):
    permission_classes = [IsPortalUser]

    def get(self, request):
        user_email = get_user_email(request)
        if is_admin(user_email):
            # Admins see system alerts + their own user notifications
            qs = Notification.objects.filter(
                Q(recipient_email__isnull=True) | Q(recipient_email=user_email)
            ).order_by('is_read', '-created_at')[:50]
        else:
            qs = Notification.objects.filter(
                recipient_email=user_email,
            ).order_by('is_read', '-created_at')[:50]
        return Response(NotificationSerializer(qs, many=True).data)


class NotificationReadView(APIView):
    permission_classes = [IsPortalUser]

    def post(self, request, pk):
        user_email = get_user_email(request)
        try:
            n = Notification.objects.get(pk=pk)
        except Notification.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        # Users can only mark their own notifications; admins can mark any.
        if n.recipient_email and n.recipient_email != user_email and not is_admin(user_email):
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)
        if not n.is_read:
            n.is_read = True
            n.read_at = timezone.now()
            n.save(update_fields=['is_read', 'read_at'])
        return Response(NotificationSerializer(n).data)


class NotificationReadAllView(APIView):
    permission_classes = [IsPortalUser]

    def post(self, request):
        user_email = get_user_email(request)
        now = timezone.now()
        if is_admin(user_email):
            Notification.objects.filter(is_read=False).update(is_read=True, read_at=now)
        else:
            Notification.objects.filter(recipient_email=user_email, is_read=False).update(is_read=True, read_at=now)
        return Response({'ok': True})
