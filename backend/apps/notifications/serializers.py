from rest_framework import serializers
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'kind', 'enterprise', 'title', 'body', 'created_at', 'is_read', 'read_at']
        read_only_fields = ['created_at', 'read_at']
