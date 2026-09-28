#!/usr/bin/env node
/**
 * 海报自检 —— 每天检查全站海报是否有错误
 *
 * 检查项：
 *   1. 本地文件是否存在 / 远程地址是否可访问
 *   2. 是否真的是图片（魔数校验）、能否读出尺寸
 *   3. 体积是否过小（缩略图）、分辨率是否够用
 *   4. 是否竖版（横版剧照/Backdrop 被当成海报 → 报警）
 *   5. 图源可信度（TMDB / Wikimedia 白名单）
 *   6. 来源与片名是否对得上（防止「张冠李戴」的错误海报）
 *   7. 是否有两部不同电影共用同一张图
 *   8. 本地文件扩展名与实际格式是否一致
 *
 * 产物：
 *   output/poster-audit.json     机器可读的完整报告
 *   output/poster-audit.md       人可读的巡检报告
 *   output/poster-audit-history.jsonl  每次巡检追加一行（趋势）
 *
 * 用法：
 *   node tools/check-posters.mjs            # 巡检（有错误时退出码 1）
 *   node tools/check-posters.mjs --json     # 只输出 JSON 到 stdout
 *   node tools/check-posters.mjs --quiet    # 只输出结论行
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  OUTPUT_DIR,
  THRESHOLDS,
  ensureDir,
  loadGallery,
  loadMovies,
  runAudit,
  shortUrl,
} from './lib/poster-audit.mjs';

const argv = process.argv.slice(2);
const JSON_ONLY = argv.includes('--json');
const QUIET = argv.includes('--quiet');

async function main() {
  const gallery = loadGallery();
  const movies = loadMovies();

  const { results, errorCount, warnCount, okCount } = await runAudit(gallery, movies);

  const errors = results.filter((r) => r.status === 'error');

  const report = {
    generatedAt: new Date().toISOString(),
    thresholds: THRESHOLDS,
    total: results.length,
    ok: okCount,
    warn: warnCount,
    error: errorCount,
    entries: results,
  };

  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'poster-audit.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'poster-audit.md'), renderMarkdown(report), 'utf8');
  fs.appendFileSync(
    path.join(OUTPUT_DIR, 'poster-audit-history.jsonl'),
    JSON.stringify({
      at: report.generatedAt,
      total: report.total,
      ok: report.ok,
      warn: report.warn,
      error: report.error,
      errorIds: errors.map((e) => e.id),
    }) + '\n',
    'utf8',
  );

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else if (QUIET) {
    console.log(`海报自检：${report.total} 张 · 正常 ${report.ok} · 警告 ${report.warn} · 错误 ${report.error}`);
  } else {
    printConsole(report);
  }

  // 有错误 → 退出码 1，方便 shell / CI / launchd 感知并触发纠错
  process.exit(errors.length ? 1 : 0);
}

function codeLabel(code) {
  return (
    {
      missing_url: '缺少地址',
      missing_file: '文件缺失',
      unreachable: '无法访问',
      not_image: '非图片',
      decode_failed: '无法解码',
      too_small_bytes: '体积过小',
      low_resolution: '分辨率偏低',
      landscape: '横版图',
      odd_ratio: '比例异常',
      ext_mismatch: '扩展名不符',
      aggregator_host: '聚合站图源',
      untrusted_host: '非白名单图源',
      no_identity_signal: '片名不匹配',
      identity_unverified: '无法核实（仅年份）',
      source_is_still: '误用剧照',
      duplicate_image: '跨片重复',
    }[code] || code
  );
}

function printConsole(report) {
  const line = '─'.repeat(72);
  console.log(`\n海报自检 · ${report.generatedAt}`);
  console.log(`${line}`);
  console.log(`总共 ${report.total} 张 → 正常 ${report.ok} · 警告 ${report.warn} · 错误 ${report.error}`);
  console.log(`${line}`);

  const bad = report.entries.filter((e) => e.status !== 'ok');
  if (!bad.length) {
    console.log('✅ 全部海报通过检查');
    console.log(`${line}`);
    return;
  }

  for (const e of bad) {
    const flag = e.status === 'error' ? '❌' : '⚠️ ';
    console.log(`${flag} [${e.id}] ${e.zhTitle} ${e.year} · ${e.source} · ${e.dims} · ${shortUrl(e.imageUrl)}`);
    for (const i of e.issues) {
      console.log(`      - ${codeLabel(i.code)}：${i.detail}`);
    }
  }
  console.log(`${line}`);
  console.log(`报告已写入 output/poster-audit.json 与 output/poster-audit.md`);
  if (report.error) console.log(`修复命令：npm run poster:fix`);
  console.log('');
}

function renderMarkdown(report) {
  const L = [];
  L.push('# 海报自检报告');
  L.push('');
  L.push(`生成时间：${report.generatedAt}`);
  L.push('');
  L.push(`| 项目 | 数量 |`);
  L.push(`| --- | --- |`);
  L.push(`| 海报总数 | ${report.total} |`);
  L.push(`| 正常 | ${report.ok} |`);
  L.push(`| 警告 | ${report.warn} |`);
  L.push(`| 错误 | ${report.error} |`);
  L.push('');

  const bad = report.entries.filter((e) => e.status !== 'ok');
  if (!bad.length) {
    L.push('✅ 全部海报通过检查。');
    L.push('');
    return L.join('\n');
  }

  L.push('## 需要处理的条目');
  L.push('');
  L.push('| 状态 | 日期 ID | 片名 | 年份 | 尺寸 | 图源 | 问题 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const e of bad) {
    const problems = e.issues.map((i) => `${codeLabel(i.code)}（${i.detail}）`).join('<br>');
    L.push(
      `| ${e.status === 'error' ? '❌ 错误' : '⚠️ 警告'} | \`${e.id}\` | ${e.zhTitle} | ${e.year} | ${e.dims} | ${e.host || '-'} | ${problems} |`,
    );
  }
  L.push('');
  L.push('## 检查标准');
  L.push('');
  L.push(`- 竖版要求：宽高比 h/w ≥ ${report.thresholds.minPortraitRatio}`);
  L.push(`- 最小分辨率：${report.thresholds.minWidth}×${report.thresholds.minHeight}`);
  L.push(`- 最小体积：${(report.thresholds.minBytes / 1024).toFixed(0)}KB`);
  L.push('');
  return L.join('\n');
}

main().catch((e) => {
  console.error('海报自检异常：', e);
  process.exit(2);
});
