#!/usr/bin/env bash
#
# Supabase 一键初始化：
#   1) psql 执行 3 个建表迁移
#   2) 同步 76 部历史数据（schema-sync.mjs）
#   3) 创建管理员账号（create-admin.mjs）
#
# 用法：
#   SUPABASE_REF=rltzyqjrmnpdnfnlvtda \
#   SUPABASE_DB_PASSWORD=数据库密码 \
#   SUPABASE_URL=https://rltzyqjrmnpdnfnlvtda.supabase.co \
#   SUPABASE_SERVICE_ROLE_KEY=service_role_key \
#   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=你的密码 \
#   ./supabase/setup.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="${SUPABASE_REF:?缺少 SUPABASE_REF（项目 ref，如 rltzyqjrmnpdnfnlvtda）}"
DB_PASS="${SUPABASE_DB_PASSWORD:?缺少 SUPABASE_DB_PASSWORD（建项目时设置的数据库密码）}"
POOLER_HOST="${SUPABASE_POOLER_HOST:-aws-0-ap-northeast-1.pooler.supabase.com}"

export SUPABASE_URL="${SUPABASE_URL:?缺少 SUPABASE_URL}"
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?缺少 SUPABASE_SERVICE_ROLE_KEY}"

echo "== 1/3 执行建表迁移 =="
for f in 0001_init.sql 0002_auth.sql 0003_messages.sql; do
  echo "   → $f"
  PGPASSWORD="$DB_PASS" psql \
    -h "$POOLER_HOST" -p 5432 -U "postgres.$REF" -d postgres \
    -v ON_ERROR_STOP=1 -f "$ROOT/supabase/migrations/$f"
done

echo "== 2/3 同步历史数据 =="
node "$ROOT/supabase/schema-sync.mjs"

echo "== 3/3 创建管理员 =="
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@classicmovie.local}" \
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123456}" \
node "$ROOT/supabase/create-admin.mjs"

echo "✅ Supabase 初始化完成"
