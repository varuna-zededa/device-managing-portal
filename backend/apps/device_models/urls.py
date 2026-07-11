from django.urls import path
from .views import DeviceModelListCreateView

urlpatterns = [
    path('', DeviceModelListCreateView.as_view()),
]
