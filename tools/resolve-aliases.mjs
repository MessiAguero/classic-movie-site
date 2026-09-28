#!/usr/bin/env node
/**
 * 片名别名解析 —— 为每部电影补齐「英文 / 日文 / 韩文」等可信片名
 *
 * 为什么需要：
 *   站内 movies.json 的 enTitle 经常是空的或脏数据（如 "2014 · 111 min · Directed by 김성훈"）。
 *   没有可信片名，海报自检就退化成「只对年份」——而年份是最弱的证据：
 *   同一年的其它电影、榜单页 "Best-Rated Movies from 2013"、年份区间 "1999-2001"
 *   都会误命中年份，于是《朋友》被配上《创世纪》剧照这类错误就被放过去了。
 *
 * 做法（只用 Bing 图片搜索，快且稳定，不走维基避免限流）：
 *   1. 用「中文片名+年份 电影海报」「英文片名+年份 movie poster」检索；
 *   2. 从结果标题里抽出形如 `片名 (年份)` 的片段（来源须是影视站点）；
 *   3. 年份必须与本片一致，且片名不能是榜单/影评之类的通用短语；
 *   4. 取出现频次最高的若干个作为该片的可信别名。
 *
 * 产物：src/data/poster-aliases.json（auto 自动解析 + manual 人工维护，manual 不会被覆盖）
 *
 * 用法：
 *   node tools/resolve-aliases.mjs          # 只为「还无法验证」的电影解析（增量）
 *   node tools/resolve-aliases.mjs --all    # 全部重新解析
 *   node tools/resolve-aliases.mjs --force   # 忽略已有 auto 结果重跑
 */
import fs from 'node:fs';
import path from 'node:path';

import { GALLERY_PATH, ROOT, UA, loadMovies, sleep } from './lib/poster-audit.mjs';

const OUT_FILE = path.join(ROOT, 'src', 'data', 'poster-aliases.json');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const ALL = argv.includes('--all');

/** 只信任影视数据库/资料站的页面标题，避免抓到论坛、商城、榜单页 */
const TRUSTED_PAGE =
  /themoviedb\.org|imdb\.com|wikipedia\.org|wikidata\.org|letterboxd\.com|douban\.com|allocine\.fr|rottentomatoes\.com|filmaffinity\.com|kinopoisk\.ru|movie\.naver\.com|eiga\.com|filmarks\.com|maoyan\.com|mtime\.com|1905\.com|allcinema\.net|sansebastian|bfi\.org\.uk|criterion\.com|filmweb\.pl|mymovies\.it|sensacine\.com/i;

/** 明显不是片名的通用短语 */
const JUNK_NAME = /best|top|rated|list|review|ranking|movies?\s+from|collection|trailer|watch|stream|download|posters?\s+gallery|海报|剧照|豆瓣|评分|榜单|合集|在线|观看/i;

const decodeEntities = (s) =>
  String(s)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

