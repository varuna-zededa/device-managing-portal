from rest_framework import serializers
from .models import PortalUser, Team


class PortalUserSerializer(serializers.ModelSerializer):
    team = serializers.SlugRelatedField(queryset=Team.objects.all(), slug_field='name')

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
