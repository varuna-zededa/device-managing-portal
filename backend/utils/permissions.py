import logging
from rest_framework.permissions import BasePermission
from apps.users.models import PortalUser

logger = logging.getLogger(__name__)


def get_user_email(request) -> str:
    return request.META.get('HTTP_X_USER_EMAIL', '').strip()


def is_admin(email: str) -> bool:
    if not email:
        return False
    try:
        user = PortalUser.objects.get(email=email)
        return user.user_type == 'admin'
    except PortalUser.DoesNotExist:
        return False
    except Exception as e:
        logger.warning(str(e))
        return False


class IsPortalUser(BasePermission):
    """Allows access only to emails registered in the PortalUser table."""

    def has_permission(self, request, view):
        email = get_user_email(request)
        if not email:
            return False
        return PortalUser.objects.filter(email=email).exists()


class IsAdminPortalUser(BasePermission):
    def has_permission(self, request, view):
        return is_admin(get_user_email(request))


class IsOwnerOrAdmin(BasePermission):
    def has_permission(self, request, view):
        email = get_user_email(request)
        if not email:
            return False
        return PortalUser.objects.filter(email=email).exists()

    def has_object_permission(self, request, view, obj):
        email = get_user_email(request)
        if not email:
            return False
        if hasattr(obj, 'owner_email') and obj.owner_email == email:
            return True
        return is_admin(email)
