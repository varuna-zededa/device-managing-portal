from django.urls import path
from .views import ClusterListCreateView, ClusterDetailView, ClusterEnterpriseListCreateView
from apps.enterprises.views import ClusterExportView, ClusterImportView

urlpatterns = [
    path('', ClusterListCreateView.as_view()),
    path('export/', ClusterExportView.as_view()),
    path('import/', ClusterImportView.as_view()),
    path('<int:pk>/', ClusterDetailView.as_view()),
    path('<int:pk>/enterprises/', ClusterEnterpriseListCreateView.as_view()),
]
