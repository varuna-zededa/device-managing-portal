from django.urls import path
from .views import ExportView, ImportView, ImportTemplateView, LatencyView

urlpatterns = [
    path('export/', ExportView.as_view()),
    path('import/', ImportView.as_view()),
    path('import-template/', ImportTemplateView.as_view()),
    path('latency/', LatencyView.as_view()),
]
