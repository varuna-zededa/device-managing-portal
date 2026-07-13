import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Enterprise
from .serializers import EnterpriseReadSerializer, EnterpriseUpdateSerializer
from .sync import sync_enterprise
from utils.permissions import IsAdminPortalUser
import httpx

logger = logging.getLogger(__name__)


class EnterpriseDetailView(APIView):
    permission_classes = [IsAdminPortalUser]

    def _get(self, pk):
        try:
            return Enterprise.objects.select_related('cluster').get(pk=pk)
        except Enterprise.DoesNotExist:
            return None

    def patch(self, request, pk):
        enterprise = self._get(pk)
        if not enterprise:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = EnterpriseUpdateSerializer(enterprise, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(EnterpriseReadSerializer(enterprise).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        enterprise = self._get(pk)
        if not enterprise:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        enterprise.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EnterpriseSyncView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request, pk):
        try:
            enterprise = Enterprise.objects.select_related('cluster').get(pk=pk)
        except Enterprise.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        try:
            sync_enterprise(enterprise)
            enterprise.last_sync_status = 'ok'
            enterprise.last_sync_error = None
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            enterprise.last_sync_status = 'token_expired' if code in (401, 403) else 'error'
            enterprise.last_sync_error = f'HTTP {code}'
        except Exception as exc:
            enterprise.last_sync_status = 'error'
            enterprise.last_sync_error = str(exc)
        from django.utils import timezone
        enterprise.last_sync_at = timezone.now()
        enterprise.save(update_fields=['last_sync_at', 'last_sync_status', 'last_sync_error'])
        return Response(EnterpriseReadSerializer(enterprise).data)
