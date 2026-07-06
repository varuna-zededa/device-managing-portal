import logging
from rest_framework.permissions import BasePermission
from apps.users.models import PortalUser

logger = logging.getLogger(__name__)


class IsAdminPortalUser(BasePermission):
    def has_permission(self, request, view):
        email = request.META.get('HTTP_X_USER_EMAIL', '').strip()
        if not email:
            return False
        try:
            user = PortalUser.objects.get(email=email)
            return user.user_type == 'admin'
        except PortalUser.DoesNotExist:
            return False
        except Exception as e:
            logger.debug(str(e))
            return False


class IsOwnerOrAdmin(BasePermission):
    def has_object_permission(self, request, view, obj):
        email = request.META.get('HTTP_X_USER_EMAIL', '').strip()
        if not email:
            return False
        if hasattr(obj, 'owner_email') and obj.owner_email == email:
            return True
        try:
            user = PortalUser.objects.get(email=email)
            return user.user_type == 'admin'
        except PortalUser.DoesNotExist:
            return False
        except Exception as e:
            logger.debug(str(e))
            return False
