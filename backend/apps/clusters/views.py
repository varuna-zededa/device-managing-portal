import httpx
from django.db.models import Count
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Cluster
from .serializers import ClusterSerializer
from apps.enterprises.models import Enterprise
from apps.enterprises.serializers import EnterpriseCreateSerializer, EnterpriseReadSerializer
from services.zedcloud import fetch_enterprise_self, fetch_user_self, ENTERPRISE_STATE_ACTIVE
from utils.crypto import encrypt
from utils.permissions import IsPortalUser, IsAdminPortalUser

import logging
logger = logging.getLogger(__name__)


class ClusterListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsPortalUser()]
        return [IsAdminPortalUser()]

    def get(self, request):
        clusters = (
            Cluster.objects
            .prefetch_related('enterprises__cluster')
            .annotate(device_count=Count('device'))
            .order_by('-device_count', 'name')
        )
        serializer = ClusterSerializer(clusters, many=True)
        return Response(serializer.data)

    def post(self, request):
        data = request.data.copy()
        if 'host' not in data or not data['host']:
            name = data.get('name', '').lower().strip()
            data['host'] = f'zcloud.{name}.zededa.net'
        serializer = ClusterSerializer(data=data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ClusterDetailView(APIView):
    permission_classes = [IsAdminPortalUser]

    def _get(self, pk):
        try:
            return Cluster.objects.prefetch_related('enterprises').get(pk=pk)
        except Cluster.DoesNotExist:
            return None

    def patch(self, request, pk):
        cluster = self._get(pk)
        if not cluster:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = ClusterSerializer(cluster, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(ClusterSerializer(cluster).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        cluster = self._get(pk)
        if not cluster:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        if cluster.enterprises.exists():
            return Response(
                {'error': 'Cannot delete cluster with enterprises. Remove enterprises first.'},
                status=status.HTTP_409_CONFLICT,
            )
        cluster.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _fetch_username(host: str, bearer_token: str, enterprise_name: str) -> str:
    """Call /v1/users/self and return the username. Logs a warning and returns '' on any failure."""
    try:
        return fetch_user_self(host, bearer_token)['username']
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if code == 401:
            logger.warning('fetch_user_self 401 (no/invalid token) for enterprise %s', enterprise_name)
        elif code == 403:
            logger.warning('fetch_user_self 403 (insufficient permissions) for enterprise %s', enterprise_name)
        elif code == 404:
            logger.warning('fetch_user_self 404 (user record not found) for enterprise %s', enterprise_name)
        else:
            logger.warning('fetch_user_self HTTP %s for enterprise %s', code, enterprise_name)
    except httpx.RequestError as exc:
        logger.warning('fetch_user_self network error for enterprise %s: %s', enterprise_name, exc)
    return ''


class ClusterEnterpriseListCreateView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request, pk):
        try:
            cluster = Cluster.objects.get(pk=pk)
        except Cluster.DoesNotExist:
            return Response({'error': 'Cluster not found'}, status=status.HTTP_404_NOT_FOUND)

        serializer = EnterpriseCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        bearer_token = serializer.validated_data['bearer_token']

        try:
            info = fetch_enterprise_self(cluster.host, bearer_token)
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            if code in (401, 403):
                return Response(
                    {'bearer_token': 'Bearer token is invalid or expired.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {'error': f'ZedCloud returned HTTP {code}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except httpx.RequestError as exc:
            return Response(
                {'error': f'Cannot reach ZedCloud: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if not info['name']:
            return Response(
                {'error': 'ZedCloud did not return an enterprise name.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if info['state'] != ENTERPRISE_STATE_ACTIVE:
            label = info['state_label'] or info['state']
            return Response(
                {'error': f'Enterprise is not active in ZedCloud (state: {label}). Only active enterprises can be added.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        zcloud_username = _fetch_username(cluster.host, bearer_token, info['name'])

        enterprise = Enterprise.objects.create(
            name=info['name'],
            zcloud_id=info['zcloud_id'],
            zcloud_username=zcloud_username,
            cluster=cluster,
            bearer_token_enc=encrypt(bearer_token),
            is_active=serializer.validated_data.get('is_active', True),
            name_verified=True,
        )
        return Response(EnterpriseReadSerializer(enterprise).data, status=status.HTTP_201_CREATED)
