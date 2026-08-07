import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';

export default function AuthModal() {
  const { modalOpen, modalTab, openAuth, closeAuth, login, register } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  if (!modalOpen) return null;

  const activeTab = modalTab || tab;

  const switchTab = (next: 'login' | 'register') => {
    setTab(next);
    openAuth(next);
    setError('');
    setNotice('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (activeTab === 'login') {
        const res = await login(identifier, password);
        if (!res.ok) setError(res.error || '登录失败');
        else {
          closeAuth();
          setIdentifier('');
          setPassword('');
        }
      } else {
        if (password !== confirm) {
          setError('两次输入的密码不一致');
          return;
        }
        const res = await register(username, email, password);
        if (!res.ok) {
          setError(res.error || '注册失败');
        } else if (res.error) {
          setNotice(res.error); // 例如需要邮箱确认
        } else {
          closeAuth();
          setUsername('');
          setEmail('');
          setPassword('');
          setConfirm('');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={closeAuth}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={closeAuth} aria-label="关闭">
          ×
        </button>
        <div className="modal-title">经典电影推荐</div>
        <div className="modal-tabs">
          <button
            className={activeTab === 'login' ? 'on' : ''}
            onClick={() => switchTab('login')}
          >
            登录
          </button>
          <button
            className={activeTab === 'register' ? 'on' : ''}
            onClick={() => switchTab('register')}
          >
            注册
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {activeTab === 'register' && (
            <>
              <label>
                用户名
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="2-20 位中文 / 字母 / 数字"
                  autoComplete="username"
                />
              </label>
              <label>
                邮箱
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </label>
            </>
          )}
          {activeTab === 'login' && (
            <label>
              邮箱或用户名
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@example.com 或用户名"
                autoComplete="username"
              />
            </label>
          )}
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={activeTab === 'register' ? '至少 6 位' : '请输入密码'}
              autoComplete={activeTab === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          {activeTab === 'register' && (
            <label>
              确认密码
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再次输入密码"
                autoComplete="new-password"
              />
            </label>
          )}

          {error && <div className="auth-error">{error}</div>}
          {notice && <div className="auth-notice">{notice}</div>}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? '请稍候…' : activeTab === 'login' ? '登 录' : '注 册'}
          </button>
        </form>

        {activeTab === 'login' ? (
          <div className="modal-foot">
            还没有账号？{' '}
            <button className="modal-link" onClick={() => switchTab('register')}>
              立即注册
            </button>
          </div>
        ) : (
          <div className="modal-foot">
            已有账号？{' '}
            <button className="modal-link" onClick={() => switchTab('login')}>
              直接登录
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
