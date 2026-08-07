-- ============================================================
-- 经典电影推荐网站 · Supabase 初始迁移
-- 表 + RLS + Storage + 每日发布定时任务
-- ============================================================

-- ---------- movies：每日电影推荐 ----------
create table if not exists public.movies (
  id text primary key,                       -- YYYYMMDD 或 YYYYMMDD-2
  date text not null,                        -- 推荐日期 YYYYMMDD
  slug text unique,
  zh_title text not null,
  en_title text,
  year text,
  tagline text,
  meta text,                                 -- 导演/主演 摘要行
  ratings jsonb not null default '[]',
  plot jsonb not null default '[]',
  spoiler_note text,
  highlights jsonb not null default '[]',
  quotes jsonb not null default '[]',
  why jsonb not null default '[]',
  honors jsonb not null default '[]',
  archive jsonb not null default '[]',
  review text,
  review_by text,
  review_stars int default 5,
  poster_svg text,
  poster_caption text,
  status text not null default 'draft',      -- draft / published
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists movies_date_idx on public.movies (date desc);
create index if not exists movies_status_idx on public.movies (status);

-- ---------- quotes：经典台词库 ----------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  movie_id text references public.movies(id) on delete cascade,
  quote_zh text not null,
  quote_en text,
  speaker text,
  context text,
  tags text[] default '{}',
  created_at timestamptz default now()
);

create index if not exists quotes_movie_idx on public.quotes (movie_id);
create unique index if not exists quotes_movie_text_uniq on public.quotes (movie_id, quote_zh);

-- ---------- gallery_images：经典电影图片 ----------
create table if not exists public.gallery_images (
  id uuid primary key default gen_random_uuid(),
  movie_id text references public.movies(id) on delete cascade,
  title text,
  caption text,
  image_url text not null,
  bucket text not null default 'stills',
  alt_text text,
  tags text[] default '{}',
  sort_order int default 0,
  created_at timestamptz default now()
);

create index if not exists gallery_movie_idx on public.gallery_images (movie_id);

-- ---------- analyses：经典解析 ----------
create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  movie_id text references public.movies(id) on delete cascade,
  title text not null,
  subtitle text,
  slug text unique,
  cover_url text,
  summary text,
  body_md text not null,
  tags text[] default '{}',
  status text not null default 'draft',
  published_at timestamptz,
  view_count int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- 站点配置 ----------
create table if not exists public.site_config (
  key text primary key,
  value jsonb not null
);

-- ---------- RLS：公开只读已发布内容，写入仅服务端 ----------
alter table public.movies enable row level security;
alter table public.quotes enable row level security;
alter table public.gallery_images enable row level security;
alter table public.analyses enable row level security;
alter table public.site_config enable row level security;

drop policy if exists movies_public_read on public.movies;
create policy movies_public_read on public.movies
  for select using (status = 'published');

drop policy if exists quotes_public_read on public.quotes;
create policy quotes_public_read on public.quotes
  for select using (
    exists (select 1 from public.movies m where m.id = movie_id and m.status = 'published')
  );

drop policy if exists gallery_public_read on public.gallery_images;
create policy gallery_public_read on public.gallery_images
  for select using (
    exists (select 1 from public.movies m where m.id = movie_id and m.status = 'published')
  );

drop policy if exists analyses_public_read on public.analyses;
create policy analyses_public_read on public.analyses
  for select using (status = 'published');

-- 写入权限默认不开放：anon / authenticated 无 insert / update / delete
-- 服务端同步使用 service_role key（绕过 RLS）

-- ---------- Storage 桶 ----------
insert into storage.buckets (id, name, public) values
  ('posters', 'posters', true),
  ('stills', 'stills', true),
  ('covers', 'covers', true),
  ('svg-arts', 'svg-arts', true)
on conflict (id) do nothing;

-- ---------- 每日发布（Asia/Shanghai 每天 00:00） ----------
create extension if not exists pg_cron;

select cron.schedule(
  'publish-daily-movie',
  '0 0 * * *',
  $$
  update public.movies
     set status = 'published', published_at = now()
   where date = to_char(now() at time zone 'Asia/Shanghai', 'YYYYMMDD')
     and status <> 'published';
  $$
);
