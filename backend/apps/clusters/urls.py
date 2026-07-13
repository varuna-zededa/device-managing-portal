from django.urls import path
from .views import ClusterListCreateView, ClusterDetailView, ClusterEnterpriseListCreateView

urlpatterns = [
    path('', ClusterListCreateView.as_view()),
    path('<int:pk>/', ClusterDetailView.as_view()),
    path('<int:pk>/enterprises/', ClusterEnterpriseListCreateView.as_view()),
]
