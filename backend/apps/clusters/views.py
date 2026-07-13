from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Cluster
from .serializers import ClusterSerializer
from apps.enterprises.serializers import EnterpriseCreateSerializer, EnterpriseReadSerializer
from utils.permissions import IsPortalUser, IsAdminPortalUser


class ClusterListCreateView(APIView):
    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsPortalUser()]
        return [IsAdminPortalUser()]

    def get(self, request):
        clusters = Cluster.objects.prefetch_related('enterprises__cluster').order_by('name')
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


class ClusterDetailView(APIView):
    permission_classes = [IsAdminPortalUser]

    def _get(self, pk):
        try:
            return Cluster.objects.prefetch_related('enterprises').get(pk=pk)
        except Cluster.DoesNotExist:
            return None

    def patch(self, request, pk):
        cluster = self._get(pk)
        if not cluster:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = ClusterSerializer(cluster, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(ClusterSerializer(cluster).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        cluster = self._get(pk)
        if not cluster:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        if cluster.enterprises.exists():
            return Response(
                {'error': 'Cannot delete cluster with enterprises. Remove enterprises first.'},
                status=status.HTTP_409_CONFLICT,
            )
        cluster.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClusterEnterpriseListCreateView(APIView):
    permission_classes = [IsAdminPortalUser]

    def post(self, request, pk):
        try:
            cluster = Cluster.objects.get(pk=pk)
        except Cluster.DoesNotExist:
            return Response({'error': 'Cluster not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = EnterpriseCreateSerializer(data=request.data, context={'cluster': cluster})
        if serializer.is_valid():
            enterprise = serializer.save()
            return Response(EnterpriseReadSerializer(enterprise).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
