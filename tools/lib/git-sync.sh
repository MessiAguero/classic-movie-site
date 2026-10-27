#!/usr/bin/env bash
#
# Shared Git publish helpers. Callers must commit first; these helpers only
# synchronize committed content with origin and report whether they succeeded.

git_branch() {
  git rev-parse --abbrev-ref HEAD
}

git_has_push_remote() {
  git remote get-url origin >/dev/null 2>&1
}

git_content_dirty() {
  [ -n "$(git status --porcelain -- source-html src/data public/posters 2>/dev/null)" ]
}

git_ahead_count() {
  local branch="$1"
  git rev-list --count "origin/$branch..HEAD" 2>/dev/null || printf '0'
}

git_network() {
  GIT_TERMINAL_PROMPT=0 git \
    -c http.lowSpeedLimit=1000 \
    -c http.lowSpeedTime=20 \
    -c http.version=HTTP/1.1 \
    "$@"
}

git_push_with_retry() {
  local branch="$1"
  local attempt push_log behind rc
  local retry_log
  retry_log="$(mktemp -t classicmovie-push.XXXXXX)"

  for attempt in 1 2 3; do
    set +e
    push_log="$(git_network push origin HEAD 2>&1)"
    rc=$?
    set -e
    if [ "$rc" -eq 0 ]; then
      if git_network fetch origin "$branch" --quiet; then
        if [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$branch")" ]; then
          rm -f "$retry_log"
          return 0
        fi
        echo "!! 推送后远端 HEAD 与本地不一致（第 $attempt 次）"
      else
        echo "!! 推送成功，但无法读取远端 HEAD（第 $attempt 次）"
      fi
    else
      printf '%s\n' "$push_log" > "$retry_log"
      echo "!! git push 失败（第 $attempt/3 次）"
      if [ "$attempt" -eq 1 ] && git_network fetch origin "$branch" --quiet 2>/dev/null; then
        behind="$(git rev-list --count "HEAD..origin/$branch" 2>/dev/null || printf '0')"
        if [ "${behind:-0}" -gt 0 ]; then
          echo "== 远端新增 ${behind} 个提交，先安全地变基再接续推送"
          set +e
          git_network pull --rebase --autostash origin "$branch"
          rc=$?
          set -e
          if [ "$rc" -ne 0 ]; then
            git rebase --abort >/dev/null 2>&1 || true
            echo "!! 自动变基失败，已中止；请手动解决冲突后重试"
            rm -f "$retry_log"
            return 1
          fi
        fi
      fi
    fi
    if [ "$attempt" -lt 3 ]; then sleep $((attempt * 3)); fi
  done

  if [ -s "$retry_log" ]; then
    echo "!! 最后一次 git push 错误：" >&2
    tail -6 "$retry_log" >&2
  fi
  rm -f "$retry_log"
  return 1
}

git_push_if_ahead() {
  local branch ahead behind
  git_has_push_remote || return 1
  branch="$(git_branch)"
  git_network fetch origin "$branch" --quiet || return 1
  if ! git rev-parse --verify --quiet "origin/$branch" >/dev/null; then
    echo "!! 远程分支 origin/$branch 不存在"
    return 1
  fi
  behind="$(git rev-list --count "HEAD..origin/$branch" 2>/dev/null || printf '0')"
  if [ "${behind:-0}" -gt 0 ]; then
    echo "== 本地落后远程 ${behind} 个提交，先安全地变基"
    if ! git_network pull --rebase --autostash origin "$branch"; then
      git rebase --abort >/dev/null 2>&1 || true
      echo "!! 自动变基失败，已中止；请手动解决冲突后重试"
      return 1
    fi
  fi
  ahead="$(git_ahead_count "$branch")"
  if [ "${ahead:-0}" -eq 0 ]; then
    echo "== 远程已是最新"
    return 0
  fi
  echo "== 本地有 ${ahead} 个提交尚未推送，正在补齐"
  git_push_with_retry "$branch"
}
