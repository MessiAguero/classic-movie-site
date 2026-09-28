/**
 * 海报自检公共库
 * - 纯 Node 实现（无第三方依赖）读取 JPEG/PNG/WebP/GIF 尺寸
 * - 统一的图源可信度分级、海报合规规则、图库读写
 *
 * 被 tools/check-posters.mjs（自检）与 tools/fix-posters.mjs（自动纠错）共用。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const MOVIES_PATH = path.join(ROOT, 'src', 'data', 'movies.json');
export const GALLERY_PATH = path.join(ROOT, 'src', 'data', 'gallery.json');
export const POSTERS_DIR = path.join(ROOT, 'public', 'posters');
export const OUTPUT_DIR = path.join(ROOT, 'output');

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** 远程海报取回失败时的重试次数（区分「网络抖动」与「真的坏了」） */
export const REMOTE_RETRIES = 2;

/* ------------------------------------------------------------------ */
/* 阈值：集中定义，便于日后调整                                        */
/* ------------------------------------------------------------------ */
export const THRESHOLDS = {
  /** 宽高比 h/w：低于此值视为横版剧照/剧照（海报应为竖版） */
  minPortraitRatio: 1.2,
  /** 宽高比 h/w：高于此值视为异常瘦长 */
  maxPortraitRatio: 2.2,
  /** 最小可接受宽度（像素） */
  minWidth: 300,
  /** 最小可接受高度（像素） */
  minHeight: 400,
  /** 低于此宽度给出「清晰度偏低」提示 */
  warnWidth: 500,
  /** 最小文件体积（字节），过小基本是缩略图 */
  minBytes: 8 * 1024,
};

/* ------------------------------------------------------------------ */
/* 图源可信度                                                          */
/* ------------------------------------------------------------------ */
const HOST_TIERS = [
  { tier: 'tmdb', re: /(^|\.)image\.tmdb\.org$|(^|\.)media\.themoviedb\.org$|(^|\.)themoviedb\.org$/ },
  { tier: 'wikimedia', re: /(^|\.)upload\.wikimedia\.org$|(^|\.)wikipedia\.org$/ },
  { tier: 'official', re: /(^|\.)media-amazon\.com$|(^|\.)m\.media-amazon\.com$|(^|\.)imdb\.com$/ },
  { tier: 'aggregator', re: /goldposter|fanart|movieposter|posterazzi|impawards|brightspotcdn|pinimg|huaban|cinema\.com\.cn/ },
];

/** 返回图源等级：tmdb / wikimedia / official / aggregator / unknown */
export function classifyHost(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { host: '', tier: 'unknown' };
  }
  for (const t of HOST_TIERS) if (t.re.test(host)) return { host, tier: t.tier };
  return { host, tier: 'unknown' };
}

/** 可信图源（用于自动纠错时的优先与准入） */
export const TRUSTED_TIERS = new Set(['tmdb', 'wikimedia', 'official']);

/* ------------------------------------------------------------------ */
/* 图片元信息解析（纯 Node）                                           */
/* ------------------------------------------------------------------ */

/** 从字节流解析图片类型与尺寸，失败返回 null */
export function parseImageMeta(buf) {
  if (!buf || buf.length < 16) return null;
  try {
    if (buf[0] === 0xff && buf[1] === 0xd8) return jpegSize(buf);
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return pngSize(buf);
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return webpSize(buf);
    if (buf.toString('ascii', 0, 3) === 'GIF') return gifSize(buf);
  } catch {
    return null;
  }
  return null;
}

