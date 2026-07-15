from django.urls import path
from .views import EnterpriseDetailView, EnterpriseSyncView, SyncAllEnterprisesView, SyncIntervalView

urlpatterns = [
    path('sync-interval/', SyncIntervalView.as_view()),
    path('sync-all/', SyncAllEnterprisesView.as_view()),
    path('<int:pk>/', EnterpriseDetailView.as_view()),
    path('<int:pk>/sync/', EnterpriseSyncView.as_view()),
]
