import { Link } from 'react-router-dom';
import { formatDate, useMovies } from '../lib/store';

export default function AnalysesPage() {
  const movies = useMovies().filter((m) => m.status !== 'draft' && (m.review || m.why.length > 0));

  return (
    <div className="analyses">
      <div className="page-title">
        <h1>经典电影解析</h1>
        <p>{movies.length} 篇深度解析 · 编辑评语与观影价值</p>
      </div>
      <div style={{ height: 50 }} />
      {movies.map((m) => (
        <Link to={`/analyses/${m.id}`} className="a-card" key={m.id}>
          <div className="a-head">
            <h3>{m.zhTitle}</h3>
            {m.year && <span className="a-year">{m.year}</span>}
            <span className="a-date">{formatDate(m.date)}</span>
          </div>
          {m.review && <p>{m.review}</p>}
          <div className="a-tags">
            {m.honors.slice(0, 4).map((h, i) => (
              <span key={i}>{h}</span>
            ))}
            {m.why.length > 0 && <span>{m.why.length} 条观影价值</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}
