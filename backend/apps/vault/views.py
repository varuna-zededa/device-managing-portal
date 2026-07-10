import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Vault
from utils.permissions import IsPortalUser, get_user_email

logger = logging.getLogger(__name__)


class VaultView(APIView):
    permission_classes = [IsPortalUser]

    def get(self, request, cluster_id):
        user_email = get_user_email(request)
        has_token = Vault.objects.filter(user_email=user_email, cluster_id=cluster_id).exists()
        return Response({'has_token': has_token})
