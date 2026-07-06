from django.urls import path
from .views import ClusterListCreateView

urlpatterns = [
    path('', ClusterListCreateView.as_view()),
]
