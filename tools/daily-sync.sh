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

# shellcheck source=tools/lib/lock.sh
source "$ROOT/tools/lib/lock.sh"
# shellcheck source=tools/lib/git-sync.sh
source "$ROOT/tools/lib/git-sync.sh"

# 防并发：同步、海报巡检、全站自检共用一把可重入维护锁。锁里记录 PID，
# 旧进程被强杀后下一次运行会自动回收；嵌套脚本可安全复用父任务持有的锁。
LOCK="${MAINTENANCE_LOCK_DIR:-/tmp/classicmovie-maintenance.lock}"
if ! acquire_lock "$LOCK"; then
  echo "== $(date '+%F %T') 已有维护任务在运行，跳过本次"
  exit 0
fi
trap 'rc=$?; release_lock "$LOCK"; exit "$rc"' EXIT
trap 'exit 143' TERM INT HUP

echo "== $(date '+%F %T') 开始同步 =="
echo "== 仓库：$ROOT"

# 加载 Supabase 凭据（可选，用于同步新电影到云端）
if [ -f "$ROOT/supabase/.env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/supabase/.env.local"
  set +a
fi

mkdir -p source-html

# 1) 复制新增或被重新生成的 HTML
count=0
for f in "$SRC"/movie-recommend-*.html; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"
  if [ ! -e "source-html/$base" ]; then
    cp "$f" "source-html/$base"
    count=$((count + 1))
    echo "新增: $base"
  elif ! cmp -s "$f" "source-html/$base"; then
    cp "$f" "source-html/$base"
    count=$((count + 1))
    echo "更新: $base"
  fi
done
echo "== 新增/更新 $count 份 HTML（共 $(find source-html -maxdepth 1 -type f -name '*.html' | wc -l | tr -d ' ') 份）"

# 工作区可能是 0 个新文件，但有上次中断留下的内容改动；这类情况也必须
# 继续解析、提交和推送，不能因为工作区“不是完全干净”就误判成有新文件。
CONTENT_DIRTY=0
if git_content_dirty; then CONTENT_DIRTY=1; fi

# 没有内容改动时不要反复解析；但仍要补推上次已经提交却没推送的版本。
if [ "$count" -eq 0 ] && [ "$CONTENT_DIRTY" -eq 0 ]; then
  echo "== 没有新的内容改动，检查远端是否需要补推"
  if ! git_has_push_remote; then
    echo "!! 未配置 git origin，无法完成同步" >&2
    exit 1
  fi
  if ! git_push_if_ahead; then
    echo "!! 检查或补推远端失败" >&2
    exit 1
  fi
  echo "== $(date '+%F %T') 同步检查完成"
  exit 0
fi

# 2) 重新解析
npm run data:parse
npm run data:years

# 3) 新片、或上次中断导致图库缺项时抓取海报；不能只看本次新增数，
#    否则「HTML 已复制、海报没来得及抓」的中断状态永远补不回来。
MISSING_POSTERS="$(node -e '
  const movies = require("./src/data/movies.json");
  let gallery = [];
  try { gallery = require("./src/data/gallery.json"); } catch {}
  const ids = new Set(gallery.map((item) => item.id));
  console.log(movies.filter((movie) => !ids.has(movie.id)).length);
')"
if [ "$count" -gt 0 ] || [ "${MISSING_POSTERS:-0}" -gt 0 ]; then
  echo "== 待补海报 ${MISSING_POSTERS:-0} 张"
  node tools/run-with-timeout.mjs "${GALLERY_FETCH_TIMEOUT_MS:-300000}" npm run data:gallery
fi

# 3.5) 海报自检 + 自动纠错
#      新抓的海报可能抓错图（张冠李戴 / 横版剧照 / 缩略图），
#      入库前先体检一遍，发现问题当场换图，避免错误海报被发布上线。
#      能访问的远程旧图先无损迁移到本地，避免下次 CDN 抖动影响页面。
if ! node tools/run-with-timeout.mjs "${POSTER_MIGRATE_TIMEOUT_MS:-120000}" node tools/fix-posters.mjs --self-host-all; then
  echo "!! 部分远程海报暂时无法自托管，本轮保留原引用，下次继续"
fi
POSTER_DIRTY=0
if [ -n "$(git status --porcelain -- src/data/gallery.json public/posters 2>/dev/null)" ]; then
  POSTER_DIRTY=1
fi
if [ "$count" -gt 0 ] || [ "$POSTER_DIRTY" -eq 1 ]; then
  if ! "$ROOT/tools/poster-qa.sh" --no-commit; then
    echo "!! 海报自检仍有未修复项，停止发布以避免上线错误海报" >&2
    exit 1
  fi
fi

COUNT_HTML=$(find source-html -maxdepth 1 -type f -name '*.html' | wc -l | tr -d ' ')
COUNT_JSON=$(node -e "console.log(require('./src/data/movies.json').length)")
echo "== HTML $COUNT_HTML 份 / 解析 $COUNT_JSON 条"
if [ "$COUNT_HTML" -ne "$COUNT_JSON" ]; then
  echo "!! HTML 数量与解析条数不一致，停止发布以避免上线残缺数据" >&2
  exit 1
fi

if ! node -e '
  const fs = require("fs");
  const pages = fs.readdirSync("source-html").filter((f) => f.endsWith(".html"));
  const movies = require("./src/data/movies.json");
  const gallery = require("./src/data/gallery.json");
  const movieIds = new Set(movies.map((m) => m.id));
  const galleryIds = new Set(gallery.map((g) => g.id));
  const missingPosters = movies.filter((m) => !galleryIds.has(m.id)).map((m) => m.id);
  const orphanPosters = gallery.filter((g) => !movieIds.has(g.id)).map((g) => g.id);
  if (missingPosters.length || orphanPosters.length) {
    console.error(`海报与影片不一致：缺 ${missingPosters.length} 张，孤儿 ${orphanPosters.length} 张`);
    if (missingPosters.length) console.error(`缺图：${missingPosters.slice(0, 10).join("、")}`);
    if (orphanPosters.length) console.error(`孤儿：${orphanPosters.slice(0, 10).join("、")}`);
    process.exit(1);
  }
  if (pages.length !== movies.length) process.exit(1);
'; then
  echo "!! 数据完整性检查失败，停止发布" >&2
  exit 1
fi

# 4) 先提交并推送本地内容。Supabase 只是可选的云端增强数据源，
#    必须在本地站点成功发布之后才执行，不能让它阻塞 GitHub Pages。
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "== DRY_RUN：跳过 git 提交与推送"
  git diff --stat
  exit 0
fi

git add source-html src/data public/posters
# 海报巡检报告一并入库，便于回溯「哪张图什么时候被换过」
for report in output/poster-audit.json output/poster-audit.md output/poster-audit-history.jsonl output/poster-fix-log.json; do
  if [ -e "$report" ]; then git add "$report"; fi
done
if git diff --cached --quiet; then
  echo "== 无变更，跳过提交"
else
  git commit -m "每日更新：$(date +%F) $(date +%H:%M)"
fi

if ! git_has_push_remote; then
  echo "!! 未配置 git 远程仓库，请先：git remote add origin <仓库地址> && git push -u origin main"
  exit 1
fi
if ! git_push_if_ahead; then
  echo "!! 推送重试 3 次后仍失败，本次同步未完成" >&2
  exit 1
fi
echo "== 已推送到远程，GitHub Actions 将自动构建部署"

# 5) 本地已经安全发布后，再尝试云端同步。超时会杀掉整组子进程。
CLOUD_RC=0
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "== 本地发布完成，开始可选云端同步"
  set +e
  node tools/run-with-timeout.mjs "${SUPABASE_SYNC_TIMEOUT_MS:-30000}" node supabase/schema-sync.mjs
  CLOUD_RC=$?
  set -e
  if [ "$CLOUD_RC" -ne 0 ]; then
    echo "!! 云端同步失败或超时（本地站点已发布，不影响线上更新）"
  fi
else
  echo "== 未配置 Supabase 凭据，跳过可选云端同步"
fi

echo "== $(date '+%F %T') 同步完成 =="
if [ "$CLOUD_RC" -ne 0 ] && [ "${CLOUD_SYNC_REQUIRED:-0}" = "1" ]; then
  exit "$CLOUD_RC"
fi
