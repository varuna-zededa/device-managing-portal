from rest_framework import serializers
from .models import PortalUser


class PortalUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = PortalUser
        fields = '__all__'
