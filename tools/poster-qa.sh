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

NO_COMMIT=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --no-commit) NO_COMMIT=1 ;;
    --check-only) CHECK_ONLY=1 ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

# 防并发：与 daily-sync.sh、launchd 定时任务共用一个锁
LOCK="/tmp/classicmovie-posterqa.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "== $(date '+%F %T') 已有海报巡检任务在运行，跳过本次"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

echo "== $(date '+%F %T') 开始海报自检 =="

set +e
node tools/check-posters.mjs
CHECK=$?
set -e

if [ "$CHECK" -eq 0 ]; then
  echo "== 海报全部正常，无需处理"
elif [ "$CHECK_ONLY" -eq 1 ]; then
  echo "!! 发现错误海报（--check-only 模式，不自动修复）"
  exit 1
else
  echo "== 发现错误海报，开始自动纠错"
  # 纠错失败不阻断流程：保留原图，下次巡检继续尝试
  node tools/fix-posters.mjs || echo "!! 部分海报未能自动修复，详见 output/poster-fix-log.json"

  set +e
  node tools/check-posters.mjs
  RECHECK=$?
  set -e
  if [ "$RECHECK" -eq 0 ]; then
    echo "== 纠错完成，复检通过"
  else
    echo "!! 复检仍有未通过项，详见 output/poster-audit.md（下次巡检会继续尝试）"
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
  if git remote -v | grep -q push; then
    git push origin HEAD && echo "== 已推送到远程，GitHub Actions 将自动部署"
  else
    echo "!! 未配置 git 远程仓库，跳过推送"
  fi
fi

echo "== $(date '+%F %T') 海报自检完成 =="
