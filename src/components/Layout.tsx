import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import AuthModal from './AuthModal';

const tabs = [
  { to: '/', label: '每日推荐' },
  { to: '/gallery', label: '电影海报' },
  { to: '/quotes', label: '经典台词' },
  { to: '/analyses', label: '经典解析' },
  { to: '/contact', label: '联系我们' },
];

export default function Layout() {
  const { user, loading, openAuth, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      {/* 顶部导航：品牌在左，标签靠右上角一字排开 */}
      <header className="topnav">
        <div className="brand">
          经典<em>电影</em>推荐
          <small>DAILY CINEMA</small>
        </div>

        {/* 右上角登录/用户区 */}
        <div className="auth-zone">
          {loading ? null : user ? (
            <>
              {user.role === 'admin' && (
                <button className="auth-btn" onClick={() => navigate('/admin')}>
                  后台
                </button>
              )}
              <span className="auth-user" title={user.email || ''}>
                {user.username}
              </span>
              <button className="auth-btn" onClick={() => logout()}>
                退出
              </button>
            </>
          ) : (
            <>
              <button className="auth-btn" onClick={() => openAuth('login')}>
                登录
              </button>
              <button className="auth-btn solid" onClick={() => openAuth('register')}>
                注册
              </button>
            </>
          )}
        </div>

        {/* 右上角标签区 */}
        <nav>
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="page">
        <Outlet />
      </main>
      <AuthModal />
    </>
  );
}
