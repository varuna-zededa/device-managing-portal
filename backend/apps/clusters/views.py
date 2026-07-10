from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Cluster
from .serializers import ClusterSerializer
from utils.permissions import IsPortalUser, IsAdminPortalUser


class ClusterListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsPortalUser()]
        return [IsAdminPortalUser()]

    def get(self, request):
        clusters = Cluster.objects.all().order_by('name')
        serializer = ClusterSerializer(clusters, many=True)
        return Response(serializer.data)

    def post(self, request):
        data = request.data.copy()
        if 'host' not in data or not data['host']:
            name = data.get('name', '').lower().strip()
            data['host'] = f'zcloud.{name}.zededa.net'
        serializer = ClusterSerializer(data=data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
