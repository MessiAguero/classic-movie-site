/**
 * 海报自动纠错公共库
 *
 * 候选来源（按可信度排序）：
 *   1. TMDB 官方 API（配置 TMDB_API_KEY 时启用，质量最好、最准确）
 *   2. 维基百科条目信息框里的海报原图（免密钥）
 *   3. DuckDuckGo 图片搜索（优先 TMDB / Wikimedia 图源，严格校验）
 *
 * 每个候选都必须通过 validateCandidate() 的严格体检，才会被用来替换，
 * 避免「修一个错图、换上一个更错的图」。
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  POSTERS_DIR,
  THRESHOLDS,
  UA,
  classifyHost,
  identityScore,
  loadAliases,
  normTitle,
  parseImageMeta,
  sleep,
} from './poster-audit.mjs';

/* ------------------------------------------------------------------ */
/* 候选校验：比自检更严格的准入门槛                                    */
/* ------------------------------------------------------------------ */
export const CANDIDATE_RULES = {
  minWidth: 350,
  preferWidth: 500,
  minBytes: 15 * 1024,
  minRatio: 1.2,
  maxRatio: 2.2,
};

/** 提取 TMDB 图片地址中的文件标识，便于去重比较 */
function tmdbKey(url) {
  const m = String(url).match(/\/t\/p\/(?:original|w\d+(?:_and_h\d+)?(?:_face|_bestv2)?)\/([A-Za-z0-9]+\.(?:jpe?g|png|webp))/);
  return m ? m[1] : null;
}

/**
 * 归一化图片地址：
 * - 把 TMDB 的缩略图（w130_and_h195_face 之类）升级为 original 原图
 * - 去掉 utm_* 之类的跟踪参数
 * 搜索引擎经常只给缩略图地址，这一步能显著提升拿到高清海报的概率。
 */
export function normalizeImageUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return u;
  const tmdb = u.match(/^https?:\/\/(?:image\.tmdb\.org|media\.themoviedb\.org|www\.themoviedb\.org)\/t\/p\/[^/]+\/([A-Za-z0-9]+\.(?:jpe?g|png|webp))/i);
  if (tmdb) u = `https://image.tmdb.org/t/p/original/${tmdb[1]}`;
  return u.replace(/[?&]utm_[^&]*/g, '').replace(/\?$/, '').replace(/&$/, '');
}

/**
 * 清理片名里附带的上映信息，避免把整串元信息当成搜索词。
 * 例："Nameless Gangster · Rules of the Time · 2012 · 133 min" → "Nameless Gangster · Rules of the Time"
 *     "I Saw the Devil / 2010 / dir. Kim Jee-woon"           → "I Saw the Devil"
 *     "WALL·E" / "让子弹飞"                                    → 原样保留
 */
export function cleanSearchTitle(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:19|20)\d{2}\s*[·|/]\s*/, ''); // 开头的年份
  t = t.replace(/\s*[·|/]\s*(?:19|20)\d{2}\b.*$/, '');
  t = t.replace(/\s*[·|/]\s*\d+\s*(?:min|mins|分钟)\b.*$/i, '');
  t = t.replace(/\s*[·|/]\s*dir\.?.*$/i, '');
  t = t.split('·')[0].trim(); // 只取主标题，丢掉「 · 别名」尾巴
  return t.trim();
}

/** 年份优先取片名串里的年份（更可靠），否则用结构化字段 */
function movieYear(movie) {
  const fromTitle = String(movie?.enTitle || '').match(/(?:19|20)\d{2}/)?.[0];
  const own = String(movie?.year || '').match(/(?:19|20)\d{2}/)?.[0];
  return fromTitle || own || '';
}

/** 供检索使用的干净片名集合 */
function searchNames(movie) {
  const aliases = loadAliases().get(movie?.id) || [];
  // 站内 enTitle 常为空/脏数据，用可信别名（英文名）兜底，才能搜到国际版海报
  const aliasEn = aliases.find((a) => /^[\x20-\x7e]+$/.test(a) && a.length >= 3 && !/^\d/.test(a)) || '';
  const ownRaw = cleanSearchTitle(movie?.enTitle);
  // enTitle 可能是「电影推荐」这类中文脏数据，也可能被清洗成「2013」这样的裸年份；
  // 只有包含真正单词的 ASCII 片名才适合当英文检索词
  const ownEn = /^[\x20-\x7e]+$/.test(ownRaw) && /[A-Za-z]{3,}/.test(ownRaw) ? ownRaw : '';
  return {
    zh: cleanSearchTitle(movie?.zhTitle).replace(/\s+/g, ''),
    en: ownEn || aliasEn,
    year: movieYear(movie),
    aliases,
  };
}

