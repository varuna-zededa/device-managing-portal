import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import PortalUser
from .serializers import PortalUserSerializer

logger = logging.getLogger(__name__)


def _get_user_email(request):
    return request.META.get('HTTP_X_USER_EMAIL', '').strip()


def _is_admin(email):
    try:
        user = PortalUser.objects.get(email=email)
        return user.user_type == 'admin'
    except PortalUser.DoesNotExist:
        return False
    except Exception as e:
        logger.debug(str(e))
        return False


class UserListCreateView(APIView):
    def get(self, request):
        users = PortalUser.objects.all().order_by('name')
        serializer = PortalUserSerializer(users, many=True)
        return Response(serializer.data)

    def post(self, request):
        user_email = _get_user_email(request)
        if not _is_admin(user_email):
            return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)

        email_prefix = request.data.get('email_prefix', '').strip()
        name = request.data.get('name', '').strip()
        team = request.data.get('team', '').strip()
        user_type = request.data.get('user_type', 'team_member').strip()

        if not email_prefix:
            return Response({'error': 'email_prefix is required'}, status=status.HTTP_400_BAD_REQUEST)

        email = f'{email_prefix}@zededa.com'
        data = {'name': name, 'email': email, 'team': team, 'user_type': user_type}
        serializer = PortalUserSerializer(data=data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
