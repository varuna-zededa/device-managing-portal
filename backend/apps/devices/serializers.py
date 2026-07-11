import ipaddress
import logging
from rest_framework import serializers
from .models import Device, Lab, CONDITION_CHOICES
from apps.reservations.models import ReservationRequest
from apps.users.models import PortalUser, Team

logger = logging.getLogger(__name__)

VALID_CONDITIONS = [c[0] for c in CONDITION_CHOICES]


class NullableSlugRelatedField(serializers.SlugRelatedField):
    """SlugRelatedField that converts '' to None for nullable FK fields."""

    def to_internal_value(self, data):
        if data == '' or data is None:
            return None
        return super().to_internal_value(data)


class _DeviceValidationMixin:
    """Shared field-level validators used by both read/write serializers."""

    def validate_name(self, value):
        if not (value or '').strip():
            raise serializers.ValidationError('Name must not be blank.')
        return value.strip()

    def validate_idrac_ip(self, value):
        if not value:
            return value
        try:
            ipaddress.ip_address(value.strip())
        except ValueError:
            raise serializers.ValidationError('Enter a valid IPv4 or IPv6 address.')
        return value.strip()


class DeviceSerializer(_DeviceValidationMixin, serializers.ModelSerializer):
    is_available = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    pending_requester_email = serializers.SerializerMethodField()
    pending_requester_name = serializers.SerializerMethodField()
    lab = serializers.SlugRelatedField(queryset=Lab.objects.all(), slug_field='name')
    team = NullableSlugRelatedField(
        queryset=Team.objects.all(), slug_field='name', allow_null=True, required=False,
    )

    class Meta:
        model = Device
        fields = [
            'id', 'name', 'serial_number', 'description', 'cluster_device_name',
            'model', 'cluster',
            'team', 'owner_email', 'owner_name',
            'lab', 'location_detail', 'condition',
            'idrac_ip', 'idrac_username',
            'eve_version', 'device_connectivity', 'status', 'status_fetched_at', 'reserved_at',
            'last_purpose_text', 'last_purpose_by', 'last_purpose_at',
            'created_at', 'updated_at', 'is_available', 'pending_requester_email', 'pending_requester_name',
        ]
        read_only_fields = [
            'serial_number', 'created_at', 'updated_at',
            'status', 'status_fetched_at', 'reserved_at',
            'owner_email',
            'last_purpose_text', 'last_purpose_by', 'last_purpose_at',
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

    def get_pending_requester_name(self, obj):
        req = ReservationRequest.objects.filter(device=obj, status='pending').order_by('requested_at').first()
        if not req:
            return None
        lookup = self.context.get('owner_lookup')
        if lookup is not None:
            return lookup.get(req.requester_email, req.requester_email)
        try:
            return PortalUser.objects.get(email=req.requester_email).name
        except PortalUser.DoesNotExist:
            return req.requester_email
        except Exception as e:
            logger.warning(str(e))
            return req.requester_email

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


class DeviceCreateSerializer(_DeviceValidationMixin, serializers.ModelSerializer):
    owner_email = serializers.EmailField(allow_blank=True, allow_null=True, required=False)
    lab = serializers.SlugRelatedField(queryset=Lab.objects.all(), slug_field='name')
    team = NullableSlugRelatedField(
        queryset=Team.objects.all(), slug_field='name', allow_null=True, required=False,
    )

    class Meta:
        model = Device
        fields = [
            'id', 'name', 'serial_number', 'description', 'cluster_device_name',
            'model', 'cluster', 'team', 'owner_email',
            'lab', 'location_detail', 'condition',
            'idrac_ip', 'idrac_username',
        ]
