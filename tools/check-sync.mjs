#!/usr/bin/env node
/**
 * 同步时效自检 —— 回答一个问题：新生成的内容，到底有没有上线？
 *
 * 沿着「WorkBuddy 源目录 → source-html/ → movies.json → 本地提交 → 远程仓库 → 线上站点」
 * 逐段核对，指出卡在哪一段，并给出修复动作（tools/self-check.sh 会照着自动修）。
 *
 * 检查项：
 *   1. 源目录里的新 HTML 是否已复制进 source-html/
 *   2. source-html/ 里的页面是否都已解析进 movies.json
 *   3. 每部新片是否都抓到了海报（gallery.json）
 *   4. 内容改动是否已提交、是否已推送到远程
 *   5. 已推送的内容是否已经出现在线上站点
 *
 * 宽限期（避免刚生成就被判为「没同步」）：
 *   SYNC_GRACE_MINUTES   源文件生成多久后才要求已同步，默认 30 分钟
 *   DEPLOY_GRACE_MINUTES 推送后多久内允许线上还没更新，默认 10 分钟
 *
 * 用法：
 *   node tools/check-sync.mjs            # 检查；发现未及时同步时退出码 1
 *   node tools/check-sync.mjs --json     # 只输出 JSON
 *   node tools/check-sync.mjs --quiet    # 只输出结论行
 *   node tools/check-sync.mjs --offline  # 跳过联网核对（git fetch 与线上站点）
 *
 * 产物：output/sync-audit.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const HTML_DIR = path.join(ROOT, 'source-html');
const MOVIES_PATH = path.join(ROOT, 'src', 'data', 'movies.json');
const GALLERY_PATH = path.join(ROOT, 'src', 'data', 'gallery.json');

const argv = process.argv.slice(2);
const JSON_ONLY = argv.includes('--json');
const QUIET = argv.includes('--quiet');
const OFFLINE = argv.includes('--offline');

const SRC_DIR = process.env.DAILY_SRC || '/Users/admin/WorkBuddy/automation-20260423112820';
const GRACE_MIN = Number(process.env.SYNC_GRACE_MINUTES ?? 30);
const DEPLOY_GRACE_MIN = Number(process.env.DEPLOY_GRACE_MINUTES ?? 10);

// 这些路径下的改动属于「该上线的内容」，没提交就等于没同步。
// 巡检报告本身（output/）不算内容，否则每次自检都会把自己判成未提交。
const CONTENT_PATHS = ['source-html/', 'src/data/', 'public/posters/'];
const HTML_FILE_RE = /^movie-recommend-(\d{8}|\d{4}-\d{2}-\d{2})(-[A-Za-z0-9-]+)?\.html$/;

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const min = (n) => Math.round(n / 60000);

function git(args, { allowFail = true } = {}) {
  try {
    return execFileSync('git', ['-C', ROOT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

/** movie-recommend-2026-10-16-market.html → 20261016-market */
function idFromFile(name) {
  const m = HTML_FILE_RE.exec(name);
  if (!m) return null;
  const date = m[1].includes('-') ? m[1].replace(/-/g, '') : m[1];
  return date + (m[2] || '');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** 从 git remote 推导线上地址，并挑出真正能打开的那个（Pages 域名大小写敏感） */
async function resolveSiteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  const remote = git(['remote', 'get-url', 'origin']);
  const m = remote && remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return null;
  const [, owner, repo] = m;
  const candidates = [
    `https://${owner}.github.io/${repo}/`,
    `https://${owner.toLowerCase()}.github.io/${repo.toLowerCase()}/`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) return url;
    } catch {
      /* 换下一个候选 */
    }
  }
  return candidates[0];
}

async function checkLive(url, newest) {
  if (!url) return { checked: false, reason: '无法确定线上地址' };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { checked: false, url, reason: `线上站点返回 HTTP ${res.status}` };
    const html = norm(await res.text());
    return {
      checked: true,
      url,
      httpStatus: res.status,
      newestId: newest?.id ?? null,
      newestFound: newest ? html.includes(norm(newest.zhTitle)) : false,
    };
  } catch (e) {
    return { checked: false, url, reason: `线上站点访问失败：${e?.message || e}` };
  }
}

