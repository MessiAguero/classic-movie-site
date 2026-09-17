#!/usr/bin/env node
/**
 * 静态站生成器：把 WorkBuddy 生成的原版页面直接作为网站主体
 *
 * 产物（dist/）：
 *   index.html          ← 最新一天的原版页面（首页即当天推荐）
 *   daily/<id>.html     ← 每天的原版页面原文（注入统一导航）
 *   archive.html        ← 往期推荐列表
 *   gallery.html        ← 电影海报（真实海报图）
 *   quotes.html         ← 经典台词
 *   analyses.html       ← 经典解析
 *   contact.html        ← 联系我们（含留言板，写入 Supabase）
 *   assets/site.css     ← 统一主题（与原版页面同风格）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'source-html');
const DIST = path.join(ROOT, 'dist');

const SUPABASE_URL = 'https://rltzyqjrmnpdnfnlvtda.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsdHp5cWpybW5wZG5mbmx2dGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwNjQ5NTUsImV4cCI6MjEwMTY0MDk1NX0.vw5MiAWNBS-d9u7nJJSCUJ5oDMsdt29D7lPECuiAGUI';

const movies = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/movies.json'), 'utf8'));
let gallery = [];
try {
  gallery = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/gallery.json'), 'utf8'));
} catch { /* 无海报数据 */ }

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

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (d) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d);

/** 每份原版页面文件 → id */
if (!fs.existsSync(SRC)) {
  console.error('source-html 目录不存在');
  process.exit(1);
}
const pages = fs.readdirSync(SRC)
  .filter((f) => f.endsWith('.html'))
  .map((f) => ({ file: f, id: toId(f.replace(/^movie-recommend-/, '').replace(/\.html$/, '')) }))
  .sort((a, b) => (a.id < b.id ? 1 : -1));

const byId = new Map(movies.map((m) => [m.id, m]));
const latestId = pages[0]?.id;

