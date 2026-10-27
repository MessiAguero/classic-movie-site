#!/usr/bin/env bash
#
# 全站自检 + 自动修复
#
#   1. 同步时效自检：WorkBuddy → source-html → movies.json → 提交 → 推送 → 线上，逐段核对
#   2. 发现未及时同步 → 自动补齐（tools/daily-sync.sh）→ 补齐后复核一次
#   3. 海报自检：错误搭配 / 横版剧照 / 缩略图 / 重复图 → 自动换图（tools/poster-qa.sh）→ 复检
#   4. 结论写入 output/self-check.md 与 output/self-check.json
#
# 用法：
#   ./tools/self-check.sh                   # 自检 + 自动修复
#   ./tools/self-check.sh --check-only      # 只自检，不改动任何东西
#   ./tools/self-check.sh --posters=always  # 每次都巡检海报（默认 auto：有新内容或距上次超过 24 小时才跑）
#   ./tools/self-check.sh --posters=never   # 只查同步，不查海报
#   ./tools/self-check.sh --offline         # 跳过联网核对（git fetch 与线上站点）
#
# 退出码：0 = 一切正常（含已自动修好）；1 = 仍有未解决的问题

set -euo pipefail

# launchd 环境 PATH 很精简，手动补全 node/git 路径
export PATH="/Users/admin/.local/bin:/Users/admin/.hermes/node/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHECK_ONLY=0
POSTERS="auto"
SYNC_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    --posters=*) POSTERS="${arg#--posters=}" ;;
    --offline) SYNC_ARGS+=(--offline) ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

case "$POSTERS" in
  auto|always|never) ;;
  *) echo "未知 --posters 取值：$POSTERS（可选 auto/always/never）"; exit 2 ;;
esac

# 防并发：同一时间只允许一个自检任务
LOCK="/tmp/classicmovie-selfcheck.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "== $(date '+%F %T') 已有自检任务在运行，跳过本次"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

log() { echo "$@"; }

# 同步脚本自己有锁：正在同步时先等它跑完，避免自检读到中间状态
wait_for_sync_lock() {
  local waited=0
  while [ -d /tmp/classicmovie-sync.lock ] && [ "$waited" -lt 600 ]; do
    sleep 10
    waited=$((waited + 10))
  done
  if [ "$waited" -ge 600 ]; then
    log "!! 等待同步任务超过 10 分钟，仍继续自检"
  fi
}

push_if_ahead() {
  local branch ahead rc
  branch="$(git rev-parse --abbrev-ref HEAD)"
  ahead="$(git rev-list --count "origin/$branch..HEAD" 2>/dev/null || echo 0)"
  if [ "${ahead:-0}" -gt 0 ]; then
    log "▶ 有 ${ahead} 个提交未推送，正在推送…"
    set +e
    git push origin HEAD
    rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      log "!! 推送失败，请检查网络与 git 凭据"
    fi
  fi
}

# 海报是否要跑：有新内容，或距上次巡检超过 24 小时，或上次有错误
should_run_posters() {
  [ "$POSTERS" = "always" ] && return 0
  [ "$POSTERS" = "never" ] && return 1
  [ "$CONTENT_CHANGED" = "1" ] && return 0
  node -e '
    const fs = require("fs");
    let report;
    try {
      report = JSON.parse(fs.readFileSync("output/poster-audit.json", "utf8"));
    } catch {
      process.exit(0); // 从没巡检过 → 跑一次
    }
    const ageHours = (Date.now() - new Date(report.generatedAt).getTime()) / 3600000;
    process.exit(ageHours > 24 || (report.error || 0) > 0 ? 0 : 1);
  '
}

log "== $(date '+%F %T') 开始全站自检 =="
log "模式：$([ "$CHECK_ONLY" -eq 1 ] && echo '只自检（不修改）' || echo '自检 + 自动修复') · 海报：$POSTERS"

BEFORE_HEAD="$(git rev-parse HEAD)"
CONTENT_CHANGED=0
SYNC_REPAIR="未需要"
AUTOMATION_REPAIR="未需要"

log ""
log "-- 1/3 定时任务健康检查 --"
set +e
node tools/check-automation.mjs
AUTOMATION_RC=$?
set -e
if [ "$AUTOMATION_RC" -eq 0 ]; then
  log "✅ 定时任务正常"
elif [ "$CHECK_ONLY" -eq 1 ]; then
  log "!! 定时任务配置异常（只自检模式，不自动修复）"
elif [ -n "${XPC_SERVICE_NAME:-}" ]; then
  log "!! 定时任务配置异常；请先手动运行 npm run automation:install"
