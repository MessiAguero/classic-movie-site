#!/usr/bin/env node
/**
 * 生成「海报人工核对表」——把机器不敢打包票的海报拼成一页，扫一眼就能发现配错图。
 *
 * 输入：output/poster-review.json（由 tools/check-posters.mjs 产出）
 * 输出：output/poster-review.html
 *
 * 用法：
 *   node tools/poster-review.mjs            # 生成核对页
 *   open output/poster-review.html          # 打开看
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const REVIEW_JSON = path.join(OUTPUT_DIR, 'poster-review.json');
const OUT_FILE = path.join(OUTPUT_DIR, 'poster-review.html');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let review;
try {
  review = JSON.parse(fs.readFileSync(REVIEW_JSON, 'utf8'));
} catch {
  console.error('读不到 output/poster-review.json，请先跑 npm run poster:check');
  process.exit(1);
}

const LEVEL_LABEL = {
  strong: '证据充分',
  medium: '仅片名线索',
  weak: '无片名证据',
};

/** 本地海报用相对 output/ 的路径，远程海报直接用原地址 */
const imgSrc = (url) => (/^https?:/i.test(url) ? url : `../public/${url}`);

const cards = review.entries
  .map((e) => {
    const level = e.evidence?.level || 'weak';
    const reasons = e.evidence?.reasons?.join('、') || '无片名证据';
    const conflicts = e.evidence?.conflicts || [];
    const issues = (e.issues || []).filter((c) => c !== 'identity_weak_evidence');
    return `<article class="card ${level === 'strong' ? '' : 'dim'}">
  <img src="${esc(imgSrc(e.imageUrl))}" alt="${esc(e.zhTitle)}" loading="lazy">
  <div class="body">
    <h2>${esc(e.zhTitle)} <span class="year">${esc(e.year)}</span></h2>
    <p class="meta">${esc(e.id)} · ${esc(e.dims)} · ${esc(e.host || '本地')}</p>
    <p class="src">${esc(e.sourceTitle || '（无来源标题）')}</p>
    <p class="tag lv-${esc(level)}">${esc(LEVEL_LABEL[level] || level)}：${esc(reasons)}</p>
    ${conflicts.map((c) => `<p class="tag bad">疑点：${esc(c)}</p>`).join('\n    ')}
    ${issues.length ? `<p class="tag warn">${esc(issues.join(', '))}</p>` : ''}
  </div>
</article>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>海报人工核对表 · ${review.reviewCount} 张待核对</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 28px 24px 60px; background: #f6f5f2; color: #201c17;
         font: 15px/1.6 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  header { max-width: 1400px; margin: 0 auto 22px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .sub { color: #6b635a; font-size: 13px; }
  .grid { max-width: 1400px; margin: 0 auto; display: grid; gap: 18px;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .card { background: #fff; border: 1px solid #e3ded6; border-radius: 8px; overflow: hidden;
          display: flex; flex-direction: column; }
  .card img { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; background: #1a120a; display: block; }
  .body { padding: 10px 12px 14px; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .year { color: #8a8177; font-weight: 400; font-size: 13px; }
  .meta { margin: 0 0 6px; font-size: 12px; color: #8a8177; }
  .src { margin: 0 0 8px; font-size: 12px; color: #4d463e; word-break: break-all; }
  .tag { margin: 0 0 4px; font-size: 12px; padding: 3px 8px; border-radius: 4px; display: inline-block; }
  .lv-strong { background: #e8f2e6; color: #33612c; }
  .lv-medium { background: #fdf3e0; color: #7a5314; }
  .lv-weak { background: #fbe9e7; color: #8c2f26; }
  .bad { background: #fbe9e7; color: #8c2f26; display: block; }
  .warn { background: #f1efe9; color: #5d564d; display: block; }
</style>
</head>
<body>
<header>
  <h1>海报人工核对表</h1>
  <p class="sub">生成时间 ${esc(review.generatedAt)} · 共 ${review.reviewCount} / ${review.total} 张待核对 ·
     这一页只列机器无法确认的，核对无误后登记进 <code>src/data/poster-verified.json</code></p>
</header>
<div class="grid">
${cards}
</div>
</body>
</html>
`;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html, 'utf8');
console.log(`海报核对页：${review.reviewCount} 张待核对 → ${path.relative(ROOT, OUT_FILE)}`);
