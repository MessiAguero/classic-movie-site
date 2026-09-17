#!/usr/bin/env node
/**
 * 年份补全：为缺少 4 位年份的电影补上上映年份
 *   1) 优先用海报来源标题里的年份（TMDB 官方条目，如 "The Third Man (1949) — TMDB"）
 *   2) 其次从原版页面里提取（档案行「上映/年份」、<title> 括号、页面首个 4 位年份）
 * 解析（data:parse）之后运行，保证重解析不会丢年份。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'source-html');

const movies = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/movies.json'), 'utf8'));
const gallery = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/gallery.json'), 'utf8'));
const gById = new Map(gallery.map((g) => [g.id, g]));
const norm = (s) => (s || '').replace(/[\s·、，,：:《》()（）"'‘’“”\-—–|.]+/g, '').toLowerCase();

const toId = (b) => {
  const m = b.match(/^(\d{4})-(\d{2})-(\d{2})(?:-([A-Za-z0-9-]+))?$/) || b.match(/^(\d{8})(?:-([A-Za-z0-9-]+))?$/);
  if (!m) return b;
  const d = m[1].length === 4 ? m[1] + m[2] + m[3] : m[1];
  const s = m[1].length === 8 ? m[2] : m[4];
  return d + (s ? '-' + s : '');
};

const fileById = new Map();
if (fs.existsSync(SRC)) {
  for (const f of fs.readdirSync(SRC)) {
    fileById.set(toId(f.replace(/^movie-recommend-/, '').replace(/\.html$/, '')), path.join(SRC, f));
  }
}

/** 每部唯一电影只算一次 */
const unique = new Map();
for (const m of movies) {
  const k = norm(m.zhTitle);
  if (!unique.has(k)) unique.set(k, m);
}

let filled = 0;
const still = [];
for (const m of unique.values()) {
  if ((m.year || '').match(/^\d{4}$/)) continue;
  let year = '';

  // 1) 海报来源标题（TMDB 官方条目最可靠）
  const gy = (gById.get(m.id)?.title || '').match(/\((19|20)\d{2}\)/);
  if (gy) year = gy[0].replace(/[()]/g, '');

  // 2) 原版页面提取
  if (!year) {
    const file = fileById.get(m.id);
    if (file) {
      const html = fs.readFileSync(file, 'utf8');
      const cands = [
        // 档案表格：<td>上映</td><td>2010-12-22</td>
        /(?:上映|年份|发行)[^0-9]{0,60}((?:19|20)\d{2})/,
        /<title>[^<()]*\(((?:19|20)\d{2})\)/,
        /class="(?:year|hero-year|year-badge)[^"]*"[^>]*>\s*((?:19|20)\d{2})/,
        /((?:19|20)\d{2})\s*年/,
      ];
      for (const re of cands) {
        const mm = html.match(re);
        if (mm) { year = mm[1]; break; }
      }
    }
  }

  if (year) { m.year = year; filled++; }
  else still.push(`${m.id} ${m.zhTitle}`);
}

// 同名片名共享年份，并同步到海报数据
for (const m of movies) {
  const u = unique.get(norm(m.zhTitle));
  if (u?.year && m.year !== u.year) m.year = u.year;
}
for (const g of gallery) {
  const m = movies.find((x) => x.id === g.id);
  if (m) g.year = m.year || '';
}

fs.writeFileSync(path.join(ROOT, 'src/data/movies.json'), JSON.stringify(movies, null, 2));
fs.writeFileSync(path.join(ROOT, 'src/data/gallery.json'), JSON.stringify(gallery, null, 2));
console.log(`年份补全：新增 ${filled} 部 | 仍缺 ${still.length} 部`);
if (still.length) console.log('  待补:', still.join(' / '));
