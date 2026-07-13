import re
from rest_framework import serializers
from .models import Cluster
from apps.enterprises.serializers import EnterpriseReadSerializer

_HOST_RE = re.compile(r'^zcloud\.[a-z0-9][a-z0-9-]*\.zededa\.(net|dev)$')


class ClusterSerializer(serializers.ModelSerializer):
    enterprises = EnterpriseReadSerializer(many=True, read_only=True)
    device_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Cluster
        fields = ['id', 'name', 'host', 'enterprises', 'device_count']

    def validate_name(self, value):
        if not (value or '').strip():
            raise serializers.ValidationError('Cluster name must not be blank.')
        return value.strip()

    def validate_host(self, value):
        if not (value or '').strip():
            raise serializers.ValidationError('Host is required.')
        if not _HOST_RE.match(value.strip()):
            raise serializers.ValidationError(
                'Host must follow the format: zcloud.<name>.zededa.net or zcloud.<name>.zededa.dev'
            )
        return value.strip()
