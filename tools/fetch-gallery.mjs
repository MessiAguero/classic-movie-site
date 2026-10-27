#!/usr/bin/env node
/**
 * 通过 DuckDuckGo 图片搜索抓取每部电影的经典图片（海报）
 * 输出：src/data/gallery.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UA, parseImageMeta, THRESHOLDS } from './lib/poster-audit.mjs';
import { savePoster } from './lib/poster-repair.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOVIES_FILE = path.join(__dirname, '..', 'src', 'data', 'movies.json');
const OUT_FILE = path.join(__dirname, '..', 'src', 'data', 'gallery.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getVqd(query) {
  try {
    const url = 'https://duckduckgo.com/?q=' + encodeURIComponent(query) + '&iax=images&ia=images';
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    const html = await r.text();
    const m = html.match(/vqd=['"]?([\d-]+)/);
    return m ? m[1] : null;
  } catch (e) {
    console.warn('  搜索受限，跳过本次查询:', e instanceof Error ? e.message : e);
    return null;
  }
}

async function imageSearch(query) {
  const vqd = await getVqd(query);
  if (!vqd) return [];
  try {
    const url =
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=` + encodeURIComponent(query) + `&vqd=` + vqd;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results || [])
      .map((x) => ({ title: x.title || '', image: x.image || '', width: x.width, height: x.height }))
      .filter(
        (x) =>
          x.image &&
          /\.(jpe?g|png|webp)(\?|$)/i.test(x.image) &&
          !/\.(svg|gif)/i.test(x.image) &&
          x.image.startsWith('http'),
      );
  } catch (e) {
    console.warn('  图片搜索失败，跳过:', e instanceof Error ? e.message : e);
    return [];
  }
}

/** 给结果打分：TMDB CDN 海报最优，标题含片名加分 */
function score(item, movie) {
  let s = 0;
  if (/image\.tmdb\.org\/t\/p/.test(item.image)) s += 100;
  if (/wikipedia|wikimedia/.test(item.image)) s += 60;
  const title = item.title.toLowerCase();
  const zh = (movie.zhTitle || '').toLowerCase();
  const en = (movie.enTitle || '').toLowerCase().split(' ').filter((w) => w.length > 3);
  if (zh && title.includes(zh)) s += 40;
  if (en.some((w) => title.includes(w))) s += 30;
  if (/poster/i.test(title) || /海报/.test(title)) s += 10;
  return s;
}

async function findImages(movie) {
  const queries = [
    `${movie.zhTitle} ${movie.year || ''} 电影 海报`,
    movie.enTitle ? `${movie.enTitle} ${movie.year || ''} movie poster` : '',
  ].filter(Boolean);

  const byUrl = new Map();
  for (const q of queries) {
    try {
      const items = await imageSearch(q);
      for (const item of items) if (!byUrl.has(item.image)) byUrl.set(item.image, item);
    } catch {
      /* 继续 */
    }
    await sleep(350);
  }
  return [...byUrl.values()].sort((a, b) => score(b, movie) - score(a, movie));
}

async function downloadImage(movie, item) {
  let response;
  try {
    response = await fetch(item.image, {
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  const meta = parseImageMeta(bytes);
  if (!meta?.width || !meta?.height) return null;
  if (meta.width < THRESHOLDS.minWidth || meta.height < THRESHOLDS.minHeight) return null;
  if (bytes.length < THRESHOLDS.minBytes) return null;
  const ratio = meta.height / meta.width;
  if (ratio < THRESHOLDS.minPortraitRatio || ratio > THRESHOLDS.maxPortraitRatio) return null;
  return {
    imageUrl: savePoster(movie.id, bytes, meta),
    remoteUrl: item.image,
    width: meta.width,
    height: meta.height,
  };
}

const movies = JSON.parse(fs.readFileSync(MOVIES_FILE, 'utf8'));
const results = [];
let ok = 0;

// 增量模式：已存在于 gallery.json 的电影直接跳过，只抓新增
let existingIds = new Set();
try {
  existingIds = new Set(JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).map((x) => x.id));
} catch { /* 首次运行 */ }

for (const m of movies) {
  if (existingIds.has(m.id)) continue;
  process.stdout.write(`[${ok}/${movies.length}] ${m.zhTitle} … `);
  const candidates = await findImages(m);
  let img = null;
  let source = null;
  for (const candidate of candidates.slice(0, 12)) {
    const local = await downloadImage(m, candidate);
    if (local) {
      img = local;
      source = candidate;
      break;
    }
  }
  if (img && source) {
    results.push({
      id: m.id,
      zhTitle: m.zhTitle,
      enTitle: m.enTitle || '',
      year: m.year || '',
      imageUrl: img.imageUrl,
      remoteUrl: img.remoteUrl,
      title: source.title,
      hiRes: img.width >= 1000,
    });
    ok++;
    console.log('✓');
  } else {
    console.log('✗');
  }
}

// 合并写回：保留已有条目（含此前人工校正过的海报），仅新增/更新本次抓取的条目
let existing = [];
try {
  existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
} catch {
  /* 首次运行 */
}
const merged = new Map(existing.map((x) => [x.id, x]));
for (const item of results) merged.set(item.id, item);
const ordered = movies.map((m) => merged.get(m.id)).filter(Boolean);
fs.writeFileSync(OUT_FILE, JSON.stringify(ordered, null, 2), 'utf8');
console.log(`\n完成：本次新增/更新 ${ok} 部，图库共 ${ordered.length}/${movies.length} 部 → ${OUT_FILE}`);
