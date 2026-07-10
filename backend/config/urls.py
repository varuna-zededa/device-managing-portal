from django.contrib import admin
from django.urls import path, include
from apps.devices.views import ChoicesView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/choices/', ChoicesView.as_view()),
    path('api/v1/clusters/', include('apps.clusters.urls')),
    path('api/v1/models/', include('apps.device_models.urls')),
    path('api/v1/devices/', include('apps.devices.urls')),
    path('api/v1/users/', include('apps.users.urls')),
    path('api/v1/vault/', include('apps.vault.urls')),
    path('api/v1/reservations/', include('apps.reservations.urls')),
    path('api/v1/admin/', include('apps.admin_tools.urls')),
]
