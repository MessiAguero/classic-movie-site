#!/usr/bin/env bash
#
# Small PID-aware directory lock used by the synchronous maintenance jobs.
# A SIGKILL cannot run an EXIT trap, so locks left by a dead owner are reclaimed.
# A nested job (self-check -> daily-sync -> poster-qa) may reuse the lock held
# by its parent through the inherited CLASSICMOVIE_* variables.

lock_owner_pid() {
  local lock_dir="$1"
  local pid=""
  if [ -f "$lock_dir/pid" ]; then
    pid="$(tr -dc '0-9' < "$lock_dir/pid" 2>/dev/null || true)"
  fi
  printf '%s' "$pid"
}

lock_owner_alive() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

lock_process_start() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  ps -p "$pid" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

lock_age_seconds() {
  local lock_dir="$1"
  local now modified
  now="$(date +%s)"
  modified="$(stat -f '%m' "$lock_dir" 2>/dev/null || stat -c '%Y' "$lock_dir" 2>/dev/null || echo "$now")"
  printf '%s' "$((now - modified))"
}

lock_owner_matches() {
  local lock_dir="$1"
  local pid="$2"
  local recorded current
  recorded="$(tr -d '\r\n' < "$lock_dir/start" 2>/dev/null || true)"
  [ -n "$recorded" ] || return 0
  current="$(lock_process_start "$pid")"
  [ -n "$current" ] && [ "$recorded" = "$current" ]
}

lock_is_active() {
  local lock_dir="$1"
  local pid
  pid="$(lock_owner_pid "$lock_dir")"
  lock_owner_alive "$pid" && lock_owner_matches "$lock_dir" "$pid"
}

discard_stale_lock() {
  local lock_dir="$1"
  local stale
  # Rename before deleting so a contender cannot acquire the old directory
  # while this process is still removing it.
  stale="${lock_dir}.stale.$$.$RANDOM"
  if mv "$lock_dir" "$stale" 2>/dev/null; then
    rm -rf "$stale"
    return 0
  fi
  return 1
}

acquire_lock() {
  local lock_dir="$1"
  local empty_grace="${2:-5}"
  local pid="" age="" inherited_pid=""
  local attempt

  inherited_pid="${CLASSICMOVIE_LOCK_OWNER_PID:-}"
  if [ "${CLASSICMOVIE_LOCK_DIR:-}" = "$lock_dir" ] && [ -n "$inherited_pid" ] \
    && [ "$(lock_owner_pid "$lock_dir")" = "$inherited_pid" ] \
    && lock_owner_alive "$inherited_pid" \
    && lock_owner_matches "$lock_dir" "$inherited_pid"; then
    LOCK_REENTRANT=1
    return 0
  fi

  for attempt in 1 2 3 4 5; do
    if mkdir "$lock_dir" 2>/dev/null; then
      printf '%s\n' "$$" > "$lock_dir/pid"
      lock_process_start "$$" > "$lock_dir/start"
      LOCK_REENTRANT=0
      export CLASSICMOVIE_LOCK_DIR="$lock_dir"
      export CLASSICMOVIE_LOCK_OWNER_PID="$$"
      return 0
    fi

    pid="$(lock_owner_pid "$lock_dir")"
    age="$(lock_age_seconds "$lock_dir")"

    # mkdir succeeds before pid/start are written. Give that hand-off window
    # time to finish instead of deleting a lock that is being created.
    if [ -z "$pid" ] && [ "$age" -lt "$empty_grace" ]; then
      sleep 1
      continue
    fi

    if lock_owner_alive "$pid" && lock_owner_matches "$lock_dir" "$pid"; then
      return 1
    fi

    if [ -z "$pid" ] || ! lock_owner_alive "$pid" || ! lock_owner_matches "$lock_dir" "$pid"; then
      echo "!! 清理失效锁：$lock_dir（pid=${pid:-unknown}）"
      discard_stale_lock "$lock_dir" || true
      continue
    fi
    return 1
  done
  return 1
}

release_lock() {
  local lock_dir="$1"
  local pid
  if [ "${LOCK_REENTRANT:-0}" = "1" ]; then
    return 0
  fi
  pid="$(lock_owner_pid "$lock_dir")"
  if [ "$pid" = "$$" ]; then
    rm -rf "$lock_dir"
    unset CLASSICMOVIE_LOCK_DIR CLASSICMOVIE_LOCK_OWNER_PID
  fi
}
