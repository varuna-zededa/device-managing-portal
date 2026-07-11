from rest_framework import serializers
from .models import Vault


class VaultSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vault
        fields = ['id', 'user_email', 'cluster']
