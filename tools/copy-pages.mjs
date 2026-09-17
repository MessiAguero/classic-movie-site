#!/usr/bin/env node
/**
 * 把 source-html/ 里的原版精美页面发布为静态页：
 *   source-html/movie-recommend-2026-08-17.html → public/daily/20260817.html
 *   source-html/movie-recommend-20260812-bttf.html → public/daily/20260812-bttf.html
 *
 * 构建（npm run build）与开发（npm run dev）前自动执行，
 * 因此站点上可通过 /daily/<电影id>.html 直接打开原版页面。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'source-html');
const OUT = path.join(ROOT, 'public', 'daily');

/** 与解析器一致的 id 归一化 */
function toId(base) {
  const m =
    base.match(/^(\d{4})-(\d{2})-(\d{2})(?:-([A-Za-z0-9-]+))?$/) ||
    base.match(/^(\d{8})(?:-([A-Za-z0-9-]+))?$/);
  if (!m) return base;
  const date = m[1].length === 4 ? m[1] + m[2] + m[3] : m[1];
  const suffix = m[1].length === 8 ? m[2] : m[4];
  return date + (suffix ? '-' + suffix : '');
}

if (!fs.existsSync(SRC)) {
  console.log('source-html 目录不存在，跳过原版页面发布');
  process.exit(0);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let count = 0;
const manifest = [];
for (const file of fs.readdirSync(SRC)) {
  if (!file.endsWith('.html')) continue;
  const id = toId(file.replace(/^movie-recommend-/, '').replace(/\.html$/, ''));
  fs.copyFileSync(path.join(SRC, file), path.join(OUT, id + '.html'));
  manifest.push(id);
  count++;
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(manifest.sort(), null, 2));
console.log(`原版页面已发布：${count} 份 → public/daily/`);
