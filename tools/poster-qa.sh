#!/usr/bin/env bash
#
# 海报每日自检 + 自动纠错
#
#   1. 自检全站海报（tools/check-posters.mjs）
#   2. 发现错误 → 自动重新抓取可信图源并替换（tools/fix-posters.mjs）
#   3. 替换后再复检一次，确认真的修好了（fix 脚本内部完成）
#   4. 有改动则提交并推送，触发 GitHub Actions 重新部署
#
# 用法：
#   ./tools/poster-qa.sh               # 自检 → 纠错 → 提交推送
#   ./tools/poster-qa.sh --no-commit   # 只自检与纠错，不提交（供 daily-sync.sh 调用）
#   ./tools/poster-qa.sh --check-only  # 只自检，不纠错（纯巡检）
#
set -euo pipefail

# launchd 环境 PATH 很精简，手动补全 node/git 路径
export PATH="/Users/admin/.local/bin:/Users/admin/.hermes/node/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=tools/lib/lock.sh
source "$ROOT/tools/lib/lock.sh"
# shellcheck source=tools/lib/git-sync.sh
source "$ROOT/tools/lib/git-sync.sh"

NO_COMMIT=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --no-commit) NO_COMMIT=1 ;;
    --check-only) CHECK_ONLY=1 ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

# 防并发：与 daily-sync.sh、self-check.sh 共用可重入维护锁
LOCK="${MAINTENANCE_LOCK_DIR:-/tmp/classicmovie-maintenance.lock}"
if ! acquire_lock "$LOCK"; then
  echo "== $(date '+%F %T') 已有维护任务在运行，跳过本次"
  exit 0
fi
trap 'rc=$?; release_lock "$LOCK"; exit "$rc"' EXIT
trap 'exit 143' TERM INT HUP

echo "== $(date '+%F %T') 开始海报自检 =="

# 远程图先无损落地，再检查内容。失败仅代表当前网络不可达，
# 后续任务会重试；它不会触发换图，也不会把站点内容卡住。
if [ "$CHECK_ONLY" -eq 0 ]; then
  if ! node tools/run-with-timeout.mjs "${POSTER_MIGRATE_TIMEOUT_MS:-120000}" node tools/fix-posters.mjs --self-host-all; then
    echo "!! 部分远程海报暂时无法自托管，保留原引用并继续巡检"
  fi
fi

set +e
node tools/run-with-timeout.mjs "${POSTER_CHECK_TIMEOUT_MS:-240000}" node tools/check-posters.mjs
CHECK=$?
set -e

if [ "$CHECK" -eq 0 ]; then
  echo "== 海报全部正常，无需处理"
elif [ "$CHECK_ONLY" -eq 1 ]; then
  echo "!! 发现错误海报（--check-only 模式，不自动修复）"
  exit 1
else
  echo "== 发现错误海报，开始自动纠错"
  # 图片 CDN 偶发超时会让不同条目轮流失败；复检两轮，
  # 每轮只修当前仍报错的条目，避免一次网络抖动把错误带上线。
  RECHECK=1
  for attempt in 1 2 3; do
    node tools/run-with-timeout.mjs "${POSTER_FIX_TIMEOUT_MS:-360000}" node tools/fix-posters.mjs \
      || echo "!! 第 $attempt 轮部分海报未能自动修复，详见 output/poster-fix-log.json"
    set +e
    node tools/run-with-timeout.mjs "${POSTER_CHECK_TIMEOUT_MS:-240000}" node tools/check-posters.mjs
    RECHECK=$?
    set -e
    if [ "$RECHECK" -eq 0 ]; then
      echo "== 纠错完成，复检通过"
      break
    fi
    if [ "$attempt" -lt 3 ]; then
      echo "== 仍有错误，2 秒后继续第 $((attempt + 1)) 轮纠错"
      sleep 2
    fi
  done
  if [ "$RECHECK" -ne 0 ]; then
    echo "!! 三轮复检仍有未通过项，详见 output/poster-audit.md（下次巡检会继续尝试）"
    exit 1
  fi
fi

# 只巡检的模式到此为止：绝不提交、绝不推送
if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "== --check-only：仅巡检，不提交不推送"
  echo "== $(date '+%F %T') 海报自检完成 =="
  exit 0
fi

if [ "$NO_COMMIT" -eq 1 ]; then
  echo "== --no-commit：跳过提交（由调用方统一提交）"
  echo "== $(date '+%F %T') 海报自检完成 =="
  exit 0
fi

git add public/posters src/data/gallery.json output/poster-audit.json output/poster-audit.md output/poster-audit-history.jsonl output/poster-fix-log.json 2>/dev/null || true

if git diff --cached --quiet; then
  echo "== 海报无变更，跳过提交"
else
  git commit -m "海报自检：$(date +%F) 自动校验并纠错" >/dev/null
  echo "== 已提交海报变更"
  if git_has_push_remote; then
    if git_push_if_ahead; then
      echo "== 已推送到远程，GitHub Actions 将自动部署"
    else
      echo "!! 海报提交已生成，但推送失败" >&2
      exit 1
    fi
  else
    echo "!! 未配置 git 远程仓库，无法发布海报变更" >&2
    exit 1
  fi
fi

echo "== $(date '+%F %T') 海报自检完成 =="
