#!/usr/bin/env node
/**
 * 海报自动纠错 —— 对自检发现问题的海报，重新抓取可信图源并替换
 *
 * 流程：
 *   1. 巡检全站，挑出「需要修复」的条目（自检错误 + 影响观感的警告）
 *   2. 为每部电影寻找候选海报（TMDB API / 维基百科 / DuckDuckGo）
 *   3. 每个候选都要通过严格校验（能下载、是图片、竖版、够大、片名对得上）
 *   4. 通过后下载到 public/posters/，改成本地自托管，写回 gallery.json
 *   5. 修复后重新巡检受影响条目，确认真的修好了
 *
 * 用法：
 *   node tools/fix-posters.mjs                  # 修复所有需要修复的海报
 *   node tools/fix-posters.mjs 20260701 20260729  # 只修复指定 ID
 *   node tools/fix-posters.mjs --dry-run        # 只找候选并校验，不写盘
 *   node tools/fix-posters.mjs --all-warn       # 连「非白名单图源」这类提示也一起重抓
 *   node tools/fix-posters.mjs --self-host-all  # 把仍指向远程的海报下载到本地自托管（不换图）
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  OUTPUT_DIR,
  ensureDir,
  isRepairable,
  loadGallery,
  loadMovies,
  readPoster,
  runAudit,
  saveGallery,
  shortUrl,
} from './lib/poster-audit.mjs';
import { findReplacement, savePoster } from './lib/poster-repair.mjs';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const ALL_WARN = argv.includes('--all-warn');
const SELF_HOST_ALL = argv.includes('--self-host-all');
const ids = argv.filter((a) => !a.startsWith('--'));

const log = (...a) => console.log(...a);

/**
 * 把仍指向远程地址的海报下载到 public/posters/ 自托管。
 * 只换存放位置、不换图，因此没有「换错图」的风险。
 */
async function selfHostAll(gallery) {
  const remotes = gallery.filter((g) => /^https?:/i.test(g.imageUrl || ''));
  if (!remotes.length) {
    log('✅ 所有海报都已是本地自托管');
    return 0;
  }
  log(`▶ 待自托管 ${remotes.length} 张远程海报`);

  let done = 0;
  const failures = [];
  for (const entry of remotes) {
    const f = await readPoster(entry);
    if (!f.ok || !f.meta) {
      log(`   ✗ [${entry.id}] ${entry.zhTitle} — ${f.error || '不是有效图片'}`);
      failures.push({ id: entry.id, reason: f.error || '不是有效图片' });
      continue;
    }
    if (DRY_RUN) {
      log(`   · [${entry.id}] ${entry.zhTitle} → 可下载 ${f.meta.width}×${f.meta.height}`);
      done++;
      continue;
    }
    const rel = savePoster(entry.id, f.bytes, f.meta);
    entry.remoteUrl = entry.imageUrl;
    entry.imageUrl = rel;
    entry.hiRes = f.meta.width >= 1000;
    done++;
    log(`   ✓ [${entry.id}] ${entry.zhTitle} → ${rel}`);
  }

  if (!DRY_RUN && done) {
    saveGallery(gallery);
    log(`\n▶ gallery.json 已更新（${done} 条改为本地自托管）`);
  }
  if (failures.length) log(`⚠ ${failures.length} 条未能下载，保持远程引用`);
  return failures.length;
}

