from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import DeviceModel
from .serializers import DeviceModelSerializer
from utils.permissions import IsPortalUser, is_admin, get_user_email


class DeviceModelListCreateView(APIView):
    permission_classes = [IsPortalUser]

    def get(self, request):
        models_qs = DeviceModel.objects.all().order_by('name')
        serializer = DeviceModelSerializer(models_qs, many=True)
        return Response(serializer.data)

    def post(self, request):
        if not is_admin(get_user_email(request)):
            return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)
        serializer = DeviceModelSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