function jpegSize(buf) {
  let off = 2;
  while (off + 3 < buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = buf[off + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    // SOF0..SOF15（排除 DHT=C4 / JPG=C8 / DAC=CC）
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      return { type: 'jpeg', height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

function pngSize(buf) {
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function webpSize(buf) {
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    const w = buf.readUIntLE(24, 3) + 1;
    const h = buf.readUIntLE(27, 3) + 1;
    return { type: 'webp', width: w, height: h };
  }
  if (fourcc === 'VP8 ') {
    return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { type: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function gifSize(buf) {
  return { type: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/* ------------------------------------------------------------------ */
/* 文本 / 片名工具                                                     */
/* ------------------------------------------------------------------ */

/** 归一化片名：去空白、去标点、转小写 */
export function normTitle(s) {
  return (s || '')
    .replace(/[\s·・:：\-—–_/\\()（）[\]【】「」『』“”"'’,，。.!！?？]/g, '')
    .toLowerCase();
}

/** 提取片名中的拉丁词（长度 >= 4），用于匹配海报来源标题 */
function latinWords(s) {
  return ((s || '').toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || []).filter((w) => w.length >= 4);
}

/** 同一部电影的判定键：中文名 + 年份（无中文名时退回英文名） */
export function movieIdentity(movie) {
  const zh = normTitle(movie?.zhTitle);
  const year = movie?.year || '';
  if (zh) return `${zh}@${year}`;
  return `${normTitle(movie?.enTitle)}@${year}`;
}

/**
 * 判断海报来源是否「对得上」这部电影。
 * 依次在 来源标题 + 图片 URL + 文件名 里寻找 中文片名 / 英文片名 / 可信别名 / 年份。
 *
 * 返回 kind：
 *   'name' —— 命中了片名（可信）
 *   'year' —— 只命中年份（不可信：同一年的电影、榜单页、年份区间都会误命中）
 *   'none' —— 毫无线索
 */
export function identityScore(entry, movie, aliases) {
  const hay = [entry.title, entry.identityText, entry.remoteUrl, entry.imageUrl, entry.sourceTitle]
    .filter(Boolean)
    .join(' ');
  // 两侧都必须用同一套归一化规则：片名里常有全角/半角冒号等标点，
  // 只去掉空格会导致「终结者2：审判日」匹配不上自己的海报标题。
  const flat = normTitle(hay);
  const hits = [];

  const zh = normTitle(movie?.zhTitle);
  if (zh.length >= 2 && flat.includes(zh)) hits.push('片名中文');

  const enFull = normTitle(movie?.enTitle);
  if (enFull.length >= 5 && flat.includes(enFull)) hits.push('片名英文');
  else {
    const words = latinWords(movie?.enTitle);
    const hit = words.find((w) => flat.includes(w));
    if (hit) hits.push(`英文关键词:${hit}`);
  }

  // 可信别名（英文/日文/韩文…）——补上站内 enTitle 为空或脏数据的情况
  const aliasList = aliases?.get?.(movie?.id) || aliases?.get?.(entry.id) || [];
  for (const a of aliasList) {
    const na = normTitle(a);
    if (na.length >= 3 && flat.includes(na)) {
      hits.push(`别名:${a}`);
      break;
    }
  }

  // 年份可能带脏字符（如 "· 2003"），这里只取其中的四位年份
  const year = String(movie?.year || '').match(/(?:19|20)\d{2}/)?.[0];
  if (year && hay.includes(year)) hits.push('年份');

  const nameHit = hits.some((h) => h.startsWith('片名') || h.startsWith('别名') || h.startsWith('英文关键词'));
  const kind = nameHit ? 'name' : hits.length ? 'year' : 'none';
  return { score: hits.length, hits, kind, yearHit: !!year && hay.includes(year), aliases: aliasList };
}

/** 判断记录是否为「自托管本地文件」，并根据其原始出处给出图源等级 */
export function originOf(entry) {
  const local = !/^https?:/i.test(entry.imageUrl || '');
  if (local) {
    // 本地自托管：以 remoteUrl 记录的真实出处为准
    if (entry.remoteUrl) return { ...classifyHost(entry.remoteUrl), url: entry.remoteUrl, selfHosted: true };
    return { host: '', tier: 'local', url: '', selfHosted: true };
  }
  return { ...classifyHost(entry.imageUrl), url: entry.imageUrl, selfHosted: false };
}

/* ------------------------------------------------------------------ */
/* 数据读写                                                            */
/* ------------------------------------------------------------------ */
export function loadGallery() {
  return JSON.parse(fs.readFileSync(GALLERY_PATH, 'utf8'));
}

export function saveGallery(list) {
  fs.writeFileSync(GALLERY_PATH, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

export function loadMovies() {
  return JSON.parse(fs.readFileSync(MOVIES_PATH, 'utf8'));
}

/**
 * 可信片名别名表（英文/日文/韩文…）。
 * 来源优先级：gallery 内联 aliases > poster-aliases.json 的 manual > auto。
 * 用来把身份校验从「只对年份」升级为「必须对得上片名」。
 */
let aliasCache = null;
export function loadAliases({ fresh = false } = {}) {
  if (aliasCache && !fresh) return aliasCache;
  const map = new Map();
  const add = (id, list) => {
    if (!id || !list) return;
    const cur = map.get(id) || [];
    for (const a of list) if (a && !cur.includes(a)) cur.push(a);
    map.set(id, cur);
  };
  try {
    const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'poster-aliases.json'), 'utf8'));
    for (const [id, v] of Object.entries(store.auto || {})) add(id, v?.aliases);
    for (const [id, v] of Object.entries(store.manual || {})) add(id, v);
  } catch {
    /* 没有别名表也能工作 */
  }
  // gallery 记录里可以内联指定，方便个别条目临时放行
  try {
    for (const e of JSON.parse(fs.readFileSync(GALLERY_PATH, 'utf8'))) {
      if (Array.isArray(e.aliases)) add(e.id, e.aliases);
    }
  } catch {
    /* 忽略 */
  }
  aliasCache = map;
  return map;
}

export function movieIndex(movies) {
  return new Map(movies.map((m) => [m.id, m]));
}

/* ------------------------------------------------------------------ */
/* 抓取                                                                */
/* ------------------------------------------------------------------ */

/**
 * 读取一份海报的字节内容：本地文件直接读，远程地址走网络。
 * 永远不抛异常，失败以 {ok:false,error} 形式返回。
 */
export async function readPoster(entry, { timeoutMs = 20000, root = ROOT } = {}) {
  const url = entry.imageUrl || '';
  if (!url) return { ok: false, error: 'imageUrl 为空', source: 'none' };

  if (!/^https?:/i.test(url)) {
    const abs = path.join(root, 'public', url.replace(/^\/+/, ''));
    if (!fs.existsSync(abs)) return { ok: false, error: `本地文件不存在: public/${url}`, source: 'local' };
    const buf = fs.readFileSync(abs);
    return { ok: true, source: 'local', bytes: buf, absPath: abs, meta: parseImageMeta(buf) };
  }

  // 网络抖动很常见：重试几次再判定为「无法访问」，避免误报触发无谓的替换
  let lastError = '';
  for (let attempt = 0; attempt <= REMOTE_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        return {
          ok: true,
          source: 'remote',
          bytes,
          contentType: res.headers.get('content-type') || '',
          meta: parseImageMeta(bytes),
        };
      }
      lastError = `HTTP ${res.status}`;
      // 4xx（除 429）不必重试
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      lastError = `请求失败: ${e?.message || e}`;
    }
    if (attempt < REMOTE_RETRIES) await sleep(400 * (attempt + 1));
  }
  return { ok: false, error: lastError, source: 'remote' };
}

/* ------------------------------------------------------------------ */
/* 规则引擎                                                            */
/* ------------------------------------------------------------------ */

const issue = (code, severity, detail) => ({ code, severity, detail });

/**
 * 对单条图库记录做体检。
 * @param entry gallery.json 中的一条
 * @param movie 对应的 movies.json 记录（可能为 undefined）
 * @param fetched readPoster() 的结果
 * @param ctx { hashes: Map<hash, entryId[]>, identityById: Map }
 */
export function auditEntry(entry, movie, fetched, ctx) {
  const issues = [];
  // 自托管海报用 remoteUrl 判断出处；纯本地且无出处记录的按 local 处理（不算问题）
  const { host, tier } = originOf(entry);

  if (!entry.imageUrl) {
    issues.push(issue('missing_url', 'error', '记录没有 imageUrl'));
    return { issues, host, tier, meta: null };
  }

  if (!fetched.ok) {
    issues.push(issue(entry.imageUrl.startsWith('http') ? 'unreachable' : 'missing_file', 'error', fetched.error));
    return { issues, host, tier, meta: null };
  }

  const meta = fetched.meta;
  if (!meta) {
    issues.push(issue('not_image', 'error', `无法识别为图片（${fetched.bytes.length} 字节，可能是 HTML/占位内容）`));
    return { issues, host, tier, meta: null };
  }
  if (!meta.width || !meta.height) {
    issues.push(issue('decode_failed', 'error', '读取不到图片尺寸'));
    return { issues, host, tier, meta };
  }

  const { width: w, height: h } = meta;
  const ratio = +(h / w).toFixed(3);

  if (fetched.bytes.length < THRESHOLDS.minBytes) {
    issues.push(issue('too_small_bytes', 'error', `文件仅 ${(fetched.bytes.length / 1024).toFixed(1)}KB，可能是缩略图`));
  }
  if (w < THRESHOLDS.minWidth || h < THRESHOLDS.minHeight) {
    issues.push(issue('low_resolution', 'error', `分辨率过低 ${w}×${h}`));
  } else if (w < THRESHOLDS.warnWidth) {
    issues.push(issue('low_resolution', 'warn', `清晰度偏低 ${w}×${h}`));
  }
  if (ratio < THRESHOLDS.minPortraitRatio) {
    issues.push(issue('landscape', 'error', `横版图（${w}×${h}，h/w=${ratio}）被当作海报，应为竖版`));
  } else if (ratio > THRESHOLDS.maxPortraitRatio) {
    issues.push(issue('odd_ratio', 'warn', `宽高比异常 ${w}×${h}（h/w=${ratio}）`));
  }

  // 本地文件扩展名与真实格式不符
  if (fetched.source === 'local' && entry.imageUrl) {
    const ext = path.extname(entry.imageUrl).slice(1).toLowerCase();
    const want = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' }[meta.type];
    const exts = ext === 'jpeg' ? 'jpg' : ext;
    if (want && exts && exts !== want) {
      issues.push(issue('ext_mismatch', 'warn', `扩展名 .${ext} 与实际格式 ${meta.type} 不一致`));
    }
  }

  // 图源可信度
  if (tier === 'aggregator') {
    issues.push(issue('aggregator_host', 'warn', `图源为聚合站（${host}），建议换用官方图源`));
  } else if (tier === 'unknown') {
    issues.push(issue('untrusted_host', 'warn', `图源不在可信白名单（${host || '未知'}）`));
  }

  // 片名一致性：来源必须能对上「片名」，光对上年份不算数
  // （同一年的其它电影、榜单页标题、年份区间 "1999-2001" 都会误命中年份）
  const idc = identityScore(entry, movie, ctx?.aliases);
  if (idc.kind === 'none') {
    issues.push(
      issue('no_identity_signal', 'error', `海报来源与《${movie?.zhTitle || entry.zhTitle}》无任何匹配线索（来源：${entry.title || host}）`),
    );
  } else if (idc.kind === 'year') {
    issues.push(
      issue(
        'identity_unverified',
        'error',
        `只对得上${idc.hits.join('、')}，没有任何片名证据，疑似配错图（来源：${entry.title || host}）`,
      ),
    );
  }

  // 正在播放「剧照」却被当作海报
  if (/剧照|backdrop|still|scene/i.test(entry.title || '') && ratio < THRESHOLDS.minPortraitRatio) {
    issues.push(issue('source_is_still', 'error', '来源自述为剧照/Backdrop，非海报'));
  }

  // 跨电影共用同一张图
  if (ctx?.hashes && fetched.bytes) {
    const key = `${ctx.hashOf(fetched.bytes)}`;
    const others = (ctx.hashes.get(key) || []).filter((o) => o.id !== entry.id);
    const myIdentity = ctx.identityById.get(entry.id);
    const conflict = others.filter((o) => ctx.identityById.get(o.id) !== myIdentity);
    if (conflict.length) {
      issues.push(issue('duplicate_image', 'error', `与其他电影共用同一张图：${conflict.map((o) => o.zhTitle).join('、')}`));
    }
  }

  return { issues, host, tier, meta };
}

export function severityOf(issues) {
  if (issues.some((i) => i.severity === 'error')) return 'error';
  if (issues.some((i) => i.severity === 'warn')) return 'warn';
  return 'ok';
}

/* ------------------------------------------------------------------ */
/* 杂项                                                                */
/* ------------------------------------------------------------------ */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function shortUrl(u, n = 70) {
  const s = String(u || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

/** 简单并发池：按顺序保序执行，限制同时在跑的任务数 */
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ------------------------------------------------------------------ */
/* 全量巡检                                                            */
/* ------------------------------------------------------------------ */

/**
 * 巡检整个图库，返回每条记录的状态、问题清单与原始抓取结果。
 * check-posters.mjs 与 fix-posters.mjs 共用这一份实现。
 *
 * @returns {{results:Array, errorCount:number, warnCount:number, okCount:number, byId:Map, fetched:Array}}
 */
export async function runAudit(gallery, movies, { concurrency = 6, timeoutMs = 20000 } = {}) {
  const byId = movieIndex(movies);
  const aliases = loadAliases();
  const fetched = await mapPool(gallery, concurrency, (entry) => readPoster(entry, { timeoutMs }));

  // 先算内容哈希，才能识别「两部电影共用同一张图」
  const hashes = new Map();
  const identityById = new Map();
  gallery.forEach((entry, i) => {
    const movie = byId.get(entry.id);
    identityById.set(entry.id, movie ? movieIdentity(movie) : `raw:${entry.id}`);
    const f = fetched[i];
    if (f?.ok && f.bytes) {
      const key = md5(f.bytes);
      if (!hashes.has(key)) hashes.set(key, []);
      hashes.get(key).push({ id: entry.id, zhTitle: entry.zhTitle });
    }
  });

  const ctx = { hashes, identityById, hashOf: md5, aliases };
  const results = gallery.map((entry, i) => {
    const movie = byId.get(entry.id);
    const f = fetched[i];
    const { issues, host, tier, meta } = auditEntry(entry, movie, f, ctx);
    const idc = identityScore(entry, movie, aliases);
    return {
      id: entry.id,
      zhTitle: entry.zhTitle,
      year: String(entry.year || movie?.year || '').match(/(?:19|20)\d{2}/)?.[0] || entry.year || '',
      source: /^https?:/i.test(entry.imageUrl || '') ? '远程' : '本地',
      imageUrl: entry.imageUrl,
      host,
      tier,
      size: f?.ok ? `${(f.bytes.length / 1024).toFixed(0)}KB` : '-',
      dims: meta ? `${meta.width}×${meta.height}` : '-',
      ratio: meta && meta.width ? +(meta.height / meta.width).toFixed(2) : null,
      identityKind: idc.kind,
      identityHits: idc.hits,
      status: severityOf(issues),
      issues,
    };
  });

  return {
    results,
    byId,
    fetched,
    errorCount: results.filter((r) => r.status === 'error').length,
    warnCount: results.filter((r) => r.status === 'warn').length,
    okCount: results.filter((r) => r.status === 'ok').length,
  };
}

/**
 * 该条目是否值得自动修复。
 * 硬错误一律修复；警告里只修复确实影响观感的几类，
 * 「非白名单图源」单独出现时不折腾（很多官方站也拿不到更好图）。
 */
export function isRepairable(result) {
  if (result.status === 'error') return true;
  const REPAIRABLE_WARN = new Set(['low_resolution', 'aggregator_host', 'ext_mismatch', 'source_is_still', 'odd_ratio']);
  return result.issues.some((i) => i.severity === 'warn' && REPAIRABLE_WARN.has(i.code));
}
