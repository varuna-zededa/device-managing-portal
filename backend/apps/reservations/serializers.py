from rest_framework import serializers
from .models import ReservationRequest, DevicePurpose, OwnershipHistory


class ReservationRequestSerializer(serializers.ModelSerializer):
    device_name = serializers.CharField(source='device.name', read_only=True)

    class Meta:
        model = ReservationRequest
        fields = ['id', 'device', 'device_name', 'requester_email', 'requested_at', 'expires_at', 'status']
        read_only_fields = ['requester_email', 'requested_at', 'expires_at', 'status']


class PendingReservationSerializer(ReservationRequestSerializer):
    """Extends the base serializer with token — used only for the owner-facing pending list."""

    class Meta(ReservationRequestSerializer.Meta):
        fields = ReservationRequestSerializer.Meta.fields + ['token']
        read_only_fields = ReservationRequestSerializer.Meta.read_only_fields + ['token']


class DevicePurposeSerializer(serializers.ModelSerializer):
    class Meta:
        model = DevicePurpose
        fields = ['id', 'device', 'author_email', 'text', 'created_at']
        read_only_fields = ['author_email', 'created_at']


class OwnershipHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = OwnershipHistory
        fields = ['id', 'device', 'owner_email', 'changed_by', 'changed_at', 'reason']
