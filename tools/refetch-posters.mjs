#!/usr/bin/env node
/**
 * 重抓指定电影海报（片名匹配 + 图源可信度 + URL 可访问验证）
 * 用法：node tools/refetch-posters.mjs <id,id,...>  （不传则重抓所有非可信图源）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GALLERY = path.join(__dirname, '..', 'src', 'data', 'gallery.json');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase();

async function getVqd(q) {
  const r = await fetch('https://duckduckgo.com/?q=' + encodeURIComponent(q) + '&iax=images&ia=images', {
    headers: { 'User-Agent': UA },
  });
  const m = (await r.text()).match(/vqd=['"]?([\d-]+)/);
  return m ? m[1] : null;
}

async function imageSearch(q) {
  const vqd = await getVqd(q);
  if (!vqd) return [];
  const r = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}`,
    { headers: { 'User-Agent': UA } },
  );
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results || [])
    .map((x) => ({ title: x.title || '', image: x.image || '' }))
    .filter((x) => x.image && /\.(jpe?g|png|webp)(\?|$)/i.test(x.image) && x.image.startsWith('http'));
}

async function valid(url) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow' });
    return r.ok;
  } catch {
    return false;
  }
}

/** 打分：TMDB/维基优先，标题含片名加分 */
function score(item, movie) {
  const url = item.image.replace('/t/p/original/', '/t/p/w780/');
  const t = norm(item.title);
  const zh = norm(movie.zhTitle);
  const en = norm(movie.enTitle);
  let s = 0;
  if (/image\.tmdb\.org|themoviedb\.org/.test(url)) s += 80;
  if (/wikimedia|wikipedia/.test(url)) s += 60;
  if (zh.length >= 2 && t.includes(zh)) s += 40;
  if (en.length > 3 && t.includes(en)) s += 50;
  return s;
}

async function refetch(movie) {
  const queries = [
    `${movie.zhTitle} ${movie.year || ''} 电影海报`,
    movie.enTitle ? `${movie.enTitle} ${movie.year || ''} movie poster` : '',
    movie.enTitle ? `${movie.enTitle} movie poster tmdb` : '',
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
  best.sort((a, b) => score(b, movie) - score(a, movie));
  for (const item of best) {
    const url = item.image.replace('/t/p/original/', '/t/p/w780/');
    if (await valid(url)) {
      return { imageUrl: url, title: item.title, score: score(item, movie) };
    }
  }
  return null;
}

const ids = process.argv[2] ? process.argv[2].split(',').map((s) => s.trim()) : null;
const gallery = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));
const targets = ids
  ? gallery.filter((x) => ids.includes(x.id))
  : gallery.filter((x) => {
      const host = (() => {
        try {
          return new URL(x.imageUrl).hostname;
        } catch {
          return '';
        }
      })();
      return !/tmdb|wikimedia/.test(host);
    });

console.log(`待重抓：${targets.length} 部`);
let ok = 0;
for (const x of targets) {
  process.stdout.write(`${x.id} ${x.zhTitle} … `);
  const res = await refetch(x);
  if (res) {
    x.imageUrl = res.imageUrl;
    x.title = res.title;
    ok++;
    console.log(`✓ (score ${res.score}) ${res.imageUrl.slice(0, 80)}`);
  } else {
    console.log('✗ 保持原图');
  }
}
fs.writeFileSync(GALLERY, JSON.stringify(gallery, null, 2), 'utf8');
console.log(`\n完成：${ok}/${targets.length} 已更新`);
