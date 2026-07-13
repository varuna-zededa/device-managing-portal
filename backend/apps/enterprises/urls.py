from django.urls import path
from .views import EnterpriseDetailView, EnterpriseSyncView

urlpatterns = [
    path('<int:pk>/', EnterpriseDetailView.as_view()),
    path('<int:pk>/sync/', EnterpriseSyncView.as_view()),
]
