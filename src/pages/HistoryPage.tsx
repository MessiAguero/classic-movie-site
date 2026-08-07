import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, useMovies } from '../lib/store';

export default function HistoryPage() {
  const [q, setQ] = useState('');
  const movies = useMovies();
  const all = useMemo(() => movies.filter((m) => m.status !== 'draft'), [movies]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return all;
    return all.filter(
      (m) =>
        m.zhTitle.toLowerCase().includes(query) ||
        (m.enTitle || '').toLowerCase().includes(query) ||
        (m.meta || '').toLowerCase().includes(query) ||
        m.date.includes(query),
    );
  }, [all, q]);

  return (
    <div className="history">
      <div className="page-title">
        <h1>历史推荐</h1>
        <p>共 {all.length} 部 · 每日一部经典</p>
      </div>
      <div style={{ height: 40 }} />
      <input
        className="searchbar"
        placeholder="搜索片名 / 年份 / 导演…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>片名</th>
            <th>年份</th>
            <th>评分</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((m) => {
            const top = m.ratings[0] ? `${m.ratings[0].source} ${m.ratings[0].value}` : '—';
            return (
              <tr key={m.id}>
                <td style={{ color: 'var(--ink-dim)', letterSpacing: '0.1em' }}>{formatDate(m.date)}</td>
                <td>
                  <Link to={`/daily/${m.id}`} className="td-title">
                    {m.zhTitle}
                  </Link>
                  {m.enTitle ? (
                    <div style={{ fontSize: 12, color: 'var(--ink-dim)', letterSpacing: '0.06em' }}>
                      {m.enTitle}
                    </div>
                  ) : null}
                </td>
                <td className="td-year">{m.year || '—'}</td>
                <td style={{ color: 'var(--gold)' }}>{top}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {filtered.length === 0 && <p style={{ textAlign: 'center', marginTop: 40, color: 'var(--ink-dim)' }}>未找到匹配的电影</p>}
    </div>
  );
}
