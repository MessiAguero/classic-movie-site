#!/usr/bin/env node
/**
 * 运行子进程并设置硬超时，避免网络调用卡住整条同步链路。
 *
 * 用法：
 *   node tools/run-with-timeout.mjs 30000 npm run data:sync
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:os';

const [timeoutArg, command, ...args] = process.argv.slice(2);
const timeoutMs = Number(timeoutArg);
const useProcessGroup = process.platform !== 'win32';

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !command) {
  console.error('用法：node tools/run-with-timeout.mjs <毫秒> <命令> [...参数]');
  process.exit(2);
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env,
  detached: useProcessGroup,
});

let timedOut = false;
let forceKillTimer;
let interrupted = false;
let finished = false;

function signalChild(signal) {
  if (!child.pid) return;
  try {
    if (useProcessGroup) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* 子进程已经退出 */
    }
  }
}

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timeoutTimer);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  process.exit(code);
}

const timeoutTimer = setTimeout(() => {
  timedOut = true;
  console.error(`!! 命令超时（${timeoutMs}ms），正在终止进程组：${command} ${args.join(' ')}`);
  signalChild('SIGTERM');
  // A parent can exit on SIGTERM while a descendant ignores it. Keep the
  // grace timer alive and signal the whole group again before exiting.
  forceKillTimer = setTimeout(() => {
    signalChild('SIGKILL');
    finish(124);
  }, 3000);
}, timeoutMs);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = true;
    clearTimeout(timeoutTimer);
    signalChild('SIGTERM');
    forceKillTimer = setTimeout(() => {
      signalChild('SIGKILL');
      finish(143);
    }, 3000);
  });
}

child.on('error', (error) => {
  console.error(`✗ 无法启动命令：${error.message}`);
  finish(127);
});

child.on('exit', (code, signal) => {
  if (timedOut || interrupted) return;
  if (signal) {
    finish(128 + (constants.signals[signal] || 0));
    return;
  }
  finish(code ?? 1);
});
