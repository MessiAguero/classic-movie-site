-- ============================================================
-- 联系我们 · 留言板
-- ============================================================

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text not null default '',
  content text not null,
  status text not null default 'pending',  -- pending / approved / archived
  created_at timestamptz default now()
);

alter table public.messages enable row level security;

-- 任何人可提交留言
drop policy if exists messages_insert_anon on public.messages;
create policy messages_insert_anon on public.messages
  for insert with check (true);

-- 公开仅可读已审核留言
drop policy if exists messages_read_approved on public.messages;
create policy messages_read_approved on public.messages
  for select using (status = 'approved');

-- 管理员可管理全部留言
drop policy if exists messages_admin_all on public.messages;
create policy messages_admin_all on public.messages
  for all using (public.is_admin()) with check (public.is_admin());
