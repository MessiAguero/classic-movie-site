from rest_framework import serializers

from .models import Analysis, GalleryImage, Movie, Quote


class MovieSerializer(serializers.ModelSerializer):
    class Meta:
        model = Movie
        fields = [
            'id', 'date', 'zh_title', 'en_title', 'year', 'tagline', 'meta',
            'ratings', 'plot', 'spoiler_note', 'highlights', 'quotes', 'why',
            'honors', 'archive', 'review', 'review_by', 'review_stars',
            'poster_svg', 'poster_caption', 'published_at',
        ]


class QuoteSerializer(serializers.ModelSerializer):
    movie_id = serializers.CharField(source='movie.id', read_only=True)
    movie_title = serializers.CharField(source='movie.zh_title', read_only=True)

    class Meta:
        model = Quote
        fields = ['id', 'movie_id', 'movie_title', 'quote_zh', 'quote_en', 'speaker', 'context', 'tags']


class GalleryImageSerializer(serializers.ModelSerializer):
    movie_id = serializers.CharField(source='movie.id', read_only=True)
    movie_title = serializers.CharField(source='movie.zh_title', read_only=True)

    class Meta:
        model = GalleryImage
        fields = ['id', 'movie_id', 'movie_title', 'title', 'caption', 'image_url', 'bucket', 'alt_text', 'tags', 'sort_order']


class AnalysisSerializer(serializers.ModelSerializer):
    movie_id = serializers.CharField(source='movie.id', read_only=True)
    movie_title = serializers.CharField(source='movie.zh_title', read_only=True)

    class Meta:
        model = Analysis
        fields = ['id', 'movie_id', 'movie_title', 'title', 'subtitle', 'slug', 'summary', 'body_md', 'tags', 'published_at', 'view_count']
