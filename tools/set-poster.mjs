#!/usr/bin/env node
/**
 * 人工确认后替换海报
 *
 * 自检只能「发现」可疑海报，最终判定常常需要人眼。这个入口用来把
 * 核对过的正确海报装进去，并顺手登记，避免下次巡检又把同一张图报出来。
 *
 * 用法：
 *   node tools/set-poster.mjs 20261005 https://example.com/the-king.jpg --note "官方版海报"
 *   node tools/set-poster.mjs 20261005 ./Downloads/poster.jpg
 *   node tools/set-poster.mjs 20261005 --verify-only --note "人眼确认现用图无误"   # 只登记，不换图
 *   node tools/set-poster.mjs --review        # 列出当前待人工核对的条目
 *
 * 写入位置：
 *   public/posters/<id>.<ext>            本地自托管
 *   src/data/gallery.json                imageUrl / remoteUrl / hiRes
 *   src/data/poster-verified.json        记录 sha256，表示这张图已人工确认
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  GALLERY_PATH,
  OUTPUT_DIR,
  ROOT,
  UA,
  loadGallery,
  loadMovies,
  movieIndex,
  parseImageMeta,
  runAudit,
  saveGallery,
  VERIFIED_PATH,
} from './lib/poster-audit.mjs';
import { savePoster } from './lib/poster-repair.mjs';

const argv = process.argv.slice(2);

if (argv.includes('--review') || argv.length === 0) {
  const file = path.join(OUTPUT_DIR, 'poster-review.json');
  let review = null;
  try {
    review = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error('还没有核对清单，请先跑：npm run poster:check');
    process.exit(1);
  }
  console.log(`待人工核对 ${review.reviewCount} / ${review.total} 张：`);
  for (const e of review.entries) {
    const ev = e.evidence || {};
    console.log(`  ${e.id}  ${e.zhTitle}  [${ev.level || '-'}]`);
    if (ev.reasons?.length) console.log(`      证据：${ev.reasons.join('、')}`);
    if (ev.conflicts?.length) console.log(`      疑点：${ev.conflicts.join('；')}`);
    if (e.sourceTitle) console.log(`      来源：${String(e.sourceTitle).slice(0, 70)}`);
  }
  console.log('\n核对后用 node tools/set-poster.mjs <id> <图片地址> --note "说明" 替换');
  process.exit(0);
}

const [id, ...rest] = argv;
const noteIdx = rest.indexOf('--note');
const note = noteIdx >= 0 ? rest[noteIdx + 1] : '';
const VERIFY_ONLY = rest.includes('--verify-only');
const source = VERIFY_ONLY ? null : rest.find((a) => a && !a.startsWith('--') && a !== note);

if (!id || (!source && !VERIFY_ONLY)) {
  console.error('用法：node tools/set-poster.mjs <日期ID> <图片地址或本地路径> [--note "说明"]');
  process.exit(2);
}

const gallery = loadGallery();
const entry = gallery.find((g) => g.id === id);
if (!entry) {
  console.error(`gallery.json 里没有 ${id}`);
  process.exit(1);
}
const movies = loadMovies();
const movie = movieIndex(movies).get(id);

async function readBytes(src) {
  if (/^https?:/i.test(src)) {
    const res = await fetch(src, {
      headers: { 'User-Agent': UA, Referer: new URL(src).origin + '/' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(src);
}

// --verify-only：不改图，只把「现用这张已由人核对」记入登记表
if (VERIFY_ONLY) {
  const local = /^https?:/i.test(entry.imageUrl || '')
    ? await readBytes(entry.imageUrl)
    : fs.readFileSync(path.join(ROOT, 'public', entry.imageUrl));
  const store = fs.existsSync(VERIFIED_PATH)
    ? JSON.parse(fs.readFileSync(VERIFIED_PATH, 'utf8'))
    : { note: '人工/智能体核对通过的海报；按 sha256 记录，图片一变就重新判定。', entries: {} };
  store.entries = store.entries || {};
  store.entries[id] = {
    sha256: crypto.createHash('sha256').update(local).digest('hex'),
    note: note || '人工核对通过',
    at: new Date().toISOString(),
    source: 'existing',
  };
  fs.writeFileSync(VERIFIED_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
  console.log(`已登记 ${id} 《${movie?.zhTitle || entry.zhTitle}》（未改图）`);
  const audit0 = await runAudit(loadGallery(), movies);
  const r0 = audit0.results.find((r) => r.id === id);
  console.log(`复检：${r0?.status}${r0?.issues.length ? ' — ' + r0.issues.map((i) => i.code).join(', ') : ''}`);
  process.exit(0);
}

const bytes = await readBytes(source);
const meta = parseImageMeta(bytes);
if (!meta?.width || !meta?.height) {
  console.error('这不是可识别的图片');
  process.exit(1);
}
if (meta.width < 320 || meta.height < 400) {
  console.error(`分辨率过低：${meta.width}×${meta.height}`);
  process.exit(1);
}
if (meta.height / meta.width < 1.15) {
  console.error(`不是竖版海报：${meta.width}×${meta.height}`);
  process.exit(1);
}

// 同一张图不要重复装：先看是不是当前那张
const before = fs.existsSync(path.join(ROOT, 'public', entry.imageUrl))
  ? crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'public', entry.imageUrl))).digest('hex')
  : null;
const hash = crypto.createHash('md5').update(bytes).digest('hex');
if (before && before === hash) {
  console.log('这张图和现用海报完全相同，无需替换');
  process.exit(0);
}

const rel = savePoster(id, bytes, meta);
entry.remoteUrl = /^https?:/i.test(source) ? source : entry.remoteUrl;
entry.imageUrl = rel;
entry.hiRes = meta.width >= 1000;
if (note) entry.sourceNote = note;
saveGallery(gallery);

// 登记：这张图已由人核对过，内容没变就不再报「证据不足」
const store = fs.existsSync(VERIFIED_PATH)
  ? JSON.parse(fs.readFileSync(VERIFIED_PATH, 'utf8'))
  : { note: '人工/智能体核对通过的海报；按 sha256 记录，图片一变就重新判定。', entries: {} };
store.entries = store.entries || {};
store.entries[id] = {
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  note: note || '人工核对通过',
  at: new Date().toISOString(),
  source: /^https?:/i.test(source) ? source : 'local-file',
};
fs.writeFileSync(VERIFIED_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');

console.log(`已替换 ${id} 《${movie?.zhTitle || entry.zhTitle}》→ ${rel}（${meta.width}×${meta.height}）`);
console.log(`已登记到 ${path.relative(ROOT, VERIFIED_PATH)}`);

const audit = await runAudit(loadGallery(), movies);
const result = audit.results.find((r) => r.id === id);
console.log(`复检：${result?.status} ${result?.dims}${result?.issues.length ? ' — ' + result.issues.map((i) => i.code).join(', ') : ''}`);
