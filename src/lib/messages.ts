import { useSyncExternalStore } from 'react';

export interface Message {
  id: string;
  name: string;
  contact: string;
  content: string;
  createdAt: string;
}

const LS_KEY = 'cm_messages_v1';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let cache: Message[] | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeMessages(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function load(): Message[] {
  if (cache) return cache;
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      cache = JSON.parse(saved) as Message[];
      return cache;
    }
  } catch {
    /* ignore */
  }
  cache = [];
  return cache;
}

function persist() {
  localStorage.setItem(LS_KEY, JSON.stringify(cache));
}

export function useMessages(): Message[] {
  return useSyncExternalStore(subscribeMessages, load, load);
}

export function addMessage(input: { name: string; contact: string; content: string }): void {
  const msg: Message = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
    createdAt: new Date().toISOString(),
  };
  cache = [...load(), msg];
  persist();
  notify();
  pushToSupabase(msg);
}

export function removeMessage(id: string): void {
  cache = load().filter((m) => m.id !== id);
  persist();
  notify();
}

/** Supabase 模式：留言同步写入 messages 表供后台审核 */
async function pushToSupabase(msg: Message) {
  if (!SUPABASE_URL || !SUPABASE_ANON) return;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
    await sb.from('messages').insert({
      name: msg.name,
      contact: msg.contact,
      content: msg.content,
      status: 'pending',
    });
  } catch (e) {
    console.warn('留言同步到 Supabase 失败:', e);
  }
}