/* ---------- 统一主题 CSS ---------- */
const CSS = `:root{--bg:#0e0a07;--bg2:#171009;--ink:#f3e6d2;--ink-soft:#c9b69a;--ink-dim:#9a856a;
--gold:#d8a14a;--gold-bright:#f4c869;--line:rgba(216,161,74,.22);--card:rgba(38,26,16,.72)}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:"Songti SC","STSong","Noto Serif SC",Georgia,serif;line-height:1.9}
a{color:var(--gold)}
::selection{background:rgba(216,161,74,.35);color:#fff}
.cmp-nav{position:relative;z-index:9999;display:flex;gap:4px;flex-wrap:wrap;justify-content:center;
background:rgba(14,10,7,.96);border-bottom:1px solid var(--line);padding:9px 16px}
.cmp-nav a{font-size:13px;letter-spacing:.08em;padding:6px 12px;border-radius:20px;text-decoration:none;color:var(--ink-soft)}
.cmp-nav a:hover{color:var(--gold-bright);background:rgba(216,161,74,.12)}
.cmp-nav a.on{color:var(--gold-bright);background:rgba(216,161,74,.16)}
.cmp-top{position:fixed;right:22px;bottom:26px;z-index:9999;width:46px;height:46px;border-radius:50%;
border:1px solid rgba(216,161,74,.55);background:rgba(14,10,7,.88);color:var(--gold-bright);font-size:20px;
line-height:1;cursor:pointer;display:none;backdrop-filter:blur(6px);transition:background .2s,transform .2s}
.cmp-top.on{display:block}
.cmp-top:hover{background:rgba(216,161,74,.22);transform:translateY(-2px)}
.cmp-wrap{max-width:1120px;margin:0 auto;padding:96px 22px 70px}
.cmp-title{text-align:center;margin-bottom:38px}
.cmp-title h1{font-size:clamp(26px,4vw,40px);letter-spacing:.14em;font-weight:800}
.cmp-title h1 em{font-style:normal;color:var(--gold-bright)}
.cmp-title p{margin-top:10px;color:var(--ink-dim);font-size:13px;letter-spacing:.24em}
.cmp-grid{display:grid;gap:16px}
.cmp-grid.p4{grid-template-columns:repeat(4,1fr)}
.cmp-grid.p3{grid-template-columns:repeat(3,1fr)}
.cmp-grid.p2{grid-template-columns:repeat(2,1fr)}
.cmp-card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;
transition:transform .3s,box-shadow .3s,border-color .3s}
.cmp-card:hover{transform:translateY(-5px);border-color:rgba(216,161,74,.5);box-shadow:0 18px 40px rgba(0,0,0,.5)}
.cmp-poster{display:block;text-decoration:none;color:var(--ink)}
.cmp-poster img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#1a120a}
.cmp-poster .cap{padding:12px 14px}
.cmp-poster .cap b{display:block;font-size:15px;font-weight:700;letter-spacing:.06em}
.cmp-poster .cap span{font-size:12px;color:var(--ink-dim)}
.cmp-row{display:flex;align-items:baseline;gap:14px;padding:14px 18px;border-bottom:1px solid rgba(216,161,74,.12);
text-decoration:none;color:var(--ink-soft)}
.cmp-row:hover{background:rgba(216,161,74,.06)}
.cmp-row .d{font-family:"Times New Roman",serif;color:var(--gold);font-size:14px;min-width:104px}
.cmp-row .t{font-size:16px;color:var(--ink);font-weight:700;letter-spacing:.05em}
.cmp-row .e{font-size:12px;color:var(--ink-dim)}
.cmp-row .y{margin-left:auto;color:var(--gold-bright);font-family:"Times New Roman",serif}
.cmp-quote{padding:24px 26px;position:relative}
.cmp-quote::before{content:"“";position:absolute;top:6px;left:16px;font-size:44px;color:var(--gold);opacity:.35;font-family:Georgia,serif}
.cmp-quote p{font-size:15px;color:var(--ink);font-style:italic;line-height:1.95}
.cmp-quote .w{margin-top:10px;font-size:12.5px;color:var(--gold)}
.cmp-quote .f{margin-top:6px;font-size:12px;color:var(--ink-dim)}
.cmp-review{padding:22px 24px}
.cmp-review h3{font-size:17px;margin-bottom:8px}
.cmp-review h3 a{text-decoration:none;color:var(--ink)}
.cmp-review h3 a:hover{color:var(--gold-bright)}
.cmp-review p{font-size:14px;color:var(--ink-soft);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.cmp-review .y{font-size:12px;color:var(--gold);margin-top:8px}
.cmp-info{padding:22px 24px}
.cmp-info h3{font-size:17px;color:var(--gold-bright);margin-bottom:12px;letter-spacing:.1em}
.cmp-info .r{display:flex;gap:12px;padding:9px 0;border-bottom:1px dashed rgba(216,161,74,.15);font-size:14px;color:var(--ink-soft)}
.cmp-info .r:last-child{border-bottom:none}
.cmp-info .r b{flex:none;width:76px;color:var(--gold);font-weight:400}
.cmp-info .r a{text-decoration:none}
.cmp-form{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}
.cmp-form .full{grid-column:1/-1}
.cmp-form label{font-size:12.5px;color:var(--ink-dim);display:block}
.cmp-form input,.cmp-form textarea{width:100%;margin-top:6px;padding:11px 14px;border-radius:8px;
border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--ink);font-family:inherit;font-size:14px;outline:none}
.cmp-form input:focus,.cmp-form textarea:focus{border-color:rgba(216,161,74,.6)}
.cmp-btn{padding:11px 22px;border:1px solid rgba(216,161,74,.6);border-radius:30px;background:rgba(216,161,74,.12);
color:var(--gold-bright);font-family:inherit;font-size:14px;letter-spacing:.16em;cursor:pointer}
.cmp-btn:hover{background:rgba(216,161,74,.22)}
.cmp-flash{margin-top:12px;font-size:13px;color:var(--gold-bright)}
.cmp-empty{text-align:center;color:var(--ink-dim);padding:40px 0;letter-spacing:.2em}
footer.cmp-foot{text-align:center;color:var(--ink-dim);font-size:12.5px;letter-spacing:.2em;padding:50px 0 40px}
footer.cmp-foot .m{color:var(--gold);letter-spacing:.4em;font-size:14px}
@media(max-width:900px){.cmp-grid.p4{grid-template-columns:repeat(2,1fr)}.cmp-grid.p3{grid-template-columns:1fr}}
@media(max-width:760px){.cmp-grid.p4,.cmp-grid.p2,.cmp-form{grid-template-columns:1fr}
.cmp-nav{padding:8px 10px;gap:2px}.cmp-nav a{padding:6px 9px;font-size:12.5px}
.cmp-wrap{padding-top:40px}.cmp-top{right:14px;bottom:16px;width:42px;height:42px}}
`;

