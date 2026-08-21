#!/usr/bin/env node
/**
 * 解析历史电影推荐 HTML → 结构化 JSON
 * 兼容三代版式：通过“板块标题定位 + 候选类名回退”提取字段。
 *
 * 用法：node tools/parse-html.mjs <html目录> <输出json>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_SRC = path.join(__dirname, '..', 'source-html');
const WORKBUDDY_SRC = '/Users/admin/WorkBuddy/automation-20260423112820';
const SRC_DIR =
  process.argv[2] ||
  (fs.existsSync(REPO_SRC) && fs.readdirSync(REPO_SRC).some((f) => f.endsWith('.html'))
    ? REPO_SRC
    : WORKBUDDY_SRC);
const OUT_FILE = process.argv[3] || path.join(__dirname, '..', 'src', 'data', 'movies.json');

/* ---------- 工具 ---------- */
const txt = ($, el) => {
  if (!el || !el.length) return '';
  return (el.text() || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
};

const strip = (s) => (s || '').replace(/^[「『“”"'\s:：·\-—–]+|[」』“”"'\s:：·\-—–]+$/g, '').trim();

const firstNum = (s) => {
  const m = (s || '').match(/(19|20)\d{2}/);
  return m ? m[0] : '';
};

/* ---------- 候选选择器（按优先级） ---------- */
const SEL = {
  zhTitle: ['.hero-title-cn', '.hero-title-zh', '.hero-cn-title', '.hero-cn', '.hero-title', '.hero-title-sub', '.hero-main-title', 'h1'],
  enTitle: ['.hero-title-en', '.hero-en-title', '.hero-en', '.hero-title .en', '.hero-title-en-sub', '.hero__title-en', '.hero-subtitle', '.hero .en', '.hero__en', '.hero-en-sub'],
  year: ['.hero-year', '.hero-year-badge', '.hero-number', '.hero__year', '.hero .year', '.year-badge'],
  tagline: ['.hero-tagline', '.hero-tagline-origin', '.hero-tag', '.hero-quote', '.hero-sub', '.hero-subtitle', '.hero__tagline', '.hero .tag', '.hero-sub-item', '.hero-sub'],
  meta: ['.hero-meta', '.hero-credits', '.hero-meta-item', '.hero-meta-value', '.hero-director', '.hero .meta'],

  ratingCard: ['.rate-card', '.rating-card', '.score-card', '.rating-item', '.rate-item', '.rating', '.rate', '.score-item', '.rating-badge', '.rating-item'],
  ratingSource: ['.rating-source', '.rating-platform', '.rate-src', '.rating-label', '.rating-card-source', '.score-card__source', '.rating-card-label', '.lbl', '.lab', '.src', '.r-name', '.source', '.label', '.score-source', '.score-label', '.score-platform'],
  ratingValue: ['.rating-value', '.rating-score', '.rating-number', '.rating-num', '.rate-val', '.rate-num', '.score-card__number', '.rating-card-score', '.score-number', '.score-num', '.num', '.score-value', '.score', '.number', '.r-val'],
  ratingSub: ['.rating-desc', '.rating-sub', '.rate-note', '.rating-count', '.score-card__label', '.rating-note', '.rate-note', '.sub', '.score-val', '.score-sub'],

  plotContainer: ['.plot', '.plot-content', '.plot-card', '.plot-wrap', '.story-content', '.story-text', '.story-wrap', '.synopsis-card', '.synopsis-section', '.syn-grid', '.synopsis', '.syn', '.synopsis-grid', '.section-body'],
  plotP: ['.plot p', '.plot-text', '.plot-text p', '.plot-content p', '.plot-card p', '.story-text p', '.story-content p', '.synopsis-card p', '.synopsis-section p', '.section-body p', '.synopsis p', '.syn p', '.synopsis-grid p', '.synopsis-text'],
  spoiler: ['.nospoiler', '.story-no-spoiler', '.no-spoiler', '.nos-spoiler', '.synopsis-note', '.badge'],

  highlightCard: ['.card', '.hl-card', '.highlight-card', '.highlight-item', '.card-item', '.highlight', '.hl'],
  highlightIcon: ['.ic', '.highlight-icon', '.highlight-num', '.highlight-number', '.hl-ic', '.hl-no', '.highlight-num'],
  highlightTitle: ['h3', '.highlight-title', '.highlight-card__title', '.highlight-text', '.highlight-title'],
  highlightBody: ['p', '.highlight-desc', '.highlight-body', '.highlight-card__desc', '.highlight-text', '.highlight-desc'],

  whyCard: ['.why-item', '.why-card', '.why .item', '.why-list > *', '.why > .item', '.reason-item', '.reasons .reason-item', '.reasons-list .reason-item'],
  whyNum: ['.why-num', '.why-number', '.why-no', '.why-ic', '.why-icon', '.no', '.reason-icon'],
  whyTitle: ['h4', 'h3', '.why-title', '.why-content-title', '.why-text', '.why-card__title', '.why-desc-title'],
  whyBody: ['p', '.why-desc', '.why-content-text', '.why-text', '.why-card__desc', '.why-body'],

  honor: ['.honor', '.tag-pill', '.honor-tag', '.honor-wrap span', '.honors-wrap span', '.honors span', '.honors-cloud span', '.honors-grid span', '.award-tag', '.award-tag span', '.honor-grid span', '.honors-tags span', '.honors-list span', '.award-badge', '.award-text', '.honor.hot', '.honor.gold', '.honor.major', '.honor.key', '.honor.top'],

  archiveRow: ['.archive tr', '.archive-table tr', '.info-table tr', '.arch tr', '.film-table tr', '.filminfo-table tr', '.facts-table tr', '.details-table tr', '.card-table tr', '.archive-row', '.arc-row', '.archive .row', '.archive-item', '.card-row', '.archive-grid .archive-item', '.archive-grid > div', '.info-row', '.info-item', '.info-grid > .info-item', '.info-cell', '.info-grid .info-cell', '.filminfo-row', '.fact-row', '.fact-item', '.film-facts .fact-item', '.archive-item__label'],
  archiveK: ['.k', '.archive-key', '.archive-item__label', '.card-key', '.archive-item label', '.info-key', '.info-label', '.info-cell-key', '.filminfo-key', '.fact-key', '.fact-label'],
  archiveV: ['.v', '.archive-value', '.archive-item__value', '.card-val', '.info-value', '.info-cell-val', '.filminfo-value', '.fact-value'],

  quoteText: ['.quote-text', '.quote-line', '.quote-content', '.quote-card', '.quote-band', '.quote-box', '.quote-inner', '.blockquote-inner', '.quote-block .quote-text', '.en-quote'],
  quoteWho: ['.who', '.quote-who', '.quote-by', '.quote-source', '.quote-attr', '.quote-author', '.quote-attribution', '.quote-block__attr', '.quote-speaker', '.quote-attribution', '.quote-context', '.quote-film', '.quote-source'],
  quoteBlock: ['.quote-block', '.quote-section', '.quote', '.quote-sec', '.quotes-inner', '.quote-inner', '.quote-card', '.quotes-section', '.quote-band', '.blockquote', '.quote-box', '.quote-content', '.quote-line', '.quote-block'],

  reviewP: ['.review p', '.review-content', '.editorial-quote', '.editor-section p', '.closing-section p', '.final-section p', '.final-quote', '.editor-card p', '.editor-review', '.editor-quote', '.review-section p', '.editorial-rating', '.closing-section', '.final-section', '.verdict p'],
  reviewBy: ['.review .by', '.review-by', '.review-author', '.editor-section .by', '.review .who', '.final-section .by', '.by', '.verdict .by'],
  reviewStars: ['.review .stars', '.review-stars', '.editor-rating', '.star-rating', '.editorial-rating', '.verdict .stars'],

  posterCap: ['.poster .cap', '.poster-cap', '.poster-caption', '.poster-card .cap', '.poster-card__caption', '.poster-cap', '.poster__cap', '.poster-card__caption'],
  posterSvg: ['.poster svg', '.poster-card svg', '.poster-frame svg', '.poster-art svg', '.poster-visual svg', '.poster-svg svg', '.poster-svg-wrap svg', '.plot-poster svg', '.story-svg-card svg', '.poster-inner svg', '.poster-wrap svg', '.poster-container svg', '.poster-artwork svg', '.poster-section svg', '.hero-poster svg', '.poster-svg', '.svg-poster', '.poster-visual', '.poster-art'],
};

/* ---------- 板块上下文定位 ---------- */
function sectionOf($, heading) {
  return heading.parents('section, .section, .sec, .wrap').first();
}

// 找到包含目标元素的祖先：优先 section 类，否则逐级向上
function findScope($, heading, selList) {
  const sec = sectionOf($, heading);
  let scope = sec.length ? sec : heading.parent();
  if (scope.find(selList.join(',')).length) return scope;
  let up = heading.parent();
  for (let i = 0; i < 6 && up.length; i++) {
    if (up.find(selList.join(',')).length) return up;
    up = up.parent();
  }
  return scope;
}

function headingTexts($) {
  return $('h1, h2, h3, .section-title, .sec-head, .section-header, .section-label, .section-subtitle, .sec-title')
    .map((_, el) => ({
      el,
      text: txt($, $(el)).toLowerCase(),
    }))
    .get();
}

function findSection(headings, pattern) {
  for (const h of headings) {
    if (pattern.test(h.text)) return h.el;
  }
  return null;
}

function firstText($, selList, ctx) {
  const root = ctx ? $(ctx) : $('body');
  for (const s of selList) {
    const el = root.find(s).first();
    const t = txt($, el);
    if (t) return t;
  }
  return '';
}

/* ---------- 评分 ---------- */
function parseRatings($) {
  const seen = new Set();
  const out = [];
  for (const s of SEL.ratingCard) {
    $($(s).get()).each((_, el) => {
      const $el = $(el);
      const src = txt($, $el.find(SEL.ratingSource.join(',')).first());
      const $val = $el.find(SEL.ratingValue.join(',')).first();
      let val = txt($, $val);
      if (!val) val = txt($, $el.find('.rating-label span').last());
      // 优先读取动画起始值 data-to（页面里数字从 0 滚动到目标值）
      const dataTo = $val.attr('data-to')
        || $val.find('[data-to]').first().attr('data-to')
        || $val.attr('data-target')
        || $val.find('[data-target]').first().attr('data-target')
        || $val.attr('data-count')
        || $val.find('[data-count]').first().attr('data-count')
        || $el.attr('data-score')
        || $el.find('[data-score]').first().attr('data-score');
      if (dataTo) val = dataTo;
      const sub = txt($, $el.find(SEL.ratingSub.join(',')).first());
      if (!src || !val || seen.has(src)) return;
      seen.add(src);
      out.push({ source: src, value: val.replace(/\/10$/, '').replace(/^0$/, ''), sub });
    });
    if (out.length >= 4) break;
  }
  return out;
}

/* ---------- 剧情 ---------- */
function parsePlot($, headings) {
  const h = findSection(headings, /剧情|故事|梗概|情节|plot|story|synopsis|剧情介绍/);
  let paras = [];
  let spoiler = '';
  if (h) {
    const scope = findScope($, $(h), [...SEL.plotP, ...SEL.spoiler]);
    for (const s of SEL.plotP) {
      scope.find(s).each((_, el) => {
        const t = txt($, $(el));
        if (t && t.length > 12) paras.push(t);
      });
      if (paras.length) break;
    }
    spoiler = txt($, scope.find(SEL.spoiler.join(',')).first());
    if (spoiler) {
      paras = paras.filter((p) => p !== spoiler);
    }
  }
  // 兜底：全局找 plot 类段落
  if (!paras.length) {
    for (const s of SEL.plotP) {
      $(s).each((_, el) => {
        const t = txt($, $(el));
        if (t && t.length > 12) paras.push(t);
      });
      if (paras.length) break;
    }
  }
  return { plot: paras.slice(0, 8), spoilerNote: spoiler };
}

/* ---------- 亮点 / 为什么 ---------- */
function parseCardGrid($, headings, kind) {
  const pattern = kind === 'highlights'
    ? /亮点|看点|维度|highlight|six|六处|六个|杰作/
    : /为什么值得|值得一看|值得看|理由|worth watching|why watch|不看会后悔|worth your time|值得被看|为什么这部|无法被超越/;
  const h = findSection(headings, pattern);
  const out = [];
  if (!h) return out;
  const scope = findScope($, $(h), kind === 'highlights' ? SEL.highlightCard : SEL.whyCard);
  const cards = kind === 'highlights'
    ? scope.find(SEL.highlightCard.join(',')).filter((_, el) => {
        const $el = $(el);
        return !$el.closest('.why-item, .why-card').length && $el.text().trim().length > 20;
      })
    : scope.find(SEL.whyCard.join(',')).filter((_, el) => $(el).text().trim().length > 20);

  cards.each((_, el) => {
    const $el = $(el);
    if (kind === 'highlights') {
      const ic = txt($, $el.find(SEL.highlightIcon.join(',')).first());
      const title = txt($, $el.find(SEL.highlightTitle.join(',')).first());
      const body = txt($, $el.find(SEL.highlightBody.join(',')).first());
      if (title || body) out.push({ ic: strip(ic), title: strip(title), body: strip(body) });
    } else {
      const no = txt($, $el.find(SEL.whyNum.join(',')).first());
      const title = txt($, $el.find(SEL.whyTitle.join(',')).first());
      const body = txt($, $el.find(SEL.whyBody.join(',')).first());
      if (title || body) out.push({ no: strip(no), title: strip(title), body: strip(body) });
    }
  });
  // 早期版式："为什么值得一看" 是散文段落，没有卡片结构 → 整段收录
  if (!out.length && kind === 'why') {
    scope.find('.section-body p, .why-body p, .why p, .why-text p, .why-content p').each((_, el) => {
      const t = txt($, $(el));
      if (t && t.length > 20) out.push({ no: '', title: '', body: t });
    });
  }
  return out.slice(0, 6);
}

/* ---------- 荣誉 ---------- */
function parseHonors($, headings) {
  const h = findSection(headings, /荣誉|勋章|地位|成就|奖项|award|honor|荣耀/);
  const out = [];
  const collect = (scope) => {
    for (const s of SEL.honor) {
      scope.find(s).each((_, el) => {
        const t = strip(txt($, $(el)));
        if (t && t.length >= 4 && t.length <= 60 && !out.includes(t)) out.push(t);
      });
    }
  };
  if (h) {
    const sec = sectionOf($, $(h));
    collect(sec.length ? sec : $(h).parent());
  } else {
    collect($('body'));
  }
  return out.slice(0, 14);
}

/* ---------- 档案 ---------- */
function parseArchive($, headings) {
  const h = findSection(headings, /档案|信息|资料|详情|档案|archive|info|filminfo|facts|dossier|关于这部电影/);
  const rows = [];
  const seenKeys = new Set();
  const push = (k, v) => {
    k = strip(k).replace(/[：:]\s*$/, '');
    v = strip(v);
    if (!k || !v || seenKeys.has(k)) return;
    seenKeys.add(k);
    rows.push({ k, v });
  };

  if (h) {
    const scope = findScope($, $(h), SEL.archiveRow);
    // 表格行
    for (const s of SEL.archiveRow.filter((x) => x.endsWith(' tr'))) {
      scope.find(s).each((_, el) => {
        const cells = $(el).find('td, th');
        if (cells.length >= 2) push(txt($, cells.eq(0)), txt($, cells.eq(1)));
      });
    }
    // key/value 对
    scope.find(SEL.archiveRow.join(',')).each((_, el) => {
      const $el = $(el);
      if ($el.find('td').length) return;
      const kEl = $el.find(SEL.archiveK.join(',')).first();
      const vEl = $el.find(SEL.archiveV.join(',')).last();
      const k = txt($, kEl) || txt($, $el.children().first());
      const v = txt($, vEl) || txt($, $el.children().last());
      if (k && v && k !== v) push(k, v);
    });
  }
  return rows.slice(0, 16);
}

/* ---------- 台词 ---------- */
function parseQuotes($) {
  const out = [];
  const seen = new Set();
  const add = (text, who) => {
    text = strip(text);
    if (!text || text.length < 4 || seen.has(text)) return;
    seen.add(text);
    out.push({ text, who: strip(who) });
  };

  // 从 quote 容器中提取
  const containers = $('body').find(SEL.quoteBlock.join(',')).toArray();
  for (const c of containers) {
    const $c = $(c);
    // 容器直接含文本（如 <blockquote>）
    const direct = $c.clone();
    direct.find(SEL.quoteWho.join(',')).remove();
    const t = strip(txt($, direct));
    if (t && t.length >= 4 && !t.includes('·') && t.length < 400) {
      const who = txt($, $c.find(SEL.quoteWho.join(',')).first());
      add(t, who);
      continue;
    }
    $c.find(SEL.quoteText.join(',')).each((_, el) => {
      const t2 = txt($, $(el));
      const who = txt($, $c.find(SEL.quoteWho.join(',')).first());
      add(t2, who);
    });
  }
  // 兜底：独立的 quote-text
  if (!out.length) {
    $('body').find(SEL.quoteText.join(',')).each((_, el) => add(txt($, $(el)), ''));
  }
  // blockquote 兜底
  if (!out.length) {
    $('blockquote').each((_, el) => add(txt($, $(el)), txt($, $(el).parent().find('.who, .quote-by, .quote-source, .quote-attr').first())));
  }
  return out.slice(0, 4);
}

/* ---------- 评语 ---------- */
function parseReview($) {
  const h = findSection(headingTexts($), /评语|点评|editor|review|closing|final|结语|editorial|总评/);
  let text = '';
  let by = '';
  let stars = '';
  if (h) {
    const sec = sectionOf($, $(h));
    const scope = sec.length ? sec : $(h).parent();
    for (const s of SEL.reviewP) {
      const t = txt($, scope.find(s).first());
      if (t && t.length > 30) { text = t; break; }
    }
    if (!text) {
      text = txt($, scope);
      const head = txt($, $(h));
      text = text.replace(head, '').trim();
    }
    by = txt($, scope.find(SEL.reviewBy.join(',')).first());
    stars = txt($, scope.find(SEL.reviewStars.join(',')).first());
  }
  // 兜底：footer 之前的最后一段长文本
  if (!text) {
    const ps = $('body p').toArray().reverse();
    for (const p of ps) {
      const t = txt($, $(p));
      if (t.length > 60 && !t.includes('Generated with') && !t.includes('经典电影推荐')) {
        text = t;
        by = txt($, $(p).parent().find(SEL.reviewBy.join(',')).first());
        break;
      }
    }
  }
  const starCount = (stars.match(/★/g) || []).length;
  return { review: text, reviewBy: by, reviewStars: starCount || (text ? 5 : 0) };
}

/* ---------- Hero ---------- */
function parseHero($) {
  let zh = firstText($, SEL.zhTitle);
  let en = firstText($, SEL.enTitle);
  let year = firstNum(firstText($, SEL.year));
  const tagline = firstText($, SEL.tagline);
  const meta = firstText($, SEL.meta);

  // 中文标题：剔除内部英文/韩文子元素后再取文本
  if (!zh) {
    for (const s of SEL.zhTitle) {
      const $el = $(s).first();
      if (!$el.length) continue;
      const clone = $el.clone();
      clone.find('.en, .kr, .en-sub, .hero-title-en, .en-title, .kr-title').remove();
      const t = txt($, clone);
      if (t) { zh = t; break; }
    }
  }

  // 从 title 标签兜底
  if (!zh) {
    const t = txt($, $('title'));
    const cleaned = t.replace(/^经典电影推荐\s*[·|｜]\s*/, '').trim();
    const parts = cleaned.split(/\s*·\s*|\s*[|｜]\s*/);
    zh = parts[0] || cleaned;
    if (!en && parts[1]) en = parts[1];
  }
  // 年份兜底：title 标签或 hero meta 中的 4 位年份
  if (!year) {
    const t = txt($, $('title'));
    const m = t.match(/\((19|20)\d{2}\)/);
    if (m) year = m[1];
  }
  if (!year && meta) {
    year = firstNum(meta);
  }
  // 拆分 hero-title 里混入的 en / kr
  if (zh) {
    const zhClean = zh
      .replace(/[\p{Script=Latin}][\p{Script=Latin}0-9 .'’\-–&/]*/gu, ' ')
      .replace(/[\uAC00-\uD7AF]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (zhClean && zhClean.length >= 2) zh = zhClean;
  }
  return { zhTitle: zh, enTitle: en, year, tagline, meta };
}

/* ---------- 海报 ---------- */
function parsePoster($) {
  let svg = '';
  let caption = '';
  // 优先 poster 语义容器里的 svg
  for (const s of SEL.posterSvg) {
    const $el = $(s).first();
    if ($el.is('svg')) {
      const html = $.html($el);
      if (html.length > 400) { svg = html; break; }
    } else if ($el.length) {
      const inner = $el.find('svg').first();
      if (inner.length) {
        const html = $.html(inner);
        if (html.length > 400) { svg = html; break; }
      }
    }
  }
  if (!svg) {
    // 兜底：全页找最大的 svg
    let best = '';
    $('svg').each((_, el) => {
      const html = $.html(el);
      if (html.length > best.length) best = html;
    });
    if (best.length > 400) svg = best;
  }
  if (svg) {
    caption = firstText($, SEL.posterCap);
  }
  return { posterSvg: svg, posterCaption: caption };
}

/* ---------- 主流程 ---------- */
function parseFile(file) {
  const html = fs.readFileSync(file, 'utf8');
  const $ = cheerio.load(html);
  const base = path.basename(file, '.html').replace('movie-recommend-', '');
  // 归一化 id / date（兼容 2026-08-17 与 20260812-bttf 两种命名）
  const idMatch =
    base.match(/^(\d{4})-(\d{2})-(\d{2})(?:-([A-Za-z0-9]+))?$/) ||
    base.match(/^(\d{8})(?:-([A-Za-z0-9]+))?$/);
  const compactDate = idMatch
    ? idMatch[1].length === 4
      ? idMatch[1] + idMatch[2] + idMatch[3]
      : idMatch[1]
    : base;
  const suffix = idMatch
    ? idMatch[1].length === 8
      ? idMatch[2]
      : idMatch[4]
    : '';
  const id = compactDate + (suffix ? '-' + suffix : '');
  const date = compactDate;
  const headings = headingTexts($);

  const hero = parseHero($);
  const plotData = parsePlot($, headings);
  const highlights = parseCardGrid($, headings, 'highlights');
  const why = parseCardGrid($, headings, 'why');
  const honors = parseHonors($, headings);
  const archive = parseArchive($, headings);
  const quotes = parseQuotes($);
  const review = parseReview($);
  const poster = parsePoster($);

  return {
    id,
    date,
    ...hero,
    ratings: parseRatings($),
    plot: plotData.plot,
    spoilerNote: plotData.spoilerNote,
    highlights,
    quotes,
    why,
    honors,
    archive,
    review: review.review,
    reviewBy: review.reviewBy,
    reviewStars: review.reviewStars,
    ...poster,
  };
}

const files = fs.readdirSync(SRC_DIR)
  .filter((f) => /^movie-recommend-(\d{8}|\d{4}-\d{2}-\d{2})(-[A-Za-z0-9]+)?\.html$/.test(f))
  .sort();

const movies = files.map((f) => parseFile(path.join(SRC_DIR, f)));

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(movies, null, 2), 'utf8');

/* ---------- 覆盖率报告 ---------- */
const fields = ['zhTitle', 'enTitle', 'year', 'tagline', 'meta', 'ratings', 'plot', 'highlights', 'quotes', 'why', 'honors', 'archive', 'review', 'posterSvg'];
console.log(`解析 ${movies.length} 份文件 → ${OUT_FILE}\n`);
for (const f of fields) {
  const n = movies.filter((m) => (Array.isArray(m[f]) ? m[f].length > 0 : !!m[f])).length;
  console.log(`${f.padEnd(12)} ${String(n).padStart(2)}/${movies.length}`);
}
