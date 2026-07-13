from django.urls import path
from .views import (
    DeviceListCreateView,
    DeviceDetailView,
    DeviceReserveView,
    DeviceForceAssignView,
    DeviceReleaseView,
    DeviceStatusView,
    DevicePurposeView,
    DeviceOwnershipHistoryView,
    UntrackedDeviceListView,
    MoveToInventoryView,
)

urlpatterns = [
    path('', DeviceListCreateView.as_view()),
    path('<int:pk>/', DeviceDetailView.as_view()),
    path('<int:pk>/reserve/', DeviceReserveView.as_view()),
    path('<int:pk>/force-assign/', DeviceForceAssignView.as_view()),
    path('<int:pk>/release/', DeviceReleaseView.as_view()),
    path('<int:pk>/status/', DeviceStatusView.as_view()),
    path('<int:pk>/purpose/', DevicePurposeView.as_view()),
    path('<int:pk>/ownership-history/', DeviceOwnershipHistoryView.as_view()),
]
