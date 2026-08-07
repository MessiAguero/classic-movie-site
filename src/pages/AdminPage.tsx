import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  formatDate,
  resetMovieData,
  saveMovie,
  setMovieStatus,
  useMovies,
} from '../lib/store';
import type { Movie } from '../types';

export default function AdminPage() {
  const { user, loading, openAuth } = useAuth();
  const movies = useMovies();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Movie | null>(null);

  const sorted = useMemo(() => [...movies].sort((a, b) => (a.date < b.date ? 1 : -1)), [movies]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter(
      (m) =>
        m.zhTitle.toLowerCase().includes(query) ||
        (m.enTitle || '').toLowerCase().includes(query) ||
        m.date.includes(query),
    );
  }, [sorted, q]);

  const stats = useMemo(
    () => ({
      total: movies.length,
      published: movies.filter((m) => m.status !== 'draft').length,
      draft: movies.filter((m) => m.status === 'draft').length,
    }),
    [movies],
  );

  if (loading) {
    return (
      <div className="admin">
        <div className="page-title">
          <h1>后台管理</h1>
          <p>正在加载…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="admin">
        <div className="page-title">
          <h1>后台管理</h1>
          <p>请先登录管理员账号</p>
        </div>
        <div className="admin-gate">
          <button className="auth-submit" onClick={() => openAuth('login')}>
            前往登录
          </button>
          <p className="admin-hint">本地演示模式默认账号：admin / admin123</p>
        </div>
      </div>
    );
  }

  if (user.role !== 'admin') {
    return (
      <div className="admin">
        <div className="page-title">
          <h1>后台管理</h1>
          <p>当前账号无管理员权限</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin">
      <div className="page-title">
        <h1>后台管理</h1>
        <p>
          当前登录：{user.username}（管理员） · 共 {stats.total} 部，已发布 {stats.published}，草稿{' '}
          {stats.draft}
        </p>
      </div>
      <div style={{ height: 40 }} />

      <div className="admin-bar">
        <input
          className="searchbar"
          placeholder="搜索片名 / 年份 / 日期…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="auth-btn solid"
          onClick={() => {
            if (window.confirm('确认恢复全部默认数据？当前本地修改将丢失。')) resetMovieData();
          }}
        >
          恢复默认
        </button>
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>片名</th>
            <th>年份</th>
            <th>评分</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((m) => {
            const top = m.ratings[0] ? `${m.ratings[0].source} ${m.ratings[0].value}` : '—';
            const isDraft = m.status === 'draft';
            return (
              <tr key={m.id} className={isDraft ? 'row-draft' : ''}>
                <td>{formatDate(m.date)}</td>
                <td>
                  <Link to={`/daily/${m.id}`}>{m.zhTitle}</Link>
                  {m.enTitle ? (
                    <div className="admin-sub">{m.enTitle}</div>
                  ) : null}
                </td>
                <td>{m.year || '—'}</td>
                <td>{top}</td>
                <td>
                  <span className={`pill ${isDraft ? 'draft' : 'pub'}`}>
                    {isDraft ? '草稿' : '已发布'}
                  </span>
                </td>
                <td className="admin-ops">
                  <button className="auth-btn" onClick={() => setEditing(m)}>
                    编辑
                  </button>
                  <button
                    className="auth-btn"
                    onClick={() => setMovieStatus(m.id, isDraft ? 'published' : 'draft')}
                  >
                    {isDraft ? '发布' : '下线'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editing && <EditModal movie={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditModal({ movie, onClose }: { movie: Movie; onClose: () => void }) {
  const [zhTitle, setZhTitle] = useState(movie.zhTitle);
  const [enTitle, setEnTitle] = useState(movie.enTitle || '');
  const [year, setYear] = useState(movie.year || '');
  const [tagline, setTagline] = useState(movie.tagline || '');
  const [review, setReview] = useState(movie.review || '');
  const [status, setStatus] = useState<'published' | 'draft'>(movie.status === 'draft' ? 'draft' : 'published');

  const save = () => {
    saveMovie(movie.id, {
      zhTitle: zhTitle.trim() || movie.zhTitle,
      enTitle: enTitle.trim(),
      year: year.trim(),
      tagline: tagline.trim(),
      review: review.trim(),
      status,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
        <div className="modal-title">编辑 · {movie.zhTitle}</div>
        <div className="auth-form">
          <label>
            中文片名
            <input value={zhTitle} onChange={(e) => setZhTitle(e.target.value)} />
          </label>
          <label>
            英文片名
            <input value={enTitle} onChange={(e) => setEnTitle(e.target.value)} />
          </label>
          <label>
            年份
            <input value={year} onChange={(e) => setYear(e.target.value)} />
          </label>
          <label>
            标语
            <input value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </label>
          <label>
            编辑评语
            <textarea rows={5} value={review} onChange={(e) => setReview(e.target.value)} />
          </label>
          <label>
            状态
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'published' | 'draft')}
            >
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
            </select>
          </label>
          <div className="modal-actions">
            <button className="auth-btn" onClick={onClose}>
              取消
            </button>
            <button className="auth-submit" onClick={save}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
