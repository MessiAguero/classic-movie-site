from rest_framework import viewsets

from .models import Analysis, GalleryImage, Movie, Quote
from .serializers import (
    AnalysisSerializer,
    GalleryImageSerializer,
    MovieSerializer,
    QuoteSerializer,
)


class MovieViewSet(viewsets.ReadOnlyModelViewSet):
    """公开只读：已发布的电影列表 / 详情"""

    queryset = Movie.objects.filter(status='published').order_by('-date')
    serializer_class = MovieSerializer
    lookup_field = 'id'
    lookup_value_regex = r'[0-9-]+'


class QuoteViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Quote.objects.filter(movie__status='published').select_related('movie')
    serializer_class = QuoteSerializer


class GalleryImageViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = GalleryImage.objects.filter(movie__status='published').select_related('movie')
    serializer_class = GalleryImageSerializer


class AnalysisViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Analysis.objects.filter(status='published').select_related('movie')
    serializer_class = AnalysisSerializer
    lookup_field = 'slug'
