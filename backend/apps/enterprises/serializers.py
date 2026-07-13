from rest_framework import serializers
from .models import Enterprise
from utils.crypto import encrypt


class EnterpriseReadSerializer(serializers.ModelSerializer):
    cluster_name = serializers.CharField(source='cluster.name', read_only=True)

    class Meta:
        model = Enterprise
        fields = [
            'id', 'name', 'cluster', 'cluster_name',
            'is_active', 'last_sync_at', 'last_sync_status', 'last_sync_error',
        ]


class EnterpriseCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    bearer_token = serializers.CharField(write_only=True)
    is_active = serializers.BooleanField(default=True)

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError('Name must not be blank.')
        return value.strip()

    def validate_bearer_token(self, value):
        if not value.strip():
            raise serializers.ValidationError('Bearer token must not be blank.')
        return value.strip()

    def create(self, validated_data):
        cluster = self.context['cluster']
        bearer_token = validated_data.pop('bearer_token')
        return Enterprise.objects.create(
            cluster=cluster,
            bearer_token_enc=encrypt(bearer_token),
            **validated_data,
        )


class EnterpriseUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    bearer_token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError('Name must not be blank.')
        return value.strip()

    def update(self, instance, validated_data):
        bearer_token = validated_data.pop('bearer_token', None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        if bearer_token and bearer_token.strip():
            instance.bearer_token_enc = encrypt(bearer_token.strip())
        instance.save()
        return instance
