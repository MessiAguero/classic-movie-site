from django.db import models


class Movie(models.Model):
    """每日电影推荐（与前端 movies.json 结构对齐）"""

    STATUS_CHOICES = [
        ('published', '已发布'),
        ('draft', '草稿'),
    ]

    id = models.CharField('编号', max_length=16, primary_key=True)  # YYYYMMDD 或 YYYYMMDD-2
    date = models.CharField('推荐日期', max_length=8, db_index=True)  # YYYYMMDD
    slug = models.SlugField('别名', max_length=120, unique=True, null=True, blank=True)
    zh_title = models.CharField('中文名', max_length=200)
    en_title = models.CharField('英文名', max_length=300, blank=True)
    year = models.CharField('年份', max_length=8, blank=True)
    tagline = models.TextField('标语', blank=True)
    meta = models.TextField('导演/主演', blank=True)
    ratings = models.JSONField('评分', default=list, blank=True)
    plot = models.JSONField('剧情段落', default=list, blank=True)
    spoiler_note = models.TextField('无剧透说明', blank=True)
    highlights = models.JSONField('六大亮点', default=list, blank=True)
    quotes = models.JSONField('台词（冗余）', default=list, blank=True)
    why = models.JSONField('为什么值得一看', default=list, blank=True)
    honors = models.JSONField('荣誉', default=list, blank=True)
    archive = models.JSONField('影片档案', default=list, blank=True)
    review = models.TextField('编辑评语', blank=True)
    review_by = models.CharField('评语署名', max_length=200, blank=True)
    review_stars = models.PositiveSmallIntegerField('星级', default=5)
    poster_svg = models.TextField('海报 SVG', blank=True)
    poster_caption = models.CharField('海报说明', max_length=300, blank=True)
    status = models.CharField(
        '状态', max_length=20, choices=STATUS_CHOICES, default='draft', db_index=True
    )
    published_at = models.DateTimeField('发布时间', null=True, blank=True)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)
    updated_at = models.DateTimeField('更新时间', auto_now=True)

    class Meta:
        ordering = ['-date']
        verbose_name = '电影推荐'
        verbose_name_plural = '电影推荐'
        permissions = [
            ('can_publish_movie', '可以发布/下线电影'),
        ]

    def __str__(self):
        return f'{self.zh_title}（{self.date}）'


class Quote(models.Model):
    """经典台词库"""

    movie = models.ForeignKey(Movie, on_delete=models.CASCADE, related_name='quote_items', verbose_name='电影')
    quote_zh = models.TextField('台词')
    quote_en = models.TextField('英文台词', blank=True)
    speaker = models.CharField('说话人', max_length=200, blank=True)
    context = models.TextField('场景背景', blank=True)
    tags = models.JSONField('标签', default=list, blank=True)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)

    class Meta:
        ordering = ['movie', 'id']
        verbose_name = '经典台词'
        verbose_name_plural = '经典台词'

    def __str__(self):
        return self.quote_zh[:40]


class GalleryImage(models.Model):
    """经典电影图片（海报/剧照）"""

    BUCKET_CHOICES = [
        ('posters', '海报'),
        ('stills', '剧照'),
        ('covers', '封面'),
        ('svg-arts', '手绘 SVG'),
    ]

    movie = models.ForeignKey(Movie, on_delete=models.CASCADE, related_name='gallery_items', verbose_name='电影')
    title = models.CharField('标题', max_length=200, blank=True)
    caption = models.CharField('说明', max_length=300, blank=True)
    image_url = models.URLField('图片地址')
    bucket = models.CharField('分类', max_length=30, choices=BUCKET_CHOICES, default='stills')
    alt_text = models.CharField('替代文本', max_length=300, blank=True)
    tags = models.JSONField('标签', default=list, blank=True)
    sort_order = models.PositiveIntegerField('排序', default=0)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)

    class Meta:
        ordering = ['movie', 'sort_order', 'id']
        verbose_name = '电影图片'
        verbose_name_plural = '电影图片'

    def __str__(self):
        return self.title or (self.movie.zh_title + ' 图片')


class Analysis(models.Model):
    """经典电影解析文章"""

    STATUS_CHOICES = [
        ('published', '已发布'),
        ('draft', '草稿'),
    ]

    movie = models.ForeignKey(Movie, on_delete=models.CASCADE, related_name='analyses', verbose_name='电影')
    title = models.CharField('标题', max_length=300)
    subtitle = models.CharField('副标题', max_length=300, blank=True)
    slug = models.SlugField('别名', max_length=200, unique=True, null=True, blank=True)
    cover_url = models.URLField('封面图', blank=True)
    summary = models.TextField('摘要', blank=True)
    body_md = models.TextField('正文 Markdown')
    tags = models.JSONField('标签', default=list, blank=True)
    status = models.CharField('状态', max_length=20, choices=STATUS_CHOICES, default='draft', db_index=True)
    published_at = models.DateTimeField('发布时间', null=True, blank=True)
    view_count = models.PositiveIntegerField('浏览量', default=0)
    created_at = models.DateTimeField('创建时间', auto_now_add=True)
    updated_at = models.DateTimeField('更新时间', auto_now=True)

    class Meta:
        ordering = ['-published_at', '-created_at']
        verbose_name = '电影解析'
        verbose_name_plural = '电影解析'

    def __str__(self):
        return self.title


class SiteConfig(models.Model):
    """站点配置（首页横幅、页脚等）"""

    key = models.CharField('键', max_length=100, primary_key=True)
    value = models.JSONField('值', default=dict, blank=True)
    updated_at = models.DateTimeField('更新时间', auto_now=True)

    class Meta:
        verbose_name = '站点配置'
        verbose_name_plural = '站点配置'

    def __str__(self):
        return self.key
