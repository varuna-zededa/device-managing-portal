from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/clusters/', include('apps.clusters.urls')),
    path('api/models/', include('apps.device_models.urls')),
    path('api/devices/', include('apps.devices.urls')),
    path('api/users/', include('apps.users.urls')),
    path('api/vault/', include('apps.vault.urls')),
    path('api/reservations/', include('apps.reservations.urls')),
    path('api/admin/', include('apps.admin_tools.urls')),
]