async function collect() {
  const now = Date.now();
  const issues = [];
  const add = (code, severity, detail, fix) => issues.push({ code, severity, detail, fix });

  /* ---------- 1. 源目录 → source-html ---------- */
  let sourceFiles = [];
  if (!fs.existsSync(SRC_DIR)) {
    add('source_dir_missing', 'warn', `源目录不存在：${SRC_DIR}`, '确认 WorkBuddy 的输出目录后设置 DAILY_SRC');
  } else {
    sourceFiles = fs.readdirSync(SRC_DIR).filter((f) => HTML_FILE_RE.test(f));
  }

  const htmlFiles = fs.existsSync(HTML_DIR)
    ? fs.readdirSync(HTML_DIR).filter((f) => HTML_FILE_RE.test(f))
    : [];
  const htmlIds = new Set(htmlFiles.map(idFromFile));

  const notCopied = [];
  const pendingGrace = [];
  for (const f of sourceFiles) {
    const id = idFromFile(f);
    if (!id || htmlIds.has(id)) continue;
    const ageMs = now - fs.statSync(path.join(SRC_DIR, f)).mtimeMs;
    if (ageMs < GRACE_MIN * 60000) {
      pendingGrace.push({ id, ageMin: min(ageMs) });
      continue;
    }
    notCopied.push({ id, ageMin: min(ageMs) });
  }
  if (notCopied.length) {
    add(
      'source_not_copied',
      'stale',
      `源目录有 ${notCopied.length} 份新页面没同步进 source-html/：${notCopied
        .map((x) => `${x.id}（生成 ${x.ageMin} 分钟前）`)
        .join('、')}`,
      'tools/daily-sync.sh',
    );
  }

  /* ---------- 2. source-html → movies.json ---------- */
  const movies = readJson(MOVIES_PATH, []);
  const gallery = readJson(GALLERY_PATH, []);
  const movieIds = new Set(movies.map((m) => m.id));
  const galleryIds = new Set(gallery.map((g) => g.id));

  const dueIds = htmlFiles
    .filter((f) => now - fs.statSync(path.join(HTML_DIR, f)).mtimeMs >= GRACE_MIN * 60000)
    .map(idFromFile)
    .filter(Boolean);

  const unparsed = dueIds.filter((id) => !movieIds.has(id));
  if (unparsed.length) {
    add(
      'not_parsed',
      'stale',
      `${unparsed.length} 份页面没解析进 movies.json：${unparsed.join('、')}`,
      'tools/daily-sync.sh',
    );
  }
  const extraParsed = movies.filter((m) => !htmlIds.has(m.id)).map((m) => m.id);
  if (extraParsed.length) {
    add(
      'parsed_orphan',
      'warn',
      `movies.json 里有 ${extraParsed.length} 条找不到对应页面：${extraParsed.slice(0, 8).join('、')}`,
      '检查 source-html/ 是否被误删',
    );
  }

  /* ---------- 3. 新片海报 ---------- */
  const noPoster = dueIds.filter((id) => !galleryIds.has(id));
  if (noPoster.length) {
    add(
      'poster_missing',
      'stale',
      `${noPoster.length} 部新片还没有海报：${noPoster.join('、')}`,
      'npm run data:gallery && ./tools/poster-qa.sh',
    );
  }

  /* ---------- 4. 本地提交与远程仓库 ---------- */
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  const head = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain']) || '';
  const dirtyContent = status
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      const p = line.slice(3).trim().replace(/^"|"$/g, '');
      return CONTENT_PATHS.some((prefix) => p.startsWith(prefix));
    });
  if (dirtyContent.length) {
    add(
      'uncommitted',
      'stale',
      `有 ${dirtyContent.length} 处内容改动还没提交：${dirtyContent
        .slice(0, 6)
        .map((l) => l.slice(3).trim())
        .join('、')}`,
      'tools/daily-sync.sh',
    );
  }

  let remoteRef = null;
  let ahead = 0;
  let behind = 0;
  let remoteChecked = false;
  if (!OFFLINE) {
    git(['fetch', 'origin', '--quiet']);
    remoteRef = git(['rev-parse', `origin/${branch}`]);
    if (remoteRef) {
      remoteChecked = true;
      const counts = git(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`]);
      if (counts) {
        const [a, b] = counts.split(/\s+/).map(Number);
        ahead = a;
        behind = b;
      }
    }
  }
  if (ahead > 0) {
    add('unpushed', 'stale', `本地比远程多 ${ahead} 个提交，内容还没传上去`, 'git push origin HEAD');
  }
  if (behind > 0) {
    add('behind_remote', 'warn', `本地比远程少 ${behind} 个提交，建议先拉取再自检`, 'git pull --rebase');
  }
  if (!OFFLINE && !remoteChecked) {
    add('remote_unreachable', 'warn', '无法从远程仓库读取状态（网络或权限问题）', '检查网络与 git remote');
  }

  /* ---------- 5. 线上站点 ---------- */
  const newest = movies.reduce((best, m) => {
    if (!best) return m;
    if (String(m.date) > String(best.date)) return m;
    if (String(m.date) === String(best.date) && String(m.id) > String(best.id)) return m;
    return best;
  }, null);

  let live = { checked: false, reason: '已跳过（--offline）' };
  if (!OFFLINE && newest) {
    live = await checkLive(await resolveSiteUrl(), newest);
  }
  const headAgeMin = head ? min(now - Number(git(['log', '-1', '--format=%ct']) || 0) * 1000) : null;

  if (live.checked && !live.newestFound && newest) {
    const pushedRecently = headAgeMin !== null && headAgeMin < DEPLOY_GRACE_MIN;
    add(
      pushedRecently ? 'deploy_pending' : 'not_live',
      pushedRecently ? 'warn' : 'stale',
      pushedRecently
        ? `最新一篇《${newest.zhTitle}》刚推送 ${headAgeMin} 分钟，线上还在部署中`
        : `最新一篇《${newest.zhTitle}》（${newest.id}）推送已 ${headAgeMin} 分钟，线上仍未出现`,
      'git push origin HEAD 后等待 Actions 完成；若长期不生效需检查 Actions 构建',
    );
  }
  if (!live.checked && !OFFLINE && live.reason) {
    add('site_unreachable', 'warn', `线上核对跳过：${live.reason}`, '检查 Pages 地址或设置 SITE_URL');
  }

  return {
    generatedAt: new Date().toISOString(),
    thresholds: { graceMinutes: GRACE_MIN, deployGraceMinutes: DEPLOY_GRACE_MIN },
    facts: {
      sourceDir: SRC_DIR,
      sourceCount: sourceFiles.length,
      htmlCount: htmlFiles.length,
      parsedCount: movies.length,
      galleryCount: gallery.length,
      newest: newest ? { id: newest.id, date: newest.date, zhTitle: newest.zhTitle } : null,
      pendingGrace,
      branch,
      head: head ? head.slice(0, 7) : null,
      remote: remoteRef ? remoteRef.slice(0, 7) : null,
      ahead,
      behind,
      dirtyCount: status.split('\n').filter(Boolean).length,
      live,
      headAgeMinutes: headAgeMin,
    },
    issues,
    staleCount: issues.filter((i) => i.severity === 'stale').length,
    warnCount: issues.filter((i) => i.severity === 'warn').length,
  };
}

function printConsole(report) {
  const line = '─'.repeat(72);
  const f = report.facts;
  console.log(`\n同步时效自检 · ${report.generatedAt}`);
  console.log(line);
  console.log(
    `页面 ${f.sourceCount} 份（源目录）→ ${f.htmlCount} 份（source-html）→ ${f.parsedCount} 条（站点数据）· 海报 ${f.galleryCount} 张`,
  );
  const live = f.live?.checked
    ? f.live.newestFound
      ? '线上已是最新'
      : '线上还没出现最新一篇'
    : `未核对（${f.live?.reason || '已跳过'}）`;
  console.log(`最新一篇：${f.newest ? `${f.newest.id} 《${f.newest.zhTitle}》` : '无'} · ${live}`);
  console.log(`本地 ${f.head ?? '-'} ↔ 远程 ${f.remote ?? '-'}（领先 ${f.ahead} / 落后 ${f.behind}）`);
  console.log(line);

  if (!report.issues.length) {
    console.log('✅ 同步链路正常，内容都已及时上线');
    console.log(line);
    return;
  }
  for (const i of report.issues) {
    console.log(`${i.severity === 'stale' ? '❌ 未同步' : '⚠️  提示'} · ${i.detail}`);
    if (i.fix) console.log(`      修复：${i.fix}`);
  }
  console.log(line);
  console.log(`未及时同步 ${report.staleCount} 项 · 提示 ${report.warnCount} 项`);
  console.log('');
}

const report = await collect();
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, 'sync-audit.json'), JSON.stringify(report, null, 2), 'utf8');

if (JSON_ONLY) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
else if (QUIET) {
  console.log(
    report.staleCount
      ? `同步自检：未及时同步 ${report.staleCount} 项（提示 ${report.warnCount} 项）`
      : `同步自检：正常（提示 ${report.warnCount} 项）`,
  );
} else printConsole(report);

process.exit(report.staleCount ? 1 : 0);
