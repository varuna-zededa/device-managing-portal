import logging
import re
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import PortalUser
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
