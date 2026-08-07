# Django 后台管理（经典电影推荐）

Django 4.2 LTS 后台，用于管理每日电影推荐内容，内置用户/分组/权限体系。

## 快速开始

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py init_roles --seed   # 角色分组 + 超管 + 导入 75 部历史数据
.venv/bin/python manage.py runserver            # http://127.0.0.1:8000
```

后台地址：http://127.0.0.1:8000/admin/

默认管理员：`admin` / `admin123`（通过环境变量可自定义，见下文）

界面使用 **Django SimpleUI**（中文现代化主题）。误把带中文的链接粘贴到
`/admin/` 路径后不会再 404，会自动跳回后台首页。

## 角色与权限

`init_roles` 命令创建三个分组：

| 分组 | 权限 | 说明 |
| --- | --- | --- |
| 内容编辑 | 查看 / 新增 / 编辑 / 删除全部内容 | 可写内容，但不能发布 |
| 内容审核 | 查看 / 编辑 + 发布、下线电影 | 负责把内容从草稿转为已发布 |
| 系统管理员 | 全部权限 + 发布 | 完整管理 |

自定义权限 `can_publish_movie` 控制“发布/下线”操作，后台的动作下拉框会根据用户权限自动显示/隐藏。

> 注意：Django 后台要求账号勾选“工作人员状态”（is_staff）。把用户加入以上分组后，
> 执行一次 `python manage.py init_roles` 会自动开启，或到后台“用户”里手动勾选。

## 数据模型

- `Movie` 电影推荐（与前端 `movies.json` 字段对齐，JSON 字段保存评分/剧情/亮点等）
- `Quote` 经典台词
- `GalleryImage` 电影图片（海报 / 剧照）
- `Analysis` 经典解析文章（Markdown 正文）
- `SiteConfig` 站点配置

## REST API（公开只读）

- `GET /api/movies/`、`GET /api/movies/{id}/`（仅已发布）
- `GET /api/quotes/`
- `GET /api/gallery/`
- `GET /api/analyses/`

分页参数：`?page=2`；写入统一走后台管理。

## 常用管理命令

```bash
.venv/bin/python manage.py init_roles                    # 重建分组/权限，开启 staff
.venv/bin/python manage.py init_roles --seed             # 上面 + 导入历史数据
.venv/bin/python manage.py createsuperuser               # 手动创建超管
```

自定义管理员账号：

```bash
DJANGO_ADMIN_USER=admin DJANGO_ADMIN_PASSWORD=your-pass \
.venv/bin/python manage.py init_roles
```

## 前端接入

前端（`../src/lib/store.ts`）目前默认读取本地 `movies.json`。
如需改由 Django API 提供数据，把数据源替换为 `GET /api/movies/` 即可；
CORS 已在 `config/settings.py` 中允许本地开发端口，部署后需补充你的 GitHub Pages 域名。
