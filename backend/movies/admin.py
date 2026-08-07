from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin, UserAdmin
from django.contrib.auth.models import Group, User
from django.http import HttpResponseRedirect
from django.utils.html import format_html

from .models import Analysis, GalleryImage, Movie, Quote, SiteConfig


class ClassicMovieAdminSite(admin.AdminSite):
    site_header = '经典电影推荐 · 管理后台'
    site_title = '经典电影管理后台'
    index_title = '内容管理'

    def catch_all_view(self, request, url):
        """/admin/ 下未匹配路径（如误粘贴带中文的链接）→ 回到后台首页"""
        return HttpResponseRedirect('/admin/')


admin_site = ClassicMovieAdminSite(name='classic_admin')

# 用户 / 分组管理也挂载到自定义后台
admin_site.register(User, UserAdmin)
admin_site.register(Group, GroupAdmin)


@admin.register(Movie, site=admin_site)
class MovieAdmin(admin.ModelAdmin):
    list_display = ('date', 'zh_title', 'en_title', 'year', 'rating_summary', 'status', 'updated_at')
    list_display_links = ('date', 'zh_title')
    list_editable = ('status',)
    list_filter = ('status', 'year')
    search_fields = ('zh_title', 'en_title', 'date', 'meta')
    list_per_page = 25
    readonly_fields = ('id', 'created_at', 'updated_at')
    actions = ('publish_movies', 'unpublish_movies')

    fieldsets = (
        ('基本信息', {'fields': ('id', 'date', 'zh_title', 'en_title', 'year', 'meta', 'tagline')}),
        ('内容', {'fields': ('plot', 'spoiler_note', 'highlights', 'why', 'honors', 'archive', 'review', 'review_by', 'review_stars')}),
        ('评分与台词', {'fields': ('ratings', 'quotes')}),
        ('海报', {'fields': ('poster_svg', 'poster_caption')}),
        ('发布状态', {'fields': ('status', 'published_at', 'slug')}),
        ('系统', {'fields': ('created_at', 'updated_at')}),
    )

    @admin.display(description='评分')
    def rating_summary(self, obj):
        if not obj.ratings:
            return '—'
        first = obj.ratings[0]
        return f"{first.get('source', '')} {first.get('value', '')}"

    def has_publish_permission(self, request):
        return request.user.has_perm('movies.can_publish_movie')

    def get_actions(self, request):
        actions = super().get_actions(request)
        if not self.has_publish_permission(request):
            actions.pop('publish_movies', None)
            actions.pop('unpublish_movies', None)
        return actions

    @admin.action(description='发布选中的电影')
    def publish_movies(self, request, queryset):
        from django.utils import timezone
        queryset.update(status='published', published_at=timezone.now())

    @admin.action(description='下线选中的电影')
    def unpublish_movies(self, request, queryset):
        queryset.update(status='draft', published_at=None)


@admin.register(Quote, site=admin_site)
class QuoteAdmin(admin.ModelAdmin):
    list_display = ('excerpt', 'movie', 'speaker', 'created_at')
    list_select_related = ('movie',)
    search_fields = ('quote_zh', 'speaker', 'movie__zh_title')
    autocomplete_fields = ('movie',)
    list_per_page = 25

    @admin.display(description='台词')
    def excerpt(self, obj):
        return obj.quote_zh[:42] + ('…' if len(obj.quote_zh) > 42 else '')


@admin.register(GalleryImage, site=admin_site)
class GalleryImageAdmin(admin.ModelAdmin):
    list_display = ('preview', 'movie', 'title', 'bucket', 'sort_order')
    list_select_related = ('movie',)
    list_filter = ('bucket',)
    search_fields = ('title', 'caption', 'movie__zh_title')
    autocomplete_fields = ('movie',)

    @admin.display(description='预览')
    def preview(self, obj):
        return format_html(
            '<img src="{}" style="max-height:48px;max-width:80px;border-radius:6px;object-fit:cover">',
            obj.image_url,
        )


@admin.register(Analysis, site=admin_site)
class AnalysisAdmin(admin.ModelAdmin):
    list_display = ('title', 'movie', 'status', 'published_at', 'view_count', 'updated_at')
    list_editable = ('status',)
    list_filter = ('status',)
    search_fields = ('title', 'summary', 'movie__zh_title')
    autocomplete_fields = ('movie',)
    prepopulated_fields = {'slug': ('title',)}
    readonly_fields = ('view_count', 'created_at', 'updated_at')
    list_per_page = 25


@admin.register(SiteConfig, site=admin_site)
class SiteConfigAdmin(admin.ModelAdmin):
    list_display = ('key', 'updated_at')
    search_fields = ('key',)
