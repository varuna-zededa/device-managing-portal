from rest_framework import serializers
from apps.devices.serializers import NullableSlugRelatedField
from .models import PortalUser, Team


class PortalUserSerializer(serializers.ModelSerializer):
    team = NullableSlugRelatedField(queryset=Team.objects.all(), slug_field='name', allow_null=True, required=False)

    class Meta:
        model = PortalUser
        fields = '__all__'

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError('Name must not be blank.')
        return value.strip()

    def validate_user_type(self, value):
        valid = [choice[0] for choice in PortalUser._meta.get_field('user_type').choices]
        if value not in valid:
            raise serializers.ValidationError(
                f"'{value}' is not a valid role. Choose from: {', '.join(valid)}."
            )
        return value

    def validate(self, data):
        user_type = data.get('user_type', getattr(self.instance, 'user_type', None))
        team = data.get('team', getattr(self.instance, 'team', None))
        if user_type == 'member' and not team:
            raise serializers.ValidationError({'team': 'Team is required for member users.'})
        return data