async function bingSearch(query) {
  try {
    const r = await fetch(
      `https://www.bing.com/images/async?q=${encodeURIComponent(query)}&first=0&count=35&adlt=off&mmasync=1`,
      { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(20000) },
    );
    if (!r.ok) return [];
    const html = await r.text();
    const out = [];
    for (const m of html.matchAll(/<a[^>]*m="([^"]+)"/g)) {
      try {
        const j = JSON.parse(decodeEntities(m[1]));
        if (j.t) out.push({ title: j.t, purl: j.purl || '' });
      } catch {
        /* 跳过坏条目 */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 从一批搜索结果里统计「这部电影的片名」。
 * 只接受 `片名 (年份)` 且年份与本站一致、来源可信、片名不像通用短语的结果。
 */
function collectNames(results, year) {
  const tally = new Map();
  for (const r of results) {
    if (!TRUSTED_PAGE.test(r.purl)) continue;
    // 标题形如 "The Last Emperor (1987) — The Movie Database (TMDB)"
    const m = String(r.title).match(/^(.{1,90}?)\s*[（(]\s*((?:19|20)\d{2})\s*[)）]/);
    if (!m) continue;
    const name = m[1].replace(/\s+/g, ' ').trim();
    const y = m[2];
    if (year && y !== year) continue;
    if (name.length < 2 || name.length > 70) continue;
    if (JUNK_NAME.test(name)) continue;
    if (/\d{4}/.test(name)) continue;
    if (name.includes('—') || name.includes(' - ') || name.includes('|')) continue;
    tally.set(name, (tally.get(name) || 0) + 1);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

async function resolveOne(movie) {
  const zh = String(movie.zhTitle || '').split('·')[0].replace(/\s+/g, '').trim();
  const year = String(movie.year || '').match(/(?:19|20)\d{2}/)?.[0] || '';
  // enTitle 常是脏数据，只有在看起来像片名时才用作检索词
  const rawEn = String(movie.enTitle || '').trim();
  const en = rawEn.length >= 3 && /^[\x20-\x7e]+$/.test(rawEn) && !/\d{4}|min|Directed/i.test(rawEn) ? rawEn : '';

  const queries = [
    zh && `${zh} ${year} 电影海报`,
    zh && `${zh} 豆瓣 电影`,
    en && `${en} ${year} movie poster`,
  ].filter(Boolean);
  const results = [];
  for (const q of queries) {
    results.push(...(await bingSearch(q)));
    await sleep(300);
  }
  if (!results.length) return null;

  let names = collectNames(results, year);
  if (!names.length) names = collectNames(results, ''); // 年份字段本身有误时放宽一次
  if (!names.length) return null;

  // 中文片名本身也算可信别名
  const aliases = [zh, ...names.slice(0, 3)].filter(Boolean);
  return { aliases: [...new Set(aliases)], samples: names.slice(0, 3) };
}

async function main() {
  const movies = loadMovies();
  const gallery = JSON.parse(fs.readFileSync(GALLERY_PATH, 'utf8'));

  let store = { generatedAt: null, manual: {}, auto: {} };
  try {
    store = { ...store, ...JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) };
  } catch {
    /* 首次运行 */
  }
  store.manual = store.manual || {};
  store.auto = store.auto || {};

  const targets = ALL
    ? movies
    : movies.filter((m) => {
        if (FORCE) return true;
        if (store.auto[m.id] || (store.manual[m.id] || []).length) return false;
        // 只处理「enTitle 不可用」的电影，其余已能靠 enTitle 校验
        const rawEn = String(m.enTitle || '').trim();
        return !(rawEn.length >= 3 && /^[\x20-\x7e]+$/.test(rawEn) && !/\d{4}|min|Directed/i.test(rawEn));
      });

  console.log(`待解析 ${targets.length} 部（共 ${movies.length} 部，已有 auto ${Object.keys(store.auto).length} 条）`);

  let ok = 0;
  for (const movie of targets) {
    if (store.auto[movie.id] && !FORCE) continue;
    process.stdout.write(`  ${movie.id} ${movie.zhTitle} … `);
    try {
      const res = await resolveOne(movie);
      if (res) {
        store.auto[movie.id] = res;
        ok++;
        console.log(`✓ ${res.aliases.join(' / ')}`);
      } else {
        console.log('✗ 未获得一致的片名，可在 manual 里手工补充');
      }
    } catch (e) {
      console.log(`✗ ${e?.message || e}`);
    }
    await sleep(250);
  }

  store.generatedAt = new Date().toISOString();
  fs.writeFileSync(OUT_FILE, JSON.stringify(store, null, 2) + '\n', 'utf8');

  // 顺带报告：哪些条目仍然只能靠年份验证
  const stillWeak = gallery.filter((e) => !store.auto[e.id] && !(store.manual[e.id] || []).length).length;
  console.log(`\n完成：新增 ${ok} 条 → ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`仍有 ${stillWeak} 条记录没有可信别名（若被自检标记，可在 manual 中补充）`);
}

main().catch((e) => {
  console.error('别名解析异常：', e);
  process.exit(1);
});
