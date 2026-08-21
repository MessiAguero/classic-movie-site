#!/usr/bin/env node
/**
 * 通过 DuckDuckGo 图片搜索抓取每部电影的经典图片（海报）
 * 输出：src/data/gallery.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOVIES_FILE = path.join(__dirname, '..', 'src', 'data', 'movies.json');
const OUT_FILE = path.join(__dirname, '..', 'src', 'data', 'gallery.json');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getVqd(query) {
  const url = 'https://duckduckgo.com/?q=' + encodeURIComponent(query) + '&iax=images&ia=images';
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await r.text();
  const m = html.match(/vqd=['"]?([\d-]+)/);
  return m ? m[1] : null;
}

async function imageSearch(query) {
  const vqd = await getVqd(query);
  if (!vqd) return [];
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

async function findImage(movie) {
  const queries = [
    `${movie.zhTitle} ${movie.year || ''} 电影 海报`,
    movie.enTitle ? `${movie.enTitle} ${movie.year || ''} movie poster` : '',
  ].filter(Boolean);

  let best = [];
  for (const q of queries) {
    try {
      const items = await imageSearch(q);
      if (items.length > best.length) best = items;
    } catch {
      /* 继续 */
    }
    await sleep(350);
  }
  if (!best.length) return null;
  best.sort((a, b) => score(b, movie) - score(a, movie));
  return best[0];
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
  const img = await findImage(m);
  if (img) {
    results.push({
      id: m.id,
      zhTitle: m.zhTitle,
      enTitle: m.enTitle || '',
      year: m.year || '',
      imageUrl: img.image,
      title: img.title,
    });
    ok++;
    console.log('✓');
  } else {
    console.log('✗');
  }
}

fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), 'utf8');
console.log(`\n完成：${ok}/${movies.length} 部电影获得图片 → ${OUT_FILE}`);
