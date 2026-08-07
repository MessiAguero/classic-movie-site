from django.urls import include, path
from rest_framework.routers import DefaultRouter

from movies.admin import admin_site
from movies.views import AnalysisViewSet, GalleryImageViewSet, MovieViewSet, QuoteViewSet

router = DefaultRouter()
router.register('movies', MovieViewSet, basename='movie')
router.register('quotes', QuoteViewSet, basename='quote')
router.register('gallery', GalleryImageViewSet, basename='gallery')
router.register('analyses', AnalysisViewSet, basename='analysis')

urlpatterns = [
    path('admin/', admin_site.urls),
    path('api/', include(router.urls)),
    path('api-auth/', include('rest_framework.urls')),
]
