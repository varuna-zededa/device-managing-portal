from rest_framework import serializers
from .models import DeviceModel


class DeviceModelSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceModel
        fields = '__all__'

    def validate_name(self, value):
        if not (value or '').strip():
            raise serializers.ValidationError('Model name must not be blank.')
        return value.strip()

    def validate_customer_partner_name(self, value):
        if value:
            return value.strip() or None
        return value
