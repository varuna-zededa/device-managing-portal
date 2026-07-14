import json
import logging
import re
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import PortalUser, Team
from .serializers import PortalUserSerializer
from utils.permissions import IsAdminPortalUser

_EMAIL_PREFIX_RE = re.compile(r'^[a-zA-Z0-9._-]+$')

logger = logging.getLogger(__name__)


class UserListCreateView(APIView):
    def get_permissions(self):
        # GET is public — needed by the login page to populate the user dropdown
        # POST is admin-only
        if self.request.method == 'GET':
            return []
        return [IsAdminPortalUser()]

    def get(self, request):
        users = PortalUser.objects.all().order_by('name')
        serializer = PortalUserSerializer(users, many=True)
        return Response(serializer.data)

    def post(self, request):
        email_prefix = request.data.get('email_prefix', '').strip()
        name = request.data.get('name', '').strip()
        team = request.data.get('team', '').strip()
        user_type = request.data.get('user_type', 'member').strip()

        if not email_prefix:
            return Response({'error': 'email_prefix is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not _EMAIL_PREFIX_RE.match(email_prefix):
            return Response(
                {'error': 'email_prefix may only contain letters, digits, dots, hyphens, and underscores.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = f'{email_prefix}@zededa.com'
        data = {'name': name, 'email': email, 'team': team, 'user_type': user_type}
        serializer = PortalUserSerializer(data=data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class UserDetailView(APIView):
    permission_classes = [IsAdminPortalUser]

    def patch(self, request, pk):

        try:
            user = PortalUser.objects.get(pk=pk)
        except PortalUser.DoesNotExist:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        EDITABLE = {'name', 'team', 'user_type'}
        data = {k: v for k, v in request.data.items() if k in EDITABLE}

        new_type = data.get('user_type')
        if new_type and new_type != 'admin' and user.user_type == 'admin':
            remaining = PortalUser.objects.filter(user_type='admin').exclude(pk=user.pk).count()
            if remaining == 0:
                return Response({'error': 'Cannot remove the last admin'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = PortalUserSerializer(user, data=data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class UserExportView(APIView):
    permission_classes = [IsAdminPortalUser]

    def get(self, request):
        users = PortalUser.objects.select_related('team').order_by('name')
        data = [
            {
                'name': u.name,
                'email': u.email,
                'team': u.team.name if u.team else '',
                'user_type': u.user_type,
            }
            for u in users
        ]
        ts = timezone.now().strftime('%Y%m%d_%H%M%S')
        resp = HttpResponse(json.dumps(data, indent=2), content_type='application/json')
        resp['Content-Disposition'] = f'attachment; filename="holocron_users_{ts}.json"'
        return resp


class UserImportView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request):
        raw = request.data.get('users')
        on_conflict = request.data.get('on_conflict', 'skip')
        if on_conflict not in ('skip', 'overwrite'):
            return Response(
                {'error': 'on_conflict must be "skip" or "overwrite"'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if isinstance(raw, str):
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as e:
                return Response({'error': f'Invalid JSON: {e}'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            data = raw

        if not isinstance(data, list):
            return Response({'error': 'Expected a JSON array'}, status=status.HTTP_400_BAD_REQUEST)

        if len(data) > 100:
            return Response(
                {'error': f'Import exceeds the 100-user limit ({len(data)} found). Split into smaller files.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        team_cache = {t.name: t for t in Team.objects.all()}
        valid_user_types = {c[0] for c in PortalUser._meta.get_field('user_type').choices}
        created = updated = skipped = 0
        errors = []

        for i, row in enumerate(data):
            email = (row.get('email') or '').strip().lower()
            name = (row.get('name') or '').strip()
            team_name = (row.get('team') or '').strip()
            user_type = (row.get('user_type') or 'member').strip()

            if not email:
                errors.append(f'Row {i + 1}: email is required'); skipped += 1; continue
            if not name:
                errors.append(f'Row {i + 1}: name is required'); skipped += 1; continue
            if user_type not in valid_user_types:
                errors.append(f'Row {i + 1}: invalid user_type "{user_type}"'); skipped += 1; continue

            team_obj = team_cache.get(team_name) if team_name else None
            if user_type == 'member' and not team_obj:
                errors.append(f'Row {i + 1}: team is required for member users (got "{team_name}")')
                skipped += 1; continue

            existing = PortalUser.objects.filter(email=email).first()
            if existing:
                if on_conflict == 'skip':
                    skipped += 1; continue
                # Guard: prevent demoting an admin when they would be the last one.
                if existing.user_type == 'admin' and user_type != 'admin':
                    remaining = PortalUser.objects.filter(user_type='admin').exclude(pk=existing.pk).count()
                    if remaining == 0:
                        errors.append(f'Row {i + 1}: cannot demote {email} — they are the last admin')
                        skipped += 1; continue
                existing.name = name
                existing.team = team_obj
                existing.user_type = user_type
                existing.save()
                updated += 1
            else:
                PortalUser.objects.create(email=email, name=name, team=team_obj, user_type=user_type)
                created += 1

        return Response({'created': created, 'updated': updated, 'skipped': skipped, 'errors': errors})
