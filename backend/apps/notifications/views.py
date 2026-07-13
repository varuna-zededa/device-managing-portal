from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Notification
from .serializers import NotificationSerializer
from utils.permissions import IsAdminPortalUser


class NotificationListView(APIView):
    permission_classes = [IsAdminPortalUser]

    def get(self, request):
        qs = Notification.objects.order_by('is_read', '-created_at')[:50]
        return Response(NotificationSerializer(qs, many=True).data)


class NotificationReadView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request, pk):
        try:
            n = Notification.objects.get(pk=pk)
        except Notification.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        if not n.is_read:
            n.is_read = True
            n.read_at = timezone.now()
            n.save(update_fields=['is_read', 'read_at'])
        return Response(NotificationSerializer(n).data)


class NotificationReadAllView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request):
        now = timezone.now()
        Notification.objects.filter(is_read=False).update(is_read=True, read_at=now)
        return Response({'ok': True})
