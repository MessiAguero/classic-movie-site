import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cleanQuoteText } from '../lib/cleanQuote';
import { formatDate, useMovies } from '../lib/store';
import type { Quote } from '../types';

export default function QuotesPage() {
  const [q, setQ] = useState('');
  const [shuffleKey, setShuffleKey] = useState(0);
  const movies = useMovies();

  const items = useMemo(() => {
    const list: { quote: Quote; movieId: string; zhTitle: string; year?: string; date: string }[] = [];
    for (const m of movies.filter((x) => x.status !== 'draft')) {
      for (const quote of m.quotes) list.push({ quote, movieId: m.id, zhTitle: m.zhTitle, year: m.year, date: m.date });
    }
    const query = q.trim().toLowerCase();
    let result = query
      ? list.filter(
          (i) =>
            i.quote.text.toLowerCase().includes(query) ||
            (i.quote.who || '').toLowerCase().includes(query) ||
            i.zhTitle.toLowerCase().includes(query),
        )
      : list;
    if (shuffleKey > 0) result = [...result].sort(() => (shuffleKey % 2 ? 0.5 - Math.random() : Math.random() - 0.5));
    return result;
  }, [movies, q, shuffleKey]);

  return (
    <div className="quotes-page">
      <div className="page-title">
        <h1>经典台词语录</h1>
        <p>那些值得被反复念起的台词</p>
      </div>
      <div style={{ height: 50 }} />
      <div className="quotes-tools">
        <input
          className="searchbar"
          placeholder="搜索台词 / 电影 / 人物…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button onClick={() => setShuffleKey((k) => k + 1)}>随机</button>
      </div>
      <div className="quotes-grid">
        {items.map((i, idx) => (
          <div className="q-card" key={`${i.movieId}-${idx}`}>
            <p>{cleanQuoteText(i.quote.text)}</p>
            {i.quote.who && <div className="q-who">— {i.quote.who}</div>}
            <div className="q-film">
              <Link to={`/daily/${i.movieId}`}>
                《{i.zhTitle}》{i.year ? ` · ${i.year}` : ''} · {formatDate(i.date)}
              </Link>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="q-empty">没有找到匹配的台词</div>}
      </div>
    </div>
  );
}
