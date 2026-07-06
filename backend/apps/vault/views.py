import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Vault

logger = logging.getLogger(__name__)


def _get_user_email(request):
    return request.META.get('HTTP_X_USER_EMAIL', '').strip()


class VaultView(APIView):
    def get(self, request, cluster_id):
        user_email = _get_user_email(request)
        if not user_email:
            return Response({'error': 'X-User-Email header required'}, status=status.HTTP_400_BAD_REQUEST)
        has_token = Vault.objects.filter(user_email=user_email, cluster_id=cluster_id).exists()
        return Response({'has_token': has_token})
