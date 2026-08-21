#!/usr/bin/env bash
#
# 每日电影推荐自动同步脚本
# 1. 从 WorkBuddy 目录复制新增的 movie-recommend-*.html 到 source-html/
# 2. 重新解析生成 src/data/movies.json
# 3. 为新电影抓取海报（src/data/gallery.json）
# 4. git 提交并推送到 GitHub（触发 Actions 自动部署）
#
# 用法：
#   ./tools/daily-sync.sh            # 正常执行
#   DRY_RUN=1 ./tools/daily-sync.sh  # 只同步+解析，不提交不推送

set -euo pipefail

# launchd 环境 PATH 很精简，手动补全 node/npm/git 路径
export PATH="/Users/admin/.local/bin:/Users/admin/.hermes/node/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${DAILY_SRC:-/Users/admin/WorkBuddy/automation-20260423112820}"
cd "$ROOT"

echo "== $(date '+%F %T') 开始同步 =="

# 加载 Supabase 凭据（可选，用于同步新电影到云端）
if [ -f "$ROOT/supabase/.env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/supabase/.env.local"
  set +a
fi

mkdir -p source-html

# 1) 复制新 HTML
count=0
for f in "$SRC"/movie-recommend-*.html; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"
  if [ ! -e "source-html/$base" ]; then
    cp "$f" "source-html/$base"
    count=$((count + 1))
    echo "新增: $base"
  fi
done
echo "== 新增 $count 份 HTML（共 $(ls source-html | wc -l | tr -d ' ') 份）"

# 2) 重新解析
npm run data:parse

# 3) 有新电影时抓取海报
if [ "$count" -gt 0 ]; then
  npm run data:gallery
fi

COUNT_HTML=$(ls source-html | wc -l | tr -d ' ')
COUNT_JSON=$(node -e "console.log(require('./src/data/movies.json').length)")
echo "== HTML $COUNT_HTML 份 / 解析 $COUNT_JSON 条"
if [ "$COUNT_HTML" -ne "$COUNT_JSON" ]; then
  echo "!! 警告：HTML 数量与解析条数不一致，可能存在漏解析（检查文件名格式）"
fi

# 4) 同步新电影到 Supabase 云端（前端直接读云端数据）
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  npm run data:sync
fi

# 5) 提交并推送
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "== DRY_RUN：跳过 git 提交与推送"
  git diff --stat
  exit 0
fi

git add source-html src/data
if git diff --cached --quiet; then
  echo "== 无变更，跳过提交"
else
  git commit -m "每日更新：$(date +%F) $(date +%H:%M)"
fi

if git remote -v | grep -q push; then
  git push origin HEAD
  echo "== 已推送到远程，GitHub Actions 将自动构建部署"
else
  echo "!! 未配置 git 远程仓库，请先：git remote add origin <仓库地址> && git push -u origin main"
fi

echo "== $(date '+%F %T') 同步完成 =="
