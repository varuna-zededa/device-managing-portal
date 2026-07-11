from django.urls import path
from .views import VaultView

urlpatterns = [
    path('<int:cluster_id>/', VaultView.as_view()),
]
