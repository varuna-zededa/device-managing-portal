from django.urls import path
from .views import ExportView, ImportView, LatencyView

urlpatterns = [
    path('export/', ExportView.as_view()),
    path('import/', ImportView.as_view()),
    path('latency/', LatencyView.as_view()),
]
