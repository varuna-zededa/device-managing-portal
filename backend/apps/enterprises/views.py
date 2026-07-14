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
from apps.notifications.models import Notification
from services.zedcloud import fetch_enterprise_self, fetch_user_self, ENTERPRISE_STATE_ACTIVE
from utils.crypto import encrypt
from utils.permissions import IsAdminPortalUser

from .models import Enterprise
from .serializers import EnterpriseReadSerializer, EnterpriseUpdateSerializer
from .sync import apply_candidates, sync_enterprise, verify_enterprise_names, _emit_token_expired

logger = logging.getLogger(__name__)


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
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        bearer_token = (serializer.validated_data.get('bearer_token') or '').strip()

        if not bearer_token:
            # No token change — simple field update (name, is_active, etc.)
            serializer.save()
            return Response(EnterpriseReadSerializer(enterprise).data)

        # Verify the new token against ZedCloud before saving anything.
        try:
            info = fetch_enterprise_self(enterprise.cluster.host, bearer_token)
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

        # If ZedCloud returned no enterprise ID we cannot verify token identity — reject.
        if not info['zcloud_id']:
            return Response(
                {'error': 'ZedCloud did not return an enterprise ID; cannot verify token identity.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # Enforce enterprise ID match — reject tokens that belong to a different enterprise.
        # Skip the check only if we have never stored a zcloud_id (enterprise was imported
        # before verification ever ran), in which case we store the discovered ID.
        if enterprise.zcloud_id and info['zcloud_id'] and info['zcloud_id'] != enterprise.zcloud_id:
            return Response(
                {'bearer_token': 'This token belongs to a different enterprise in ZedCloud. Enterprise ID does not match.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Enforce active state — applies to both token rotation and re-activation.
        if info['state'] != ENTERPRISE_STATE_ACTIVE:
            label = info['state_label'] or info['state']
            return Response(
                {'error': f'Enterprise is not active in ZedCloud (state: {label}).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        zcloud_username = _fetch_username(enterprise.cluster.host, bearer_token, enterprise.name) or enterprise.zcloud_username

        # Token verified — apply non-token fields from serializer, then write token fields
        # manually so we can set name_verified=True and is_active=True without a second save.
        validated = {k: v for k, v in serializer.validated_data.items() if k != 'bearer_token'}
        for attr, val in validated.items():
            setattr(enterprise, attr, val)
        enterprise.bearer_token_enc = encrypt(bearer_token)
        enterprise.name_verified = True
        enterprise.is_active = True  # re-activates if the enterprise was previously inactive
        enterprise.zcloud_username = zcloud_username
        update_fields = list(validated.keys()) + ['bearer_token_enc', 'name_verified', 'is_active', 'zcloud_username']
        if info['zcloud_id']:
            enterprise.zcloud_id = info['zcloud_id']
            update_fields.append('zcloud_id')
        enterprise.save(update_fields=update_fields)

        # Run a full device sync in the background — this clears last_sync_status='token_expired'
        # and re-includes the enterprise in future hourly sync cycles.
        def _sync_after_token_rotation():
            try:
                seen, candidates = sync_enterprise(enterprise)
                apply_candidates(candidates, timezone.now())
                enterprise.last_sync_status = 'ok'
                enterprise.last_sync_error = None
                Notification.objects.filter(kind='token_expired', enterprise=enterprise).delete()
                logger.info('Post-token-rotation sync succeeded for enterprise %s', enterprise.name)
            except httpx.HTTPStatusError as exc:
                code = exc.response.status_code
                enterprise.last_sync_status = 'token_expired' if code in (401, 403) else 'error'
                enterprise.last_sync_error = f'HTTP {code}'
                logger.warning('Post-token-rotation sync HTTP error for enterprise %s: %s', enterprise.name, exc)
            except Exception as exc:
                enterprise.last_sync_status = 'error'
                enterprise.last_sync_error = str(exc)
                logger.warning('Post-token-rotation sync failed for enterprise %s: %s', enterprise.name, exc)
            finally:
                enterprise.last_sync_at = timezone.now()
                enterprise.save(update_fields=['last_sync_at', 'last_sync_status', 'last_sync_error'])

        threading.Thread(target=_sync_after_token_rotation, daemon=True).start()

        return Response(EnterpriseReadSerializer(enterprise).data)

    def delete(self, request, pk):
        enterprise = self._get(pk)
        if not enterprise:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        from apps.devices.models import Device  # noqa: PLC0415
        if Device.objects.filter(enterprise=enterprise).exists():
            return Response(
                {'error': 'Cannot delete enterprise with linked inventory devices. Unassign devices first.'},
                status=status.HTTP_409_CONFLICT,
            )
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
            seen, candidates = sync_enterprise(enterprise)
            apply_candidates(candidates, timezone.now())
            enterprise.last_sync_status = 'ok'
            enterprise.last_sync_error = None
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            enterprise.last_sync_status = 'token_expired' if code in (401, 403) else 'error'
            enterprise.last_sync_error = f'HTTP {code}'
            if code in (401, 403):
                _emit_token_expired(enterprise)
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

        total_enterprises = sum(len(entry.get('enterprises', [])) for entry in config if isinstance(entry, dict))
        if total_enterprises > 20:
            return Response(
                {'error': f'Import exceeds the 20-enterprise limit ({total_enterprises} found). Split into smaller files.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
                        try:
                            info = fetch_enterprise_self(cluster.host, bearer_token)
                        except httpx.HTTPStatusError as exc:
                            errors.append(
                                f'Token rejected for enterprise "{ent_name}": HTTP {exc.response.status_code}'
                            )
                            continue
                        except httpx.RequestError as exc:
                            errors.append(f'Cannot reach ZedCloud for enterprise "{ent_name}": {exc}')
                            continue
                        if not info['zcloud_id']:
                            errors.append(
                                f'ZedCloud did not return an enterprise ID for enterprise "{ent_name}"; '
                                f'cannot verify token identity'
                            )
                            continue
                        if existing.zcloud_id and info['zcloud_id'] != existing.zcloud_id:
                            errors.append(
                                f'Token for enterprise "{ent_name}" belongs to a different ZedCloud enterprise (ID mismatch)'
                            )
                            continue
                        zcloud_username = _fetch_username(cluster.host, bearer_token, ent_name) or existing.zcloud_username
                        existing.bearer_token_enc = encrypt(bearer_token)
                        existing.zcloud_username = zcloud_username
                        existing.name_verified = False  # re-verify against ZedCloud
                        existing.save(update_fields=['bearer_token_enc', 'zcloud_username', 'name_verified'])
                        updated_enterprises += 1
                    else:
                        skipped_enterprises += 1
                else:
                    zcloud_username = _fetch_username(cluster.host, bearer_token, ent_name)
                    Enterprise.objects.create(
                        name=ent_name,
                        cluster=cluster,
                        bearer_token_enc=encrypt(bearer_token),
                        zcloud_username=zcloud_username,
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
