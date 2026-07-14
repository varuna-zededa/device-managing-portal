from django.urls import path
from .views import UserListCreateView, UserDetailView, UserExportView, UserImportView

urlpatterns = [
    path('', UserListCreateView.as_view()),
    path('export/', UserExportView.as_view()),
    path('import/', UserImportView.as_view()),
    path('<int:pk>/', UserDetailView.as_view()),
]
