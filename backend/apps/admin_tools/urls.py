from django.urls import path
from .views import ExportView, ImportView

urlpatterns = [
    path('export/', ExportView.as_view()),
    path('import/', ImportView.as_view()),
]
