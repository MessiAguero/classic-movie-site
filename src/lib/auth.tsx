import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  role: 'admin' | 'user';
}

export type AuthMode = 'supabase' | 'local';

export const AUTH_MODE: AuthMode =
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
    ? 'supabase'
    : 'local';

const USERS_KEY = 'cm_users_v1';
const SESSION_KEY = 'cm_session_v1';
const DEFAULT_ADMIN_USER = 'admin';
const DEFAULT_ADMIN_PASS = 'admin123';

interface LocalUser {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  salt: string;
  role: 'admin' | 'user';
  createdAt: string;
}

/* ---------- 本地模式：密码哈希 ---------- */
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function readUsers(): LocalUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '[]') as LocalUser[];
  } catch {
    return [];
  }
}

function writeUsers(users: LocalUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

async function seedAdmin() {
  if (readUsers().length) return;
  const salt = Math.random().toString(36).slice(2);
  const passwordHash = await sha256(DEFAULT_ADMIN_PASS + salt);
  writeUsers([
    {
      id: 'u-admin',
      username: DEFAULT_ADMIN_USER,
      email: 'admin@classicmovie.local',
      passwordHash,
      salt,
      role: 'admin',
      createdAt: new Date().toISOString(),
    },
  ]);
}

function localToAuthUser(u: LocalUser): AuthUser {
  return { id: u.id, username: u.username, email: u.email, role: u.role };
}

function readSession(): AuthUser | null {
  try {
    const id = localStorage.getItem(SESSION_KEY);
    if (!id) return null;
    const u = readUsers().find((x) => x.id === id);
    return u ? localToAuthUser(u) : null;
  } catch {
    return null;
  }
}

/* ---------- Supabase 客户端（懒加载） ---------- */
async function getSupabase() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  mode: AuthMode;
  modalOpen: boolean;
  modalTab: 'login' | 'register';
  openAuth: (tab?: 'login' | 'register') => void;
  closeAuth: () => void;
  login: (identifier: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (
    username: string,
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'login' | 'register'>('login');

  const openAuth = useCallback((tab: 'login' | 'register' = 'login') => {
    setModalTab(tab);
    setModalOpen(true);
  }, []);
  const closeAuth = useCallback(() => setModalOpen(false), []);

  /* ---------- 初始化会话 ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (AUTH_MODE === 'local') {
        await seedAdmin();
        if (alive) {
          setUser(readSession());
          setLoading(false);
        }
        return;
      }
      try {
        const sb = await getSupabase();
        const { data } = await sb.auth.getSession();
        const sessionUser = data.session?.user ?? null;
        let profile: AuthUser | null = null;
        if (sessionUser) {
          const { data: profileRow } = await sb
            .from('profiles')
            .select('id, username, email, role')
            .eq('id', sessionUser.id)
            .single();
          profile = profileRow
            ? {
                id: profileRow.id,
                username: profileRow.username || sessionUser.email || '用户',
                email: profileRow.email || sessionUser.email,
                role: profileRow.role,
              }
            : {
                id: sessionUser.id,
                username: sessionUser.email || '用户',
                email: sessionUser.email,
                role: 'user',
              };
        }
        if (alive) {
          setUser(profile);
          setLoading(false);
        }
        const { data: sub } = sb.auth.onAuthStateChange(async (_event, session) => {
          const u = session?.user ?? null;
          let next: AuthUser | null = null;
          if (u) {
            const { data: row } = await sb
              .from('profiles')
              .select('id, username, email, role')
              .eq('id', u.id)
              .single();
            next = {
              id: u.id,
              username: row?.username || u.email || '用户',
              email: row?.email || u.email,
              role: row?.role || 'user',
            };
          }
          setUser(next);
        });
        return () => sub.subscription.unsubscribe();
      } catch (e) {
        if (alive) {
          console.error('Supabase 会话初始化失败', e);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ---------- 登录 ---------- */
  const login = useCallback(
    async (identifier: string, password: string) => {
      if (!identifier.trim() || !password) return { ok: false, error: '请输入账号与密码' };
      if (AUTH_MODE === 'local') {
        await seedAdmin();
        const users = readUsers();
        const idn = identifier.trim().toLowerCase();
        const u = users.find(
          (x) => x.username.toLowerCase() === idn || x.email.toLowerCase() === idn,
        );
        if (!u) return { ok: false, error: '账号不存在' };
        const hash = await sha256(password + u.salt);
        if (hash !== u.passwordHash) return { ok: false, error: '密码错误' };
        localStorage.setItem(SESSION_KEY, u.id);
        setUser(localToAuthUser(u));
        return { ok: true };
      }
      // Supabase 模式：支持邮箱或用户名
      try {
        const sb = await getSupabase();
        let email = identifier.trim();
        if (!email.includes('@')) {
          const { data } = await sb
            .from('profiles')
            .select('email')
            .eq('username', email)
            .maybeSingle();
          if (!data?.email) return { ok: false, error: '账号不存在' };
          email = data.email;
        }
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '登录失败' };
      }
    },
    [],
  );

  /* ---------- 注册 ---------- */
  const register = useCallback(
    async (username: string, email: string, password: string) => {
      const uname = username.trim();
      const mail = email.trim().toLowerCase();
      if (!uname || !mail || !password) return { ok: false, error: '请填写完整信息' };
      if (!/^[\w\u4e00-\u9fa5.-]{2,20}$/.test(uname)) {
        return { ok: false, error: '用户名需为 2-20 位中文、字母、数字或 .-_' };
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, error: '邮箱格式不正确' };
      if (password.length < 6) return { ok: false, error: '密码至少 6 位' };

      if (AUTH_MODE === 'local') {
        const users = readUsers();
        if (users.some((x) => x.username.toLowerCase() === uname.toLowerCase())) {
          return { ok: false, error: '用户名已被占用' };
        }
        if (users.some((x) => x.email.toLowerCase() === mail)) {
          return { ok: false, error: '邮箱已被注册' };
        }
        const salt = Math.random().toString(36).slice(2);
        const passwordHash = await sha256(password + salt);
        const nu: LocalUser = {
          id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          username: uname,
          email: mail,
          passwordHash,
          salt,
          role: 'user',
          createdAt: new Date().toISOString(),
        };
        users.push(nu);
        writeUsers(users);
        localStorage.setItem(SESSION_KEY, nu.id);
        setUser(localToAuthUser(nu));
        return { ok: true };
      }

      try {
        const sb = await getSupabase();
        const { data, error } = await sb.auth.signUp({
          email: mail,
          password,
          options: { data: { username: uname } },
        });
        if (error) return { ok: false, error: error.message };
        if (!data.session) {
          return { ok: true, error: '注册成功，请前往邮箱确认后登录' };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '注册失败' };
      }
    },
    [],
  );

  /* ---------- 退出 ---------- */
  const logout = useCallback(async () => {
    if (AUTH_MODE === 'local') {
      localStorage.removeItem(SESSION_KEY);
      setUser(null);
      return;
    }
    try {
      const sb = await getSupabase();
      await sb.auth.signOut();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      mode: AUTH_MODE,
      modalOpen,
      modalTab,
      openAuth,
      closeAuth,
      login,
      register,
      logout,
    }),
    [user, loading, modalOpen, modalTab, openAuth, closeAuth, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
