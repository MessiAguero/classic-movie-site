#!/usr/bin/env node
/**
 * 把 src/data/movies.json 同步到 Supabase（service_role key）
 *
 * 用法：
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run data:sync
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 环境变量');
  process.exit(1);
}

const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(url, key);

const movies = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'movies.json'), 'utf8'),
);

const base = url.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

// 预检：云端不可达时直接退出。否则每部电影都要各自等一次超时，
// 一次同步会卡十几分钟，还会占着 daily-sync 的锁阻塞后续任务。
try {
  const probe = await fetch(`${base}/rest/v1/movies?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (probe.status >= 500) {
    console.error(`✗ 云端预检失败：HTTP ${probe.status}，跳过本次云端同步`);
    process.exit(1);
  }
} catch (e) {
  console.error(`✗ 云端不可达（${e?.message || e}），跳过本次云端同步；本地内容不受影响`);
  process.exit(1);
}

async function upsertWithRetry(table, row, options, attempts = 3) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    const { error } = await supabase.from(table).upsert(row, options);
    if (!error) return null;
    lastError = error;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
    }
  }
  return lastError;
}

let ok = 0;
for (const m of movies) {
  const row = {
    id: m.id,
    date: m.date,
    slug: m.id,
    zh_title: m.zhTitle,
    en_title: m.enTitle || null,
    year: m.year || null,
    tagline: m.tagline || null,
    meta: m.meta || null,
    ratings: m.ratings,
    plot: m.plot,
    spoiler_note: m.spoilerNote || null,
    highlights: m.highlights,
    quotes: m.quotes,
    why: m.why,
    honors: m.honors,
    archive: m.archive,
    review: m.review || null,
    review_by: m.reviewBy || null,
    review_stars: m.reviewStars || 5,
    poster_svg: m.posterSvg || null,
    poster_caption: m.posterCaption || null,
    status: 'published',
    published_at: new Date().toISOString(),
  };
  const error = await upsertWithRetry('movies', row, { onConflict: 'id' });
  if (error) {
    console.error(`✗ ${m.id} ${m.zhTitle}: ${error.message}`);
  } else {
    ok++;
    for (const q of m.quotes || []) {
      await upsertWithRetry(
        'quotes',
        {
          movie_id: m.id,
          quote_zh: q.text,
          quote_en: null,
          speaker: q.who || null,
        },
        { onConflict: 'movie_id,quote_zh' },
      );
    }
  }
}

console.log(`完成：${ok}/${movies.length} 部电影已同步到 Supabase`);
if (ok < movies.length) {
  console.error('存在同步失败，请检查上面的错误信息');
  process.exit(1);
}