else
  log "▶ 定时任务配置异常，正在按当前仓库路径重新安装…"
  set +e
  "$ROOT/tools/install-launchd.sh"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    AUTOMATION_REPAIR="已重新安装 launchd 任务"
    set +e
    node tools/check-automation.mjs
    AUTOMATION_RC=$?
    set -e
  else
    log "!! launchd 重装失败，退出码 $rc"
  fi
fi

log ""
log "-- 2/3 同步时效自检 --"
set +e
node tools/check-sync.mjs "${SYNC_ARGS[@]+"${SYNC_ARGS[@]}"}"
SYNC_RC=$?
set -e

if [ "$SYNC_RC" -eq 0 ]; then
  log "✅ 同步链路正常"
elif [ "$CHECK_ONLY" -eq 1 ]; then
  log "!! 存在未及时同步的内容（只自检模式，不自动修复）"
else
  log "▶ 存在未及时同步的内容，开始自动补齐…"
  wait_for_sync_lock
  set +e
  "$ROOT/tools/daily-sync.sh"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    log "!! daily-sync.sh 退出码 $rc，继续复核"
  fi
  SYNC_REPAIR="已执行 daily-sync.sh"

  push_if_ahead
  AFTER_HEAD="$(git rev-parse HEAD)"
  if [ "$AFTER_HEAD" != "$BEFORE_HEAD" ]; then
    CONTENT_CHANGED=1
  fi

  log ""
  log "▶ 补齐后复核"
  set +e
  node tools/check-sync.mjs "${SYNC_ARGS[@]+"${SYNC_ARGS[@]}"}"
  SYNC_RC=$?
  set -e
fi

log ""
log "-- 3/3 海报自检 --"
POSTER_ACTION="跳过（无新内容且距上次巡检不足 24 小时）"
if should_run_posters; then
  if [ "$CHECK_ONLY" -eq 1 ]; then
    POSTER_ACTION="只巡检"
    set +e
    "$ROOT/tools/poster-qa.sh" --check-only
    rc=$?
    set -e
  else
    POSTER_ACTION="巡检 + 自动纠错"
    set +e
    "$ROOT/tools/poster-qa.sh"
    rc=$?
    set -e
  fi
  if [ "$rc" -ne 0 ]; then
    log "!! 海报巡检退出码 $rc（部分条目仍待处理，详见 output/poster-audit.md）"
  fi
else
  log "== $POSTER_ACTION"
fi

# 生成人工核对页：把「机器不敢打包票」的海报挑成一页，扫一眼就能发现配错图
set +e
node tools/poster-review.mjs
set -e