async function main() {
  const gallery = loadGallery();
  const movies = loadMovies();

  if (SELF_HOST_ALL) {
    const failed = await selfHostAll(gallery);
    return failed ? 1 : 0;
  }

  log('▶ 巡检全站海报…');
  const audit = await runAudit(gallery, movies);
  const byResultId = new Map(audit.results.map((r) => [r.id, r]));

  // 挑选修复目标
  let targets;
  if (ids.length) {
    targets = ids.map((id) => byResultId.get(id)).filter(Boolean);
    const unknown = ids.filter((id) => !byResultId.has(id));
    if (unknown.length) log(`⚠ 图库中没有这些 ID，已忽略：${unknown.join('、')}`);
  } else {
    targets = audit.results.filter((r) => (ALL_WARN ? r.status !== 'ok' : isRepairable(r)));
  }

  if (!targets.length) {
    log(`✅ 没有需要修复的海报（共 ${audit.results.length} 张：正常 ${audit.okCount} / 警告 ${audit.warnCount} / 错误 ${audit.errorCount}）`);
    return 0;
  }

  log(`▶ 待修复 ${targets.length} 条：`);
  for (const t of targets) {
    log(`   • [${t.id}] ${t.zhTitle} ${t.year} — ${t.issues.map((i) => i.code).join(', ')}`);
  }
  log('');

  const changes = [];
  const failures = [];

  for (const target of targets) {
    const entry = gallery.find((g) => g.id === target.id);
    const movie = audit.byId.get(target.id);
    const label = `[${target.id}] ${target.zhTitle}`;
    log(`▶ ${label}`);

    if (!movie) {
      log(`   ✗ movies.json 中没有对应记录，跳过`);
      failures.push({ id: target.id, reason: 'movies.json 缺少记录' });
      continue;
    }

    const found = await findReplacement(movie, { log: (m) => log(`   ${m}`) });
    if (!found) {
      log(`   ✗ 没有找到通过校验的替代海报，保留原图`);
      failures.push({ id: target.id, reason: '没有可用的替代候选' });
      continue;
    }

    const { cand, bytes, meta } = found;
    const before = {
      imageUrl: entry.imageUrl,
      dims: target.dims,
      status: target.status,
      issues: target.issues.map((i) => i.code),
    };

    if (DRY_RUN) {
      log(`   ✓ 找到可用替代（未写盘）：${meta.width}×${meta.height} ${cand.source} ${shortUrl(cand.url)}`);
      changes.push({ id: target.id, zhTitle: target.zhTitle, before, after: { dims: `${meta.width}×${meta.height}`, source: cand.source, url: cand.url }, dryRun: true });
      continue;
    }

    const rel = savePoster(target.id, bytes, meta);
    entry.imageUrl = rel;
    entry.remoteUrl = cand.url;
    entry.title = cand.title || entry.title;
    if (cand.tmdbId) entry.tmdbId = String(cand.tmdbId);
    entry.hiRes = meta.width >= 1000;

    log(`   ✓ 已替换 → ${rel}（${meta.width}×${meta.height}，来源 ${cand.source}）`);
    changes.push({
      id: target.id,
      zhTitle: target.zhTitle,
      before,
      after: { imageUrl: rel, dims: `${meta.width}×${meta.height}`, source: cand.source, url: cand.url, title: cand.title },
    });
  }

  if (!DRY_RUN && changes.length) {
    saveGallery(gallery);
    log(`\n▶ gallery.json 已更新（${changes.length} 条）`);
  }

  /* ---------- 复检：确认替换后的海报真的合格 ---------- */
  let verified = [];
  if (!DRY_RUN && changes.length) {
    const changedIds = new Set(changes.map((c) => c.id));
    const fixed = gallery.filter((g) => changedIds.has(g.id));
    const recheck = await runAudit(fixed, movies);
    verified = recheck.results;
    log(`▶ 复检 ${verified.length} 条：`);
    let bad = 0;
    for (const r of verified) {
      const mark = r.status === 'ok' ? '✓' : r.status === 'warn' ? '⚠' : '✗';
      log(`   ${mark} [${r.id}] ${r.zhTitle} ${r.status} ${r.dims}${r.issues.length ? ' — ' + r.issues.map((i) => i.code).join(', ') : ''}`);
      if (r.status === 'error') bad++;
    }
    if (bad) log(`   ⚠ 仍有 ${bad} 条未通过复检，可再次执行 npm run poster:fix`);
  }

  /* ---------- 落盘修复日志 ---------- */
  ensureDir(OUTPUT_DIR);
  const logPath = path.join(OUTPUT_DIR, 'poster-fix-log.json');
  const payload = {
    at: new Date().toISOString(),
    dryRun: DRY_RUN,
    targetCount: targets.length,
    fixedCount: changes.length,
    failureCount: failures.length,
    changes,
    failures,
    recheck: verified.map((r) => ({ id: r.id, status: r.status, dims: r.dims, issues: r.issues.map((i) => i.code) })),
  };
  fs.writeFileSync(logPath, JSON.stringify(payload, null, 2), 'utf8');

  log('');
  log('─'.repeat(72));
  log(`修复完成：成功 ${changes.length} / 目标 ${targets.length}${failures.length ? `，失败 ${failures.length}` : ''}`);
  log(`日志：output/poster-fix-log.json`);
  log('');

  return failures.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('海报纠错异常：', e);
    process.exit(2);
  });
