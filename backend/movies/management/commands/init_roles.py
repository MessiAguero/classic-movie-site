"""初始化后台权限：角色分组、管理员账号，可选导入历史数据。

用法：
    python manage.py init_roles              # 分组 + 超管
    python manage.py init_roles --seed       # 同时导入 75 部历史电影
"""

import json
import os
from pathlib import Path

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand

from movies.models import Movie, Quote

MODEL_NAMES = ['movie', 'quote', 'galleryimage', 'analysis']


def collect_perms(codenames):
    return list(
        Permission.objects.filter(
            content_type__app_label='movies',
            codename__in=codenames,
        )
    )


class Command(BaseCommand):
    help = '创建后台角色分组、超级管理员，并可导入历史电影数据'

    def add_arguments(self, parser):
        parser.add_argument('--seed', action='store_true', help='导入 src/data/movies.json')

    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING('== 初始化后台权限 =='))

        # 1) 角色分组
        view_only = [f'view_{m}' for m in MODEL_NAMES]
        change = [f'change_{m}' for m in MODEL_NAMES]
        add = [f'add_{m}' for m in MODEL_NAMES]
        delete = [f'delete_{m}' for m in MODEL_NAMES]

        editor, _ = Group.objects.get_or_create(name='内容编辑')
        editor.permissions.set(collect_perms(view_only + change + add + delete))
        self.stdout.write('✓ 分组「内容编辑」：可新增/编辑/删除全部内容')

        reviewer, _ = Group.objects.get_or_create(name='内容审核')
        reviewer.permissions.set(
            collect_perms(view_only + change + ['can_publish_movie'])
        )
        self.stdout.write('✓ 分组「内容审核」：可编辑内容并发布/下线电影')

        admin_group, _ = Group.objects.get_or_create(name='系统管理员')
        admin_group.permissions.set(
            collect_perms(view_only + change + add + delete + ['can_publish_movie'])
        )
        self.stdout.write('✓ 分组「系统管理员」：全部内容权限 + 发布权限')

        # 2) 超级管理员
        User = get_user_model()
        username = os.environ.get('DJANGO_ADMIN_USER', 'admin')
        password = os.environ.get('DJANGO_ADMIN_PASSWORD', 'admin123')
        email = os.environ.get('DJANGO_ADMIN_EMAIL', 'admin@classicmovie.local')
        if not User.objects.filter(username=username).exists():
            User.objects.create_superuser(username=username, email=email, password=password)
            self.stdout.write(f'✓ 超级管理员已创建：{username} / {password}（请尽快修改密码）')
        else:
            self.stdout.write(f'→ 超级管理员 {username} 已存在，跳过创建')

        # 分组用户默认开启后台访问（is_staff）
        staff_groups = ['内容编辑', '内容审核', '系统管理员']
        staff_users = User.objects.filter(groups__name__in=staff_groups, is_staff=False)
        count = staff_users.update(is_staff=True)
        if count:
            self.stdout.write(f'✓ 已将 {count} 名后台角色用户设为可访问后台（is_staff）')

        # 3) 可选导入
        if options['seed']:
            self.seed_movies()

        self.stdout.write(self.style.SUCCESS('初始化完成。'))

    def seed_movies(self):
        data_file = (
            Path(__file__).resolve().parent.parent.parent.parent.parent
            / 'src' / 'data' / 'movies.json'
        )
        if not data_file.exists():
            self.stderr.write(f'未找到数据文件：{data_file}')
            return
        movies = json.loads(data_file.read_text(encoding='utf-8'))
        created = 0
        for item in movies:
            movie, was_created = Movie.objects.update_or_create(
                id=item['id'],
                defaults={
                    'date': item.get('date', item['id']),
                    'slug': item.get('id'),
                    'zh_title': item.get('zhTitle', ''),
                    'en_title': item.get('enTitle', ''),
                    'year': item.get('year', ''),
                    'tagline': item.get('tagline', ''),
                    'meta': item.get('meta', ''),
                    'ratings': item.get('ratings', []),
                    'plot': item.get('plot', []),
                    'spoiler_note': item.get('spoilerNote', ''),
                    'highlights': item.get('highlights', []),
                    'quotes': item.get('quotes', []),
                    'why': item.get('why', []),
                    'honors': item.get('honors', []),
                    'archive': item.get('archive', []),
                    'review': item.get('review', ''),
                    'review_by': item.get('reviewBy', ''),
                    'review_stars': item.get('reviewStars', 5),
                    'poster_svg': item.get('posterSvg', ''),
                    'poster_caption': item.get('posterCaption', ''),
                    'status': 'published',
                },
            )
            # 台词表同步
            for q in item.get('quotes', []):
                Quote.objects.update_or_create(
                    movie=movie,
                    quote_zh=q.get('text', ''),
                    defaults={'speaker': q.get('who', '')},
                )
            if was_created:
                created += 1
        self.stdout.write(f'✓ 已导入电影：{created} 部新建，共 {Movie.objects.count()} 部')
