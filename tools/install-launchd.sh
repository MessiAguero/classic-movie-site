#!/usr/bin/env bash
#
# 安装并重载本项目的 macOS launchd 定时任务。
# 所有仓库路径都在安装时从当前项目目录生成，避免仓库移动后继续调用旧路径。
#
# 用法：
#   ./tools/install-launchd.sh
#   DAILY_SRC=/path/to/workbuddy ./tools/install-launchd.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${DAILY_SRC:-/Users/admin/WorkBuddy/automation-20260423112820}"
UID_VALUE="$(id -u)"
HOME_DIR="${HOME:?HOME is required}"
AGENTS_DIR="$HOME_DIR/Library/LaunchAgents"
LOG_DIR="$HOME_DIR/Library/Logs/classic-movie-site"
NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
GIT_BIN="$(command -v git || true)"
MISSING_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --missing-only) MISSING_ONLY=1 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ] || [ -z "$GIT_BIN" ]; then
  echo "安装失败：找不到 node、npm 或 git" >&2
  exit 1
fi
if [ ! -d "$SRC" ]; then
  echo "安装失败：内容源目录不存在：$SRC" >&2
  exit 1
fi

NODE_DIR="$(dirname "$NODE_BIN")"
LAUNCH_PATH="$NODE_DIR:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$AGENTS_DIR" "$LOG_DIR"

render_plist() {
  local template="$1"
  local destination="$2"
  sed \
    -e "s|@@ROOT@@|$ROOT|g" \
    -e "s|@@SRC@@|$SRC|g" \
    -e "s|@@HOME@@|$HOME_DIR|g" \
    -e "s|@@PATH@@|$LAUNCH_PATH|g" \
    "$template" > "$destination"
}

reload_agent() {
  local label="$1"
  local destination="$2"

  launchctl bootout "gui/$UID_VALUE/$label" >/dev/null 2>&1 || true
  sleep 0.3
  if ! launchctl bootstrap "gui/$UID_VALUE" "$destination"; then
    launchctl bootout "gui/$UID_VALUE/$label" >/dev/null 2>&1 || true
    sleep 1
    launchctl bootstrap "gui/$UID_VALUE" "$destination"
  fi
  launchctl enable "gui/$UID_VALUE/$label" >/dev/null 2>&1 || true
}

agent_loaded() {
  launchctl print "gui/$UID_VALUE/$1" >/dev/null 2>&1
}

echo "安装目录：$ROOT"
echo "内容源：  $SRC"
echo "日志目录：$LOG_DIR"

# 先渲染全部模板，再按依赖顺序加载。poster-qa 先加载、
# self-check 最后启动，避免自检在其它任务尚未加载时误报。
for label in daily-sync self-check poster-qa; do
  template="$ROOT/deploy/com.classicmovie.$label.plist.template"
  destination="$AGENTS_DIR/com.classicmovie.$label.plist"
  if [ ! -f "$template" ]; then
    echo "安装失败：缺少模板 $template" >&2
    exit 1
  fi
  render_plist "$template" "$destination"
  plutil -lint "$destination" >/dev/null
done

for label in poster-qa daily-sync self-check; do
  destination="$AGENTS_DIR/com.classicmovie.$label.plist"
  if [ "$MISSING_ONLY" -eq 1 ] && agent_loaded "com.classicmovie.$label"; then
    echo "已加载，保持不变：com.classicmovie.$label"
    continue
  fi
  reload_agent "com.classicmovie.$label" "$destination"
  echo "已安装：com.classicmovie.$label"
done

# Calendar-only agents otherwise remain "uninitialized" until their first
# scheduled time. Kick the poster audit once so install itself proves the job
# can start under launchd; the script's PID lock makes this safe.
launchctl kickstart "gui/$UID_VALUE/com.classicmovie.poster-qa" >/dev/null 2>&1 || true
sleep 1
node "$ROOT/tools/check-automation.mjs"
