# 经典电影推荐 · 每日一部

> 完整开发文档见 [docs/开发文档.md](docs/开发文档.md)（架构、数据迁移、部署、自动更新、排错经验）

前端 GitHub Pages + 后端 Supabase 的每日经典电影网站，含四大主题：

| 标签 | 路由 | 内容 |
| --- | --- | --- |
| 每日推荐 | `#/`、`#/daily/:id`、`#/history` | 当日电影完整页（复刻 20260806 版式）+ 历史推荐列表 |
| 电影海报 | `#/gallery`、`#/gallery/:id` | 75 部电影真实海报图库，每部电影一页（海报 + 片名 + 经典语录） |
| 经典台词 | `#/quotes` | 台词集合，支持搜索与随机 |
| 经典解析 | `#/analyses` | 75 篇编辑评语与观影价值解析 |
| 联系我们 | `#/contact` | 商务合作、联系方式、留言板 |
| 后台管理 | `#/admin` | 管理员登录后管理每日推荐内容（编辑 / 上下线） |

整站采用 B 站风格主题（白底灰面、粉蓝配色、苹方无衬线字体、顶部标签导航）。
图库使用网上真实电影海报（`src/data/gallery.json`，通过
`npm run data:gallery` 抓取，自动回退到手绘海报）。
留言板留言保存在浏览器本地，配置 Supabase 后同步写入 `messages` 表
（见 `supabase/migrations/0003_messages.sql`）。

## 登录与注册

右上角提供 **登录 / 注册**，支持两种模式（自动切换）：

### 本地演示模式（默认，无需 Supabase）

- 数据保存在浏览器 localStorage，开箱即用；
- **默认管理员**：`admin` / `admin123`（首次访问自动创建，建议上线前修改）；
- 注册的新用户自动登录，普通用户无后台权限；
- 后台修改会立即反映到前台（下线 = 从公开页面隐藏）。

### Supabase 模式（正式上线）

配置 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY` 后自动启用：

1. 执行 `supabase/migrations/0002_auth.sql`（profiles 表 + 注册触发器 + RLS）；
2. 创建管理员：

   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=your-password \
   npm run admin:create
   ```

3. 注册用邮箱 + 密码，登录支持邮箱或用户名；管理员登录后进入 `#/admin`，
   编辑内容会同步写回 Supabase `movies` 表（RLS 仅管理员可写）。

## Django 后台（可选后端）

项目另附一套 Django 4.2 后台管理系统（`backend/`），适合需要更完整的
用户 / 分组 / 权限体系的场景：

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py init_roles --seed   # 角色分组 + 超管 admin/admin123 + 导入 75 部数据
.venv/bin/python manage.py runserver            # http://127.0.0.1:8000/admin/
```

内置三个角色：内容编辑（可写不可发布）、内容审核（可发布/下线）、系统管理员（全部权限），
并提供公开只读 REST API（`/api/movies/` 等）。详见 [backend/README.md](backend/README.md)。

## 本地运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/
npm run preview    # 预览生产构建
```

## 数据来源

75 份历史页面解析自 `tools/parse-html.mjs`（兼容三代版式），产物为 `src/data/movies.json`。

```bash
npm run data:parse   # 重新解析 HTML → movies.json
npm run data:gallery  # 从 DuckDuckGo 抓取电影海报 → gallery.json
npm run data:sync    # 同步到 Supabase（需配置 SUPABASE_URL / SERVICE_ROLE_KEY）
```

## 部署到 GitHub Pages

1. 推送仓库到 GitHub，分支 `main`；
2. Settings → Pages → Source 选择 **GitHub Actions**；
3. 推送即触发 `.github/workflows/deploy.yml` 自动构建部署；
4. 访问 `https://<username>.github.io/<repo>/`。

> 路由使用 hash 模式（`#/gallery`），任何子路径均可直接访问。

## 接入 Supabase

1. 在 [supabase.com](https://supabase.com) 创建项目；
2. 在 SQL Editor 执行 `supabase/migrations/0001_init.sql`（建表 + RLS + Storage 桶 + 每日发布 cron）；
3. 配置环境变量（参考 `.env.example`），执行 `npm run data:sync` 导入历史数据；
4. 前端默认读取本地 `movies.json`，如需切换为 Supabase 实时数据：
   - 在 `src/lib/store.ts` 中将数据源替换为 `supabase.from('movies').select('*')` 查询；
   - 将 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY` 配置到构建环境。

## 每日更新

- Supabase `pg_cron` 每天 00:00（Asia/Shanghai）自动把当日电影置为 `published`；
- 首页默认展示 `date = 今天` 的已发布电影，无记录时回退到最近一部。

## 每天自动更新（本地 WorkBuddy → 仓库 → 首页）

新电影推荐由 WorkBuddy 在本机生成 HTML，自动更新链路：

```text
WorkBuddy 生成 movie-recommend-YYYYMMDD.html
        ↓  macOS 定时任务（launchd，每天 0/6/12/18 点）
tools/daily-sync.sh
   ├─ 复制新 HTML → source-html/
   ├─ npm run data:parse（生成 movies.json）
   ├─ npm run data:gallery（新电影抓海报）
   └─ git commit + push
        ↓
GitHub Actions（deploy.yml）自动构建部署到 Pages
        ↓
首页按当天日期展示最新推荐
```

### 一次性准备

1. 在 GitHub 创建仓库，然后：

   ```bash
   gh auth login                    # 浏览器授权（仅需一次）
   ./tools/deploy-github.sh          # 自动建仓、推送、启用 Pages、输出公网地址
   ```

   或手动方式：

   ```bash
   git remote add origin <你的仓库地址>
   git push -u origin main
   ```

2. 启用 GitHub Pages：仓库 Settings → Pages → Source 选 **GitHub Actions**。

### Supabase 云端存储（可选增强）

1. 在 [supabase.com](https://supabase.com) 免费创建项目；
2. SQL Editor 依次执行 `supabase/migrations/0001_init.sql` 与 `0002_auth.sql`；
3. 配置环境变量后同步 76 部历史数据：

   ```bash
   export SUPABASE_URL=你的项目URL
   export SUPABASE_SERVICE_ROLE_KEY=你的service_role密钥
   npm run data:sync
   ```

4. `0001_init.sql` 内含 pg_cron，每天零点自动把当日电影置为已发布；
5. 前端如需直连 Supabase，把 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   配置到 GitHub Actions 环境变量（Settings → Secrets and variables → Actions）。

### 安装定时任务（macOS）

```bash
cp deploy/com.classicmovie.daily-sync.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.classicmovie.daily-sync.plist
```

每天 00:10 / 06:00 / 12:00 / 18:00 自动检查并同步，日志在
`/tmp/classicmovie-sync.log`。也可以手动执行：

```bash
./tools/daily-sync.sh           # 同步 + 推送
DRY_RUN=1 ./tools/daily-sync.sh # 只同步不推送
```

说明：首页日期按当天匹配，某天没有新文件时自动显示最近一部，不会报错。

## 目录结构

```text
src/
  components/   MovieView（每日页核心）、Reveal、RatingCard、DustCanvas、Layout
  pages/        Home / Movie / History / Gallery / Quotes / Analyses
  lib/          store.ts（数据访问）
  data/         movies.json（75 部解析结果）
  styles/       theme.css（20260806 设计系统）
tools/          parse-html.mjs（HTML → JSON 解析器）
supabase/       migrations/0001_init.sql + schema-sync.mjs
.github/workflows/deploy.yml
```