# 汇总：直接读两份巡检产物，避免在这里重复判断
set +e
MODE="$( [ "$CHECK_ONLY" -eq 1 ] && echo 'check-only' || echo 'repair' )" \
POSTER_ACTION="$POSTER_ACTION" \
SYNC_REPAIR="$SYNC_REPAIR" \
AUTOMATION_REPAIR="$AUTOMATION_REPAIR" \
POSTER_MODE="$POSTERS" \
node -e '
  const fs = require("fs");
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

  const sync = readJson("output/sync-audit.json");
  const poster = readJson("output/poster-audit.json");
  const review = readJson("output/poster-review.json");
  const automation = readJson("output/automation-audit.json");

  const syncStale = sync ? sync.staleCount : -1;
  const posterError = poster ? poster.error : 0;
  const automationFailed = automation && automation.ok ? 0 : -1;
  const ok = automationFailed === 0 && syncStale === 0 && posterError === 0;

  const report = {
    at: new Date().toISOString(),
    mode: process.env.MODE,
    result: ok ? "ok" : "unresolved",
    repair: {
      automation: process.env.AUTOMATION_REPAIR,
      sync: process.env.SYNC_REPAIR,
      posters: process.env.POSTER_ACTION,
    },
    automation: automation
      ? {
          ok: automation.ok,
          root: automation.root,
          sourceDir: automation.sourceDir,
          failedServices: automation.services.filter((s) => s.issues.length).map((s) => ({
            label: s.label,
            issues: s.issues,
          })),
        }
      : null,
    sync: sync
      ? {
          staleCount: sync.staleCount,
          warnCount: sync.warnCount,
          newest: sync.facts.newest,
          head: sync.facts.head,
          remote: sync.facts.remote,
          ahead: sync.facts.ahead,
          behind: sync.facts.behind,
          live: sync.facts.live,
          issues: sync.issues,
        }
      : null,
    posters: poster
      ? {
          total: poster.total,
          ok: poster.ok,
          warn: poster.warn,
          error: poster.error,
          reviewCount: review ? review.reviewCount : 0,
          problems: poster.entries.filter((e) => e.status !== "ok").map((e) => ({
            id: e.id, zhTitle: e.zhTitle, status: e.status, dims: e.dims,
            host: e.host, issues: e.issues.map((i) => i.code),
          })),
        }
      : null,
  };
  fs.writeFileSync("output/self-check.json", JSON.stringify(report, null, 2), "utf8");

  const L = [];
  L.push("# 全站自检报告");
  L.push("");
  L.push(`生成时间：${report.at}`);
  L.push(`结论：${ok ? "✅ 正常" : "❌ 仍有未解决项"}`);
  L.push("");
  L.push("## 定时任务");
  L.push("");
  if (report.automation) {
    L.push(`- 结论：${report.automation.ok ? "正常" : "异常"}`);
    L.push(`- 仓库路径：${report.automation.root}`);
    L.push(`- 内容源：${report.automation.sourceDir}`);
    if (report.automation.failedServices.length) {
      for (const service of report.automation.failedServices) {
        L.push(`- ❌ ${service.label}：${service.issues.join("；")}`);
      }
    }
  } else {
    L.push("- 没有读到 output/automation-audit.json");
  }
  L.push("");
  L.push("## 同步链路");
  L.push("");
  if (report.sync) {
    L.push(`- 未及时同步：${syncStale} 项（提示 ${report.sync.warnCount} 项）`);
    if (report.sync.newest) {
      L.push(`- 最新一篇：${report.sync.newest.id} 《${report.sync.newest.zhTitle}》`);
    }
    L.push(`- 本地 ${report.sync.head ?? "-"} ↔ 远程 ${report.sync.remote ?? "-"}（领先 ${report.sync.ahead} / 落后 ${report.sync.behind}）`);
    L.push(`- 线上核对：${report.sync.live?.checked ? (report.sync.live.newestFound ? "线上已是最新" : "线上还没出现最新一篇") : `未核对（${report.sync.live?.reason || "已跳过"}）`}`);
    const issues = report.sync.issues || [];
    if (issues.length) {
      L.push("");
      L.push("| 级别 | 说明 | 修复方式 |");
      L.push("| --- | --- | --- |");
      for (const i of issues) {
        L.push(`| ${i.severity === "stale" ? "❌ 未同步" : "⚠️ 提示"} | ${i.detail} | ${i.fix || "-"} |`);
      }
    }
  } else {
    L.push("- 没有读到 output/sync-audit.json");
  }
  L.push("");
  L.push("## 海报");
  L.push("");
  if (report.posters) {
    L.push(`- 总数 ${report.posters.total} · 正常 ${report.posters.ok} · 警告 ${report.posters.warn} · 错误 ${report.posters.error}`);
    L.push(`- 需人工核对：${report.posters.reviewCount} 张（output/poster-review.html）`);
    L.push(`- 本次动作：${report.repair.posters}`);
    if (report.posters.problems.length) {
      L.push("");
      L.push("| 状态 | 日期 ID | 片名 | 尺寸 | 图源 | 问题 |");
      L.push("| --- | --- | --- | --- | --- | --- |");
      for (const p of report.posters.problems.slice(0, 30)) {
        L.push(`| ${p.status === "error" ? "❌ 错误" : "⚠️ 警告"} | \`${p.id}\` | ${p.zhTitle} | ${p.dims} | ${p.host || "-"} | ${p.issues.join(", ")} |`);
      }
    }
  } else {
    L.push("- 本次未巡检海报");
  }
  L.push("");
  L.push("## 本次修复动作");
  L.push("");
  L.push(`- 定时任务：${report.repair.automation}`);
  L.push(`- 同步补齐：${report.repair.sync}`);
  L.push(`- 海报巡检：${report.repair.posters}`);
  L.push("");
  fs.writeFileSync("output/self-check.md", L.join("\n"), "utf8");

  console.log("");
  console.log("─".repeat(72));
  console.log(`自检结论：${ok ? "✅ 全部正常" : "❌ 仍有未解决项"}`);
  console.log(`  定时任务：${automationFailed === 0 ? "正常" : "异常"}`);
  console.log(`  同步：${syncStale === 0 ? "及时" : `未及时 ${syncStale} 项`} · 海报：${poster ? `错误 ${poster.error} / 警告 ${poster.warn}` : "未巡检"}`);
  if (review && review.reviewCount) console.log(`  海报待人工核对：${review.reviewCount} 张 → output/poster-review.html`);
  console.log("  报告：output/self-check.md");
  console.log("─".repeat(72));
  process.exit(ok ? 0 : 1);
'
FINAL_RC=$?
set -e

if [ "$FINAL_RC" -eq 0 ]; then
  log "== $(date '+%F %T') 自检完成：一切正常 =="
else
  log "== $(date '+%F %T') 自检完成：仍有未解决项，详见 output/self-check.md =="
fi
exit "$FINAL_RC"
