import logging
from rest_framework import serializers
from .models import Device
from apps.reservations.models import ReservationRequest
from apps.users.models import PortalUser

logger = logging.getLogger(__name__)


class DeviceSerializer(serializers.ModelSerializer):
    is_available = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    pending_requester_email = serializers.SerializerMethodField()

    class Meta:
        model = Device
        fields = [
            'id', 'name', 'serial_number', 'description', 'cluster_device_name',
            'model', 'cluster',
            'team', 'owner_email', 'owner_name',
            'lab', 'location_detail', 'condition',
            'idrac_ip', 'idrac_username',
            'eve_version', 'device_connectivity', 'status', 'status_fetched_at', 'reserved_at',
            'last_comment_text', 'last_comment_by', 'last_comment_at',
            'created_at', 'updated_at', 'is_available', 'pending_requester_email',
        ]
        read_only_fields = [
            'serial_number', 'created_at', 'updated_at',
            'status', 'status_fetched_at', 'reserved_at',
            'owner_email',
            'last_comment_text', 'last_comment_by', 'last_comment_at',
        ]

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        ret['model'] = {
            'id': instance.model_id,
            'name': instance.model.name,
            'customer_partner_name': instance.model.customer_partner_name or None,
        }
        ret['cluster'] = {
            'id': instance.cluster_id,
            'name': instance.cluster.name,
            'host': instance.cluster.host,
        } if instance.cluster_id else None
        return ret

    def get_is_available(self, obj):
        return obj.is_available

    def get_pending_requester_email(self, obj):
        req = ReservationRequest.objects.filter(device=obj, status='pending').order_by('requested_at').first()
        return req.requester_email if req else None

    def get_owner_name(self, obj):
        if not obj.owner_email:
            return None
        lookup = self.context.get('owner_lookup')
        if lookup is not None:
            return lookup.get(obj.owner_email, obj.owner_email)
        try:
            user = PortalUser.objects.get(email=obj.owner_email)
            return user.name
        except PortalUser.DoesNotExist:
            return obj.owner_email
        except Exception as e:
            logger.warning(str(e))
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
