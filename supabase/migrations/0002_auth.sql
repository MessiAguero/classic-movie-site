-- ============================================================
-- 经典电影推荐网站 · 认证与管理员
-- profiles 表 + 注册触发器 + 管理员辅助函数 + RLS
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  email text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz default now()
);

-- 新用户注册时自动创建 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    new.email,
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 管理员判断函数（供 RLS 使用）
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------- RLS：profiles ----------
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------- RLS：movies（管理员可管理全部） ----------
drop policy if exists movies_admin_all on public.movies;
create policy movies_admin_all on public.movies
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- RLS：quotes / gallery / analyses 管理员管理 ----------
drop policy if exists quotes_admin_all on public.quotes;
create policy quotes_admin_all on public.quotes
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gallery_admin_all on public.gallery_images;
create policy gallery_admin_all on public.gallery_images
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists analyses_admin_all on public.analyses;
create policy analyses_admin_all on public.analyses
  for all using (public.is_admin()) with check (public.is_admin());
