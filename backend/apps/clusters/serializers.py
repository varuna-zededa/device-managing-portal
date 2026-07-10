import re
from rest_framework import serializers
from .models import Cluster

_HOST_RE = re.compile(r'^zcloud\.[a-z0-9][a-z0-9-]*\.zededa\.(net|dev)$')


class ClusterSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cluster
        fields = '__all__'

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
