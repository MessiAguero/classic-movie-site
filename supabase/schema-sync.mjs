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
  const { error } = await supabase.from('movies').upsert(row, { onConflict: 'id' });
  if (error) {
    console.error(`✗ ${m.id} ${m.zhTitle}: ${error.message}`);
  } else {
    ok++;
    for (const q of m.quotes || []) {
      await supabase.from('quotes').upsert(
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
