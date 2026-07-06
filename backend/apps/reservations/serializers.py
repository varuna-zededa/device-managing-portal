from rest_framework import serializers
from .models import ReservationRequest, DeviceComment, OwnershipHistory


class ReservationRequestSerializer(serializers.ModelSerializer):
    device_name = serializers.CharField(source='device.name', read_only=True)

    class Meta:
        model = ReservationRequest
        fields = ['id', 'device', 'device_name', 'requester_email', 'requested_at', 'expires_at', 'status']


class DeviceCommentSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceComment
        fields = ['id', 'device', 'author_email', 'text', 'created_at']


class OwnershipHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = OwnershipHistory
        fields = ['id', 'device', 'owner_email', 'changed_by', 'changed_at', 'reason']
