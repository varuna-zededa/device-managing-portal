from django.urls import path
from .views import UntrackedDeviceListView, UntrackedDeviceExportView, MoveToInventoryView

urlpatterns = [
    path('', UntrackedDeviceListView.as_view()),
    path('export/', UntrackedDeviceExportView.as_view()),
    path('<int:pk>/move-to-inventory/', MoveToInventoryView.as_view()),
]
