import logging
from rest_framework import serializers
from .models import Device
from apps.users.models import PortalUser

logger = logging.getLogger(__name__)


class DeviceSerializer(serializers.ModelSerializer):
    is_available = serializers.SerializerMethodField()
    model_name = serializers.CharField(source='model.name', read_only=True)
    cluster_name = serializers.CharField(source='cluster.name', read_only=True, allow_null=True)
    owner_name = serializers.SerializerMethodField()
    customer_partner_name = serializers.CharField(source='model.customer_partner_name', read_only=True, allow_null=True)

    class Meta:
        model = Device
        fields = [
            'id', 'name', 'serial_number', 'description', 'cluster_device_name',
            'model', 'model_name', 'customer_partner_name',
            'cluster', 'cluster_name',
            'team', 'owner_email', 'owner_name',
            'lab', 'location_detail', 'condition',
            'idrac_ip', 'idrac_username',
            'eve_version', 'device_connectivity', 'status',
            'last_comment_text', 'last_comment_by', 'last_comment_at',
            'created_at', 'updated_at', 'is_available',
        ]
        read_only_fields = ['serial_number', 'created_at', 'updated_at']
        extra_kwargs = {
            'idrac_password_enc': {'write_only': True},
        }

    def get_is_available(self, obj):
        return obj.is_available

    def get_owner_name(self, obj):
        if not obj.owner_email:
            return None
        try:
            user = PortalUser.objects.get(email=obj.owner_email)
            return user.name
        except PortalUser.DoesNotExist:
            return obj.owner_email
        except Exception as e:
            logger.debug(str(e))
            return obj.owner_email


class DeviceCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Device
        fields = [
            'id', 'name', 'serial_number', 'description', 'cluster_device_name',
            'model', 'cluster', 'team', 'owner_email',
            'lab', 'location_detail', 'condition',
            'idrac_ip', 'idrac_username',
        ]
