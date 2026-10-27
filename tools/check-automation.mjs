#!/usr/bin/env node
/**
 * 检查 macOS 定时任务是否仍指向当前仓库，并且没有被 launchd 以非零状态退出。
 *
 * 用法：
 *   node tools/check-automation.mjs
 *   node tools/check-automation.mjs --json
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();
const UID = process.getuid?.();
const SRC_DIR = process.env.DAILY_SRC || '/Users/admin/WorkBuddy/automation-20260423112820';
const JSON_ONLY = process.argv.includes('--json');
const AGENTS_DIR = path.join(HOME, 'Library', 'LaunchAgents');
const OUTPUT = path.join(ROOT, 'output', 'automation-audit.json');

const SERVICES = [
  { label: 'com.classicmovie.daily-sync', script: 'tools/daily-sync.sh', interval: 900 },
  { label: 'com.classicmovie.self-check', script: 'tools/self-check.sh', interval: 3600 },
  { label: 'com.classicmovie.poster-qa', script: 'tools/poster-qa.sh', interval: null },
];

function parsePlist(file) {
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(json);
}

function printService(label) {
  if (UID == null) return { loaded: false, error: '无法读取当前用户 UID' };
  try {
    const text = execFileSync('launchctl', ['print', `gui/${UID}/${label}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      loaded: true,
      state: text.match(/state = ([^\n]+)/)?.[1]?.trim() || null,
      runs: Number(text.match(/runs = (\d+)/)?.[1] ?? 0),
      lastExitCode: Number(text.match(/last exit code = (-?\d+)/)?.[1] ?? 0),
    };
  } catch {
    return { loaded: false, error: 'launchd 未加载该任务' };
  }
}

const results = SERVICES.map((service) => {
  const plistPath = path.join(AGENTS_DIR, `${service.label}.plist`);
  const expectedScript = path.join(ROOT, service.script);
  const issues = [];
  let config = null;

  if (!fs.existsSync(plistPath)) {
    issues.push('未安装 LaunchAgent');
  } else {
    try {
      config = parsePlist(plistPath);
    } catch (error) {
      issues.push(`plist 无法解析：${error.message}`);
    }
  }

  if (config) {
    const program = config.ProgramArguments?.[1];
    if (program !== expectedScript) {
      issues.push(`脚本路径失效：${program || '未配置'}，应为 ${expectedScript}`);
    }
    if (config.WorkingDirectory !== ROOT) {
      issues.push(`工作目录失效：${config.WorkingDirectory || '未配置'}，应为 ${ROOT}`);
    }
    if (service.interval != null && config.StartInterval !== service.interval) {
      issues.push(`检查间隔异常：${config.StartInterval ?? '未配置'} 秒，应为 ${service.interval} 秒`);
    }
    if (
      (service.label.endsWith('daily-sync') || service.label.endsWith('self-check')) &&
      !(config.WatchPaths || []).includes(SRC_DIR)
    ) {
      issues.push(`未监听内容源目录：${SRC_DIR}`);
    }
  }

  const runtime = printService(service.label);
  if (!runtime.loaded) {
    issues.push(runtime.error || 'launchd 状态不可用');
  } else if (runtime.runs === 0 && runtime.state !== 'running') {
    issues.push('定时任务尚未成功启动过');
  } else if (runtime.lastExitCode !== 0 && runtime.state !== 'running') {
    issues.push(`上次退出码为 ${runtime.lastExitCode}，定时任务执行失败`);
  }

  return {
    label: service.label,
    plistPath,
    expectedScript,
    configFound: Boolean(config),
    ...runtime,
    issues,
  };
});

if (!fs.existsSync(SRC_DIR)) {
  results.push({
    label: 'content-source',
    plistPath: null,
    expectedScript: null,
    configFound: false,
    loaded: false,
    state: null,
    runs: 0,
    lastExitCode: null,
    issues: [`内容源目录不存在：${SRC_DIR}`],
  });
}

const ok = results.every((item) => item.issues.length === 0);
const report = {
  checkedAt: new Date().toISOString(),
  ok,
  root: ROOT,
  sourceDir: SRC_DIR,
  services: results,
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2), 'utf8');

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('');
  console.log('定时任务健康检查');
  console.log('─'.repeat(72));
  for (const item of results) {
    const state = item.loaded ? `${item.state || '已加载'} · runs ${item.runs} · exit ${item.lastExitCode}` : '未加载';
    console.log(`${item.issues.length ? '❌' : '✅'} ${item.label} · ${state}`);
    for (const issue of item.issues) console.log(`   - ${issue}`);
  }
  console.log('─'.repeat(72));
  if (!ok) console.log('修复：npm run automation:install');
  console.log(`结果：${ok ? '✅ 定时任务正常' : '❌ 定时任务需要修复'}`);
}

process.exit(ok ? 0 : 1);
