from django.contrib import admin
from django.conf import settings as django_settings
from django.urls import path, include
from rest_framework.views import APIView
from rest_framework.response import Response
from apps.devices.views import ChoicesView
from version import APP_VERSION, API_VERSION


class VersionView(APIView):
    permission_classes = []

    def get(self, request):
        return Response({'version': APP_VERSION, 'api_version': API_VERSION})


class ConfigView(APIView):
    permission_classes = []

    def get(self, request):
        return Response({
            'device_list_refresh_ms': django_settings.DEVICE_LIST_REFRESH_MS,
            'notification_refresh_ms': django_settings.NOTIFICATION_REFRESH_MS,
        })


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/version/', VersionView.as_view()),
    path('api/v1/config/', ConfigView.as_view()),
    path('api/v1/choices/', ChoicesView.as_view()),
    path('api/v1/clusters/', include('apps.clusters.urls')),
    path('api/v1/enterprises/', include('apps.enterprises.urls')),
    path('api/v1/notifications/', include('apps.notifications.urls')),
    path('api/v1/models/', include('apps.device_models.urls')),
    path('api/v1/devices/', include('apps.devices.urls')),
    path('api/v1/untracked-devices/', include('apps.devices.untracked_urls')),
    path('api/v1/users/', include('apps.users.urls')),
    path('api/v1/reservations/', include('apps.reservations.urls')),
    path('api/v1/admin/', include('apps.admin_tools.urls')),
]
