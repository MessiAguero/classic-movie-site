import { useSyncExternalStore } from 'react';
import rawMovies from '../data/movies.json';
import type { Movie } from '../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const LS_KEY = 'cm_movies_v1';
let cache: Movie[] | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeStore(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function load(): Movie[] {
  if (!cache) {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        cache = JSON.parse(saved) as Movie[];
      }
    } catch {
      /* 忽略损坏的本地数据 */
    }
    if (!cache) {
      cache = (rawMovies as Movie[]).map((m) => ({ ...m, status: m.status || 'published' }));
    }
    // 云端模式：启动后异步拉取 Supabase 已发布数据，加载完成自动刷新
    if (SUPABASE_URL && SUPABASE_ANON) {
      fetchFromSupabase();
    }
  }
  return cache;
}

function mapRow(row: Record<string, unknown>): Movie {
  return {
    id: String(row.id ?? ''),
    date: String(row.date ?? ''),
    zhTitle: String(row.zh_title ?? ''),
    enTitle: (row.en_title as string) || undefined,
    year: (row.year as string) || undefined,
    tagline: (row.tagline as string) || undefined,
    meta: (row.meta as string) || undefined,
    ratings: (row.ratings as Movie['ratings']) || [],
    plot: (row.plot as Movie['plot']) || [],
    spoilerNote: (row.spoiler_note as string) || undefined,
    highlights: (row.highlights as Movie['highlights']) || [],
    quotes: (row.quotes as Movie['quotes']) || [],
    why: (row.why as Movie['why']) || [],
    honors: (row.honors as Movie['honors']) || [],
    archive: (row.archive as Movie['archive']) || [],
    review: (row.review as string) || undefined,
    reviewBy: (row.review_by as string) || undefined,
    reviewStars: (row.review_stars as number) || 5,
    posterSvg: (row.poster_svg as string) || undefined,
    posterCaption: (row.poster_caption as string) || undefined,
    status: (row.status as Movie['status']) || 'published',
  };
}

async function fetchFromSupabase() {
  try {
    const base = (SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
    const res = await fetch(
      `${base}/rest/v1/movies?select=*&status=eq.published&order=date.desc`,
      {
        headers: {
          apikey: SUPABASE_ANON || '',
          Authorization: `Bearer ${SUPABASE_ANON || ''}`,
        },
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length === 0) return;
    cache = rows.map(mapRow);
    notify();
  } catch (e) {
    console.warn('Supabase 数据加载失败，使用本地数据:', e);
  }
}

function persist() {
  localStorage.setItem(LS_KEY, JSON.stringify(cache));
}

export function useMovies(): Movie[] {
  return useSyncExternalStore(subscribeStore, load, load);
}

function sortDesc(a: Movie, b: Movie): number {
  if (a.date === b.date) return a.id < b.id ? 1 : -1;
  return a.date < b.date ? 1 : -1;
}

/** 全部电影（含草稿），按日期倒序 */
export function getSortedMovies(): Movie[] {
  return load().slice().sort(sortDesc);
}

/** 已发布电影（公开页面使用） */
export function getPublishedMovies(): Movie[] {
  return load().filter((m) => m.status !== 'draft').sort(sortDesc);
}

export function getMovieById(id: string): Movie | undefined {
  return load().find((m) => m.id === id);
}

export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 当日推荐：优先今天，其次最近一天（仅已发布） */
export function getTodayMovie(): Movie {
  const published = getPublishedMovies();
  const today = todayStr();
  return published.find((m) => m.date === today) ?? published[0];
}

export function formatDate(dateStr: string): string {
  if (!/^\d{8}$/.test(dateStr)) return dateStr;
  return `${dateStr.slice(0, 4)}年${Number(dateStr.slice(4, 6))}月${Number(dateStr.slice(6, 8))}日`;
}

/** 评分 → 进度条百分比 */
export function ratingPercent(value: string): number {
  const m = value.match(/(\d+(?:\.\d+)?)/);
  if (!m) return 80;
  const n = parseFloat(m[1]);
  if (value.includes('/100')) return Math.min(100, n);
  if (value.includes('%')) return Math.min(100, n);
  if (n <= 10) return Math.min(100, Math.round(n * 10));
  return Math.min(100, Math.round(n));
}

/** 前一部 / 后一部 */
export function getNeighbors(id: string): { prev?: Movie; next?: Movie } {
  const sorted = getPublishedMovies();
  const idx = sorted.findIndex((m) => m.id === id);
  if (idx < 0) return {};
  return { prev: sorted[idx + 1], next: sorted[idx - 1] };
}

export function quoteSource(m: Movie): string {
  return m.zhTitle + (m.year ? ` · ${m.year}` : '');
}

/* ---------- 后台编辑 ---------- */
export function saveMovie(id: string, patch: Partial<Movie>): void {
  const arr = load();
  const idx = arr.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const updated = { ...arr[idx], ...patch, status: patch.status || arr[idx].status || 'published' };
  cache = arr.map((m, i) => (i === idx ? updated : m));
  persist();
  notify();
  pushToSupabase(updated);
}

export function setMovieStatus(id: string, status: 'published' | 'draft'): void {
  saveMovie(id, { status });
}

export function resetMovieData(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  cache = (rawMovies as Movie[]).map((m) => ({ ...m, status: m.status || 'published' }));
  notify();
}

/* ---------- Supabase 模式：后台修改同步到远端 ---------- */
async function pushToSupabase(movie: Movie) {
  if (!SUPABASE_URL || !SUPABASE_ANON) return;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
    const { error } = await sb.from('movies').upsert(
      {
        id: movie.id,
        date: movie.date,
        slug: movie.id,
        zh_title: movie.zhTitle,
        en_title: movie.enTitle || null,
        year: movie.year || null,
        tagline: movie.tagline || null,
        meta: movie.meta || null,
        ratings: movie.ratings,
        plot: movie.plot,
        spoiler_note: movie.spoilerNote || null,
        highlights: movie.highlights,
        quotes: movie.quotes,
        why: movie.why,
        honors: movie.honors,
        archive: movie.archive,
        review: movie.review || null,
        review_by: movie.reviewBy || null,
        review_stars: movie.reviewStars || 5,
        poster_svg: movie.posterSvg || null,
        poster_caption: movie.posterCaption || null,
        status: movie.status || 'published',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (error) console.warn('同步到 Supabase 失败:', error.message);
  } catch (e) {
    console.warn('同步到 Supabase 失败:', e);
  }
}
