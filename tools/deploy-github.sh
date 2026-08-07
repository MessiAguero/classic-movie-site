#!/usr/bin/env bash
#
# 一键发布到 GitHub：创建公开仓库 → 推送 → 启用 Pages → 等待部署 → 输出公网地址
#
# 前置条件：gh auth login 已完成登录
# 用法：./tools/deploy-github.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO_NAME="${REPO_NAME:-classic-movie-site}"

if ! gh auth status >/dev/null 2>&1; then
  echo "!! 尚未登录 GitHub，请先执行：gh auth login"
  exit 1
fi

OWNER="$(gh api user -q .login)"
echo "== 当前账号：$OWNER"

# 1) 创建公开仓库并推送（已存在则直接推送）
if ! git remote | grep -q origin; then
  gh repo create "$REPO_NAME" --public --source . --remote origin --push || {
    echo "创建失败，尝试作为已存在仓库处理…"
    git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
    git push -u origin main
  }
else
  git push -u origin main
fi

# 2) 启用 GitHub Pages（使用 Actions 工作流）
gh api -X POST "repos/$OWNER/$REPO_NAME/pages" -f build_type=workflow >/dev/null 2>&1 ||
  gh api -X PUT "repos/$OWNER/$REPO_NAME/pages" -f build_type=workflow >/dev/null 2>&1 ||
  echo "（Pages 可能已启用或需在仓库 Settings → Pages 手动选择 GitHub Actions）"

# 3) 等待部署完成
SITE="https://$OWNER.github.io/$REPO_NAME/"
echo "== 等待部署：$SITE"
for _ in $(seq 1 36); do
  sleep 10
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$SITE" || true)"
  if [ "$code" = "200" ]; then
    echo "✅ 部署完成，公网访问地址：$SITE"
    exit 0
  fi
done
echo "部署仍在进行，稍后访问：$SITE"
