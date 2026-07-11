from django.urls import path
from .views import (
    PendingReservationsView,
    MyReservationsView,
    ReservationDetailView,
    ReservationApproveView,
    ReservationRejectView,
)

urlpatterns = [
    path('pending/', PendingReservationsView.as_view()),
    path('mine/', MyReservationsView.as_view()),
    path('<str:token>/', ReservationDetailView.as_view()),
    path('<str:token>/approve/', ReservationApproveView.as_view()),
    path('<str:token>/reject/', ReservationRejectView.as_view()),
]