/* ---------- 通用渲染 ---------- */
const TABS = [
  ['index.html', '今日推荐'],
  ['archive.html', '往期推荐'],
  ['gallery.html', '电影海报'],
  ['quotes.html', '经典台词'],
  ['analyses.html', '经典解析'],
  ['contact.html', '联系我们'],
];

function navHtml(prefix, current) {
  const items = TABS.map(
    ([href, label]) =>
      `<a href="${prefix}${href}"${current === href ? ' class="on"' : ''}>${label}</a>`,
  ).join('');
  return `<nav class="cmp-nav">${items}</nav>`;
}

/** 右下角「回到顶部」按钮（滚动超过 400px 才出现） */
const TOP_BUTTON = `<button class="cmp-top" id="cmp-top" aria-label="回到顶部" title="回到顶部"
  onclick="window.scrollTo({top:0,behavior:'smooth'})">↑</button>
<script>addEventListener('scroll',function(){var b=document.getElementById('cmp-top');if(b){b.className='cmp-top'+(scrollY>400?' on':'')}},{passive:true});</script>`;

function shell({ title, current, prefix, body, extraHead = '' }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${prefix}assets/site.css">
${extraHead}
</head>
<body>
${navHtml(prefix, current)}
<div class="cmp-wrap">
${body}
</div>
<footer class="cmp-foot"><div class="m">经典电影推荐</div>每日一部公认经典 · 评分高 · 口碑好 · 不剧透</footer>
</body>
</html>`;
}

function pageTitle(title, sub) {
  return `<div class="cmp-title"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`;
}

/* ---------- 构建 ---------- */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'daily'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'assets', 'site.css'), CSS);

// 1) 原版页面（注入统一导航，其余原文保留）
for (const p of pages) {
  let html = fs.readFileSync(path.join(SRC, p.file), 'utf8');
  const link = `<link rel="stylesheet" href="../assets/site.css">`;
  html = html.includes('</head>') ? html.replace('</head>', `${link}\n</head>`) : `${link}\n${html}`;
  // 导航条放在页面最顶部（随页面滚动，不悬浮）
  html = /<body[^>]*>/i.test(html)
    ? html.replace(/<body([^>]*)>/i, `<body$1>\n${navHtml('../', '')}`)
    : `${navHtml('../', '')}\n${html}`;
  html = html.includes('</body>') ? html.replace('</body>', `${TOP_BUTTON}\n</body>`) : html + TOP_BUTTON;
  fs.writeFileSync(path.join(DIST, 'daily', `${p.id}.html`), html);
}
console.log(`原版页面：${pages.length} 份 → dist/daily/`);

// 2) 首页 = 最新一天的原版页面
if (latestId) {
  let html = fs.readFileSync(path.join(SRC, pages[0].file), 'utf8');
  const link = `<link rel="stylesheet" href="assets/site.css">`;
  html = html.includes('</head>') ? html.replace('</head>', `${link}\n</head>`) : `${link}\n${html}`;
  html = /<body[^>]*>/i.test(html)
    ? html.replace(/<body([^>]*)>/i, `<body$1>\n${navHtml('', 'index.html')}`)
    : `${navHtml('', 'index.html')}\n${html}`;
  html = html.includes('</body>') ? html.replace('</body>', `${TOP_BUTTON}\n</body>`) : html + TOP_BUTTON;
  fs.writeFileSync(path.join(DIST, 'index.html'), html);
  console.log(`首页 ← ${latestId}（${byId.get(latestId)?.zhTitle || ''}）`);
}

// 3) 往期推荐
const rows = pages
  .map((p) => {
    const m = byId.get(p.id) || {};
    return `<a class="cmp-row" href="daily/${p.id}.html">
  <span class="d">${fmtDate(p.id.replace(/-.*$/, ''))}</span>
  <span><span class="t">${esc(m.zhTitle || p.id)}</span>${m.enTitle ? `<div class="e">${esc(m.enTitle)}</div>` : ''}</span>
  <span class="y">${esc(m.year || '')}</span>
</a>`;
  })
  .join('\n');
fs.writeFileSync(
  path.join(DIST, 'archive.html'),
  shell({
    title: '往期推荐 · 经典电影推荐',
    current: 'archive.html',
    prefix: '',
    body: `${pageTitle('往期<em>推荐</em>', `共 ${pages.length} 部 · 点击查看当日完整推荐页`)}
<div class="cmp-card">${rows}</div>`,
  }),
);

// 4) 电影海报
const galleryById = new Map(gallery.map((g) => [g.id, g]));
const posterCards = pages
  .map((p) => {
    const m = byId.get(p.id) || {};
    const g = galleryById.get(p.id);
    if (!g?.imageUrl) return '';
    return `<a class="cmp-poster cmp-card" href="daily/${p.id}.html">
  <img src="${esc(g.imageUrl)}" alt="${esc(m.zhTitle)} 海报" loading="lazy">
  <div class="cap"><b>${esc(m.zhTitle)}</b><span>${esc(m.year || '')}${m.enTitle ? ' · ' + esc(m.enTitle) : ''}</span></div>
</a>`;
  })
  .filter(Boolean)
  .join('\n');
fs.writeFileSync(
  path.join(DIST, 'gallery.html'),
  shell({
    title: '电影海报 · 经典电影推荐',
    current: 'gallery.html',
    prefix: '',
    body: `${pageTitle('电影<em>海报</em>', `${gallery.length} 部经典电影海报 · 点击查看当日推荐页`)}
<div class="cmp-grid p4">${posterCards}</div>`,
  }),
);

// 5) 经典台词
const quoteCards = pages
  .flatMap((p) => {
    const m = byId.get(p.id) || {};
    return (m.quotes || [])
      .map((q) => String(q.text || '').replace(/^["“”'‘]+|["“”'‘]+$/g, '').trim())
      .filter(Boolean)
      .map(
        (text) => `<div class="cmp-quote cmp-card">
  <p>${esc(text)}</p>
  <div class="w">— ${esc((m.quotes.find((q) => q.text.includes(text)) || {}).who || '')}</div>
  <div class="f"><a href="daily/${p.id}.html">《${esc(m.zhTitle || p.id)}》${m.year ? ' · ' + esc(m.year) : ''} ↗</a></div>
</div>`,
      );
  })
  .join('\n');
fs.writeFileSync(
  path.join(DIST, 'quotes.html'),
  shell({
    title: '经典台词 · 经典电影推荐',
    current: 'quotes.html',
    prefix: '',
    body: `${pageTitle('经典<em>台词</em>', '那些值得被反复念起的句子')}
<div class="cmp-grid p2">${quoteCards || '<div class="cmp-empty">暂无台词</div>'}</div>`,
  }),
);

// 6) 经典解析
const analysisCards = pages
  .filter((p) => byId.get(p.id)?.review)
  .map((p) => {
    const m = byId.get(p.id);
    return `<div class="cmp-review cmp-card">
  <h3><a href="daily/${p.id}.html">${esc(m.zhTitle)}</a></h3>
  <div class="y">${esc(m.year || '')} · ${fmtDate(m.date || p.id)}</div>
  <p>${esc(m.review)}</p>
</div>`;
  })
  .join('\n');
fs.writeFileSync(
  path.join(DIST, 'analyses.html'),
  shell({
    title: '经典解析 · 经典电影推荐',
    current: 'analyses.html',
    prefix: '',
    body: `${pageTitle('经典<em>解析</em>', `${analysisCards ? pages.filter((p) => byId.get(p.id)?.review).length : 0} 篇编辑评语 · 点击进入当日推荐页`)}
<div class="cmp-grid p3">${analysisCards || '<div class="cmp-empty">暂无解析</div>'}</div>`,
  }),
);

// 7) 联系我们（含留言板，直连 Supabase）
const contactBody = `${pageTitle('联系<em>我们</em>', '商务合作 · 联系方式 · 留言板')}
<div class="cmp-grid p2">
  <div class="cmp-info cmp-card">
    <h3>商务合作</h3>
    <div class="r"><b>合作邮箱</b><a href="mailto:499147375@qq.com">499147375@qq.com</a></div>
    <div class="r"><b>响应时间</b><span>工作日 24 小时内回复</span></div>
    <div class="r"><b>合作方向</b><span>品牌联名 · 内容授权 · 媒体合作 · 活动策划</span></div>
  </div>
  <div class="cmp-info cmp-card">
    <h3>联系方式</h3>
    <div class="r"><b>合作邮箱</b><a href="mailto:499147375@qq.com">499147375@qq.com</a></div>
    <div class="r"><b>商务微信</b><span>499147375</span></div>
    <div class="r"><b>微信公众号</b><span>经典电影推荐</span></div>
    <div class="r"><b>办公地址</b><span>浙江省宁波市北仑区小港街道田洋乐党群服务中心</span></div>
  </div>
</div>
<div class="cmp-info cmp-card" style="margin-top:16px">
  <h3>留言板</h3>
  <form class="cmp-form" id="cmp-msg-form">
    <label>称呼<input name="name" maxlength="30" placeholder="你的昵称"></label>
    <label>联系方式（选填）<input name="contact" maxlength="80" placeholder="邮箱 / 微信 / 电话"></label>
    <label class="full">留言内容<textarea name="content" rows="4" maxlength="500" placeholder="想推荐的电影、想说的话、合作意向……"></textarea></label>
    <div class="full"><button class="cmp-btn" type="submit">提 交 留 言</button><div class="cmp-flash" id="cmp-flash"></div></div>
  </form>
  <div id="cmp-msgs" style="margin-top:18px"></div>
</div>`;

const contactScript = `<script>
const SB_URL='${SUPABASE_URL}', SB_KEY='${SUPABASE_ANON}';
const H={apikey:SB_KEY,Authorization:'Bearer '+SB_KEY};
const list=document.getElementById('cmp-msgs'), flash=document.getElementById('cmp-flash');
async function loadMsgs(){
  try{
    const r=await fetch(SB_URL+'/rest/v1/messages?select=name,content,created_at&status=eq.approved&order=created_at.desc&limit=30',{headers:H});
    const rows=await r.json();
    list.innerHTML = (rows||[]).length
      ? rows.map(m=>'<div class="cmp-info" style="padding:14px 0;border-top:1px dashed rgba(216,161,74,.15)"><b style="color:var(--gold)">'+ (m.name||'匿名') +'</b><div style="font-size:14px;color:var(--ink-soft)">'+ (m.content||'').replace(/[<>]/g,'') +'</div></div>').join('')
      : '<div class="cmp-empty">暂无公开留言</div>';
  }catch(e){ list.innerHTML='<div class="cmp-empty">留言加载失败</div>'; }
}
document.getElementById('cmp-msg-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const f=e.target, name=f.name.value.trim(), contact=f.contact.value.trim(), content=f.content.value.trim();
  if(!name||content.length<5){ flash.textContent='请填写称呼，留言至少 5 个字'; return; }
  flash.textContent='提交中…';
  try{
    const r=await fetch(SB_URL+'/rest/v1/messages',{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({name,contact,content,status:'pending'})});
    if(r.ok){ flash.textContent='留言已提交，感谢你的支持！'; f.reset(); loadMsgs(); }
    else { flash.textContent='提交失败，请稍后再试'; }
  }catch(e){ flash.textContent='提交失败，请稍后再试'; }
});
loadMsgs();
</script>`;

fs.writeFileSync(
  path.join(DIST, 'contact.html'),
  shell({
    title: '联系我们 · 经典电影推荐',
    current: 'contact.html',
    prefix: '',
    body: contactBody,
  }).replace('</body>', `${contactScript}\n</body>`),
);

// 8) 404 兜底
fs.writeFileSync(
  path.join(DIST, '404.html'),
  shell({
    title: '页面不存在 · 经典电影推荐',
    current: '',
    prefix: '',
    body: `${pageTitle('页面<em>不存在</em>', '试试从下面的入口浏览')}
<div class="cmp-grid p3">${TABS.slice(0, 3)
      .map(([h, l]) => `<a class="cmp-card cmp-review" href="${h}"><h3>${l}</h3><p>进入 ${l} 页面</p></a>`)
      .join('')}</div>`,
  }),
);

console.log('静态站构建完成 → dist/');
