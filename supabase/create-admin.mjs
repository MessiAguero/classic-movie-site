#!/usr/bin/env node
/**
 * 创建管理员账号（service_role key）
 *
 * 用法：
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=your-password \
 *   npm run admin:create
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL || 'admin@classicmovie.local';
const password = process.env.ADMIN_PASSWORD || 'admin123456';

if (!url || !key) {
  console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 环境变量');
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1) 创建 auth 用户
const { data: user, error: createErr } = await sb.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { username: 'admin' },
});
if (createErr) {
  if (createErr.message.includes('already')) {
    console.log(`用户 ${email} 已存在，直接升级为管理员…`);
  } else {
    console.error('创建用户失败:', createErr.message);
    process.exit(1);
  }
}

const uid = user?.user?.id;
if (!uid) {
  // 已存在时查询 uid
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = list?.users?.find((u) => u.email === email);
  if (!found) {
    console.error('无法定位用户', email);
    process.exit(1);
  }
  await sb
    .from('profiles')
    .upsert({ id: found.id, username: 'admin', email, role: 'admin' }, { onConflict: 'id' });
  console.log(`已将 ${email} 设为管理员`);
  process.exit(0);
}

// 2) 设置 profile 为 admin
const { error: profileErr } = await sb
  .from('profiles')
  .upsert({ id: uid, username: 'admin', email, role: 'admin' }, { onConflict: 'id' });
if (profileErr) {
  console.error('设置管理员角色失败:', profileErr.message);
  process.exit(1);
}

console.log(`管理员创建成功：${email} / ${password}（请尽快修改密码）`);