/** 把候选整理成 identityScore() 需要的形状 */
function candForMatch(cand) {
  return {
    title: cand.title,
    identityText: cand.identityText,
    imageUrl: cand.url,
    remoteUrl: cand.url,
  };
}

/** 候选综合打分：优先官方图源 + 高分辨率 + 片名匹配 */
export function scoreCandidate(cand, movie) {
  const { tier } = classifyHost(cand.url);
  let s = 0;
  if (cand.authoritative) s += 100; // TMDB API 直接按 id 返回
  else if (tier === 'tmdb') s += 85;
  else if (tier === 'wikimedia') s += 60;
  else if (tier === 'official') s += 50;
  else if (tier === 'aggregator') s += 5;
  else s += 20;

  const idc = identityScore(candForMatch(cand), movie, loadAliases());
  // 命中片名远重要于命中
  s += idc.kind === 'name' ? 60 : idc.kind === 'year' ? 6 : 0;

  if (cand.width && cand.height) {
    const ratio = cand.height / cand.width;
    s += Math.min(cand.width / 100, 20); // 分辨率加分（封顶 20）
    s -= Math.abs(ratio - 1.5) * 25; // 越接近 2:3 越好
    if (cand.width < CANDIDATE_RULES.minWidth) s -= 40;
  }
  if (/poster|海报/i.test(cand.title || '')) s += 6;

  return Math.round(s);
}

/**
 * 严格校验一个候选：必须能下载、是图片、竖版、够大、且与片名对得上。
 * @returns {{ok:boolean, reason?:string, bytes?:Buffer, meta?:object, width?:number, height?:number}}
 */
