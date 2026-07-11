from django.urls import path
from .views import UserListCreateView, UserDetailView

urlpatterns = [
    path('', UserListCreateView.as_view()),
    path('<int:pk>/', UserDetailView.as_view()),
]
