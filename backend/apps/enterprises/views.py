import json
import logging
import threading

import httpx
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.clusters.models import Cluster
from utils.crypto import encrypt
from utils.permissions import IsAdminPortalUser

from .models import Enterprise
from .serializers import EnterpriseReadSerializer, EnterpriseUpdateSerializer
from .sync import sync_enterprise, verify_enterprise_names

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
        enterprise.last_sync_at = timezone.now()
        enterprise.save(update_fields=['last_sync_at', 'last_sync_status', 'last_sync_error'])
        return Response(EnterpriseReadSerializer(enterprise).data)


class ClusterExportView(APIView):
    permission_classes = [IsAdminPortalUser]

    def get(self, request):
        clusters = Cluster.objects.prefetch_related('enterprises').order_by('name')
        payload = []
        for cluster in clusters:
            payload.append({
                'cluster_name': cluster.name,
                'cluster_host': cluster.host,
                'enterprises': [{'name': e.name} for e in cluster.enterprises.all()],
            })
        content = json.dumps(payload, indent=2)
        response = HttpResponse(content, content_type='application/json')
        response['Content-Disposition'] = 'attachment; filename="cluster-config.json"'
        return response


class ClusterImportView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request):
        on_conflict = request.data.get('on_conflict', 'skip')
        if on_conflict not in ('overwrite', 'skip'):
            return Response(
                {'error': 'on_conflict must be "overwrite" or "skip"'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw = request.data.get('config')
        if raw is None:
            return Response({'error': 'config field is required'}, status=status.HTTP_400_BAD_REQUEST)

        if isinstance(raw, str):
            try:
                config = json.loads(raw)
            except json.JSONDecodeError as exc:
                return Response({'error': f'Invalid JSON: {exc}'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            config = raw

        if not isinstance(config, list):
            return Response({'error': 'config must be a JSON array'}, status=status.HTTP_400_BAD_REQUEST)

        errors = []
        created_clusters = 0
        created_enterprises = 0
        updated_enterprises = 0
        skipped_enterprises = 0

        for entry in config:
            cluster_host = (entry.get('cluster_host') or '').strip()
            cluster_name = (entry.get('cluster_name') or '').strip()
            enterprises_data = entry.get('enterprises', [])

            if not cluster_host:
                errors.append(f'Entry missing cluster_host: {entry}')
                continue

            cluster, c_created = Cluster.objects.get_or_create(
                host=cluster_host,
                defaults={'name': cluster_name or cluster_host},
            )
            if c_created:
                created_clusters += 1

            for ent in enterprises_data:
                ent_name = (ent.get('name') or '').strip()
                bearer_token = (ent.get('bearer_token') or '').strip()

                if not ent_name:
                    errors.append(f'Enterprise entry missing name in cluster {cluster_host}')
                    continue
                if not bearer_token:
                    errors.append(f'Missing bearer_token for enterprise "{ent_name}" in cluster {cluster_host}')
                    continue

                existing = Enterprise.objects.filter(name=ent_name, cluster=cluster).first()
                if existing:
                    if on_conflict == 'overwrite':
                        existing.bearer_token_enc = encrypt(bearer_token)
                        existing.name_verified = False  # re-verify against ZedCloud
                        existing.save(update_fields=['bearer_token_enc', 'name_verified'])
                        updated_enterprises += 1
                    else:
                        skipped_enterprises += 1
                else:
                    Enterprise.objects.create(
                        name=ent_name,
                        cluster=cluster,
                        bearer_token_enc=encrypt(bearer_token),
                        # name_verified defaults to False — picked up by post-import verification
                    )
                    created_enterprises += 1

        result = {
            'created_clusters': created_clusters,
            'created_enterprises': created_enterprises,
            'updated_enterprises': updated_enterprises,
            'skipped_enterprises': skipped_enterprises,
        }

        if created_enterprises > 0 or updated_enterprises > 0:
            threading.Thread(target=verify_enterprise_names, daemon=True).start()

        if errors:
            result['errors'] = errors
            return Response(result, status=status.HTTP_207_MULTI_STATUS)
        return Response(result, status=status.HTTP_200_OK)