export async function validateCandidate(cand, movie, { timeoutMs = 25000 } = {}) {
  if (!cand?.url) return { ok: false, reason: '候选没有图片地址' };

  let res;
  try {
    res = await fetch(cand.url, {
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, reason: `下载失败: ${e?.message || e}` };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

  const bytes = Buffer.from(await res.arrayBuffer());
  const meta = parseImageMeta(bytes);
  if (!meta || !meta.width || !meta.height) return { ok: false, reason: '不是有效图片' };

  const { width: w, height: h } = meta;
  if (w < CANDIDATE_RULES.minWidth) return { ok: false, reason: `宽度不足 ${w}px` };
  if (bytes.length < CANDIDATE_RULES.minBytes) return { ok: false, reason: `体积过小 ${(bytes.length / 1024).toFixed(1)}KB` };

  const ratio = h / w;
  if (ratio < CANDIDATE_RULES.minRatio) return { ok: false, reason: `不是竖版海报（${w}×${h}）` };
  if (ratio > CANDIDATE_RULES.maxRatio) return { ok: false, reason: `比例异常（${w}×${h}）` };

  // 权威来源（TMDB API 按 id 查询）豁免片名校验；其余候选必须有「片名」证据
  if (!cand.authoritative) {
    const aliases = loadAliases();
    const idc = identityScore(candForMatch(cand), movie, aliases);
    const hasAliases = (aliases.get(movie?.id) || []).length > 0;
    if (hasAliases ? idc.kind !== 'name' : idc.kind === 'none') {
      return {
        ok: false,
        reason: hasAliases ? '来源只有年份线索、对不上片名' : '来源与片名无从对应',
      };
    }
  }
  if (/剧照|backdrop|\bstill\b/i.test(cand.title || '') && ratio < THRESHOLDS.minPortraitRatio) {
    return { ok: false, reason: '来源是剧照而非海报' };
  }

  return { ok: true, bytes, meta, width: w, height: h };
}

/* ------------------------------------------------------------------ */
/* 候选来源 1：TMDB 官方 API（需 TMDB_API_KEY）                        */
/* ------------------------------------------------------------------ */
async function tmdbCandidates(movie) {
  const apiKey = process.env.TMDB_API_KEY || process.env.TMDB_READ_TOKEN;
  if (!apiKey) return [];

  const isToken = apiKey.length > 60; // v4 read token 用 Bearer，v3 key 用查询参数
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (isToken) headers.Authorization = `Bearer ${apiKey}`;

  const { zh, en, year } = searchNames(movie);
  const queries = [en, zh].filter(Boolean);
  const out = [];

  for (const q of queries) {
    const params = new URLSearchParams({ query: q, include_adult: 'false' });
    if (year) params.set('year', year);
    if (!isToken) params.set('api_key', apiKey);
    let json;
    try {
      const r = await fetch(`https://api.themoviedb.org/3/search/movie?${params}`, { headers, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      json = await r.json();
    } catch {
      continue;
    }
    for (const m of (json.results || []).slice(0, 3)) {
      if (!m.poster_path) continue;
      out.push({
        url: `https://image.tmdb.org/t/p/original${m.poster_path}`,
        title: `${m.title || m.original_title} (${(m.release_date || '').slice(0, 4)})`,
        source: 'tmdb-api',
        authoritative: true,
        tmdbId: m.id,
      });
    }
    if (out.length) break;
    await sleep(200);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 候选来源 2：维基百科信息框海报（免密钥）                            */
/* ------------------------------------------------------------------ */
async function wikiQuery(lang, params) {
  const url = `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ ...params, format: 'json' })}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function wikiPoster(lang, query) {
  const search = await wikiQuery(lang, { action: 'query', list: 'search', srsearch: query, srlimit: '3' });
  const hit = (search.query?.search || [])[0]?.title;
  if (!hit) return null;

  const page = await wikiQuery(lang, { action: 'query', titles: hit, prop: 'revisions', rvprop: 'content', rvslots: 'main' });
  const wt = Object.values(page.query?.pages || {})[0]?.revisions?.[0]?.slots?.main?.['*'] || '';
  const m = wt.match(/\|\s*image\s*=\s*([^\n|]+)/i);
  if (!m) return null;

  const file = 'File:' + m[1].trim().replace(/^\[\[|\]\]$/g, '').split('|')[0];
  const info = await wikiQuery(lang, { action: 'query', titles: file, prop: 'imageinfo', iiprop: 'url|size' });
  const ii = Object.values(info.query?.pages || {})[0]?.imageinfo?.[0];
  if (!ii?.url) return null;
  return { url: ii.url, title: `${hit} — Wikipedia`, source: `wiki-${lang}`, width: ii.width, height: ii.height };
}

async function wikiCandidates(movie) {
  const out = [];
  const { zh, en, year } = searchNames(movie);
  const plans = [
    en && ['en', `${en} ${year} film`],
    zh && ['zh', `${zh} ${year} 电影`],
    zh && ['zh', `${zh} 电影`],
  ].filter(Boolean);

  for (const [lang, q] of plans) {
    try {
      const c = await wikiPoster(lang, q);
      if (c) out.push(c);
    } catch {
      /* 忽略单个来源失败 */
    }
    await sleep(200);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 候选来源 3：Bing 图片搜索（免密钥，稳定，覆盖面广）                 */
/* ------------------------------------------------------------------ */
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
    // Bing 把每条结果塞进 <a ... m="{json}">，json 里 murl=原图地址、t=来源标题
    for (const m of html.matchAll(/<a[^>]*m="([^"]+)"/g)) {
      try {
        const j = JSON.parse(decodeEntities(m[1]));
        if (j.murl)
          out.push({
            url: j.murl,
            title: j.t || '',
            // 来源页地址也纳入片名核对（很多站点把片名写在 slug 里）
            identityText: [j.t || '', j.purl || ''].join(' '),
            width: j.mw ? +j.mw : undefined,
            height: j.mh ? +j.mh : undefined,
            source: 'bing',
          });
      } catch {
        /* 跳过坏的条目 */
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function bingCandidates(movie) {
  const { zh, en, year, aliases } = searchNames(movie);
  const queries = [
    en && `${en} ${year} movie poster tmdb`,
    en && `${en} ${year} movie poster`,
    zh && `${zh} ${year} 电影海报`,
    // 别名（英文/原文名）单独再搜一轮，中文站内名常与海报上的名字不一致
    ...aliases.slice(0, 2).map((a) => `${a} ${year} movie poster`),
  ].filter(Boolean);

  const out = [];
  for (const q of queries) {
    out.push(...(await bingSearch(q)));
    await sleep(300);
    if (out.filter((c) => c.width >= CANDIDATE_RULES.preferWidth).length >= 8) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 候选来源 4：DuckDuckGo 图片搜索（免密钥，作为补充）                 */
/* ------------------------------------------------------------------ */
async function getVqd(query) {
  try {
    const r = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    const html = await r.text();
    return html.match(/vqd=['"]?([\d-]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

async function ddgSearch(query) {
  const vqd = await getVqd(query);
  if (!vqd) return [];
  try {
    const r = await fetch(
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}`,
      { headers: { 'User-Agent': UA, Referer: 'https://duckduckgo.com/' }, signal: AbortSignal.timeout(20000) },
    );
    if (!r.ok) return [];
    const json = await r.json();
    return (json.results || []).map((x) => ({
      url: x.image || '',
      title: x.title || '',
      width: x.width,
      height: x.height,
      source: 'ddg',
    }));
  } catch {
    return [];
  }
}

async function ddgCandidates(movie) {
  const { zh, en, year, aliases } = searchNames(movie);

  const queries = [
    en && `${en} ${year} movie poster tmdb`,
    zh && `${zh} ${year} 电影海报`,
    ...aliases.slice(0, 1).map((a) => `${a} ${year} movie poster`),
  ].filter(Boolean);

  const out = [];
  for (const q of queries) {
    const items = await ddgSearch(q);
    out.push(...items);
    await sleep(600);
    if (out.filter((c) => c.width >= CANDIDATE_RULES.preferWidth).length >= 8) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/** 去重（同一张 TMDB 图会有多种尺寸前缀）并按综合分排序 */
function dedupeAndRank(list, movie) {
  const seen = new Set();
  const out = [];
  for (const raw0 of list) {
    const raw = normalizeImageUrl(raw0.url);
    if (!/^https?:/i.test(raw)) continue;
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(raw)) continue;
    const key = tmdbKey(raw) || raw.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    // TMDB 原图升级后无法预知真实尺寸，给一个合理预期值参与打分，最终仍由下载校验决定
    const upgraded = /image\.tmdb\.org\/t\/p\/original\//.test(raw) && (!raw0.width || raw0.width < 500);
    const cand = { ...raw0, url: raw, width: upgraded ? 1000 : raw0.width, height: upgraded ? 1500 : raw0.height };
    out.push({ ...cand, score: scoreCandidate(cand, movie) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * 为一部电影找到可用的替换海报，返回通过严格校验的最佳候选。
 * 按「可信度从高到低」逐层尝试，某一层找到合格海报就立刻收工，
 * 既保证质量，也避免无谓地反复请求搜索引擎（触发限流）。
 *
 * @returns {{cand:object, bytes:Buffer, meta:object}|null}
 */
export async function findReplacement(movie, { log = () => {} } = {}) {
  const stages = [
    ['TMDB API', tmdbCandidates],
    ['Bing 图片', bingCandidates],
    ['维基百科', wikiCandidates],
    ['DuckDuckGo', ddgCandidates],
  ];

  for (const [name, fetchStage] of stages) {
    let cands = [];
    try {
      cands = await fetchStage(movie);
    } catch {
      cands = [];
    }
    const ranked = dedupeAndRank(cands, movie);
    if (!ranked.length) {
      log(`· ${name}：没有候选`);
      continue;
    }
    log(`· ${name}：候选 ${ranked.length} 个，逐一严格校验…`);

    for (const cand of ranked.slice(0, 8)) {
      const v = await validateCandidate(cand, movie);
      if (v.ok) return { cand, bytes: v.bytes, meta: v.meta };
      log(`    ✗ ${v.reason} — ${String(cand.url).slice(0, 72)}`);
      await sleep(80);
    }
  }
  return null;
}

/**
 * 把新海报写入本地 public/posters/，并返回图库应记录的相对路径。
 * 同一部电影只保留一份文件：写入成功后清理旧扩展名的残留。
 */
export function savePoster(id, bytes, meta) {
  fs.mkdirSync(POSTERS_DIR, { recursive: true });
  const ext = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' }[meta.type] || 'jpg';
  const rel = `posters/${id}.${ext}`;
  const abs = path.join(POSTERS_DIR, `${id}.${ext}`);
  fs.writeFileSync(abs, bytes);

  // 清理同一 id 下其它扩展名的旧文件（仅在成功写入后执行）
  for (const other of ['jpg', 'jpeg', 'png', 'webp']) {
    if (other === ext) continue;
    const p = path.join(POSTERS_DIR, `${id}.${other}`);
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* 忽略 */
      }
    }
  }
  return rel;
}

export { normTitle };
