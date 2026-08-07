import { Link, Navigate, useParams } from 'react-router-dom';
import { formatDate, getMovieById } from '../lib/store';

export default function AnalysisDetailPage() {
  const { id } = useParams();
  if (!id) return <Navigate to="/analyses" replace />;
  const movie = getMovieById(id);
  if (!movie) return <Navigate to="/analyses" replace />;

  return (
    <div className="analyses">
      <div className="daynav">
        <Link to="/analyses" className="btn-ghost">
          ← 全部解析
        </Link>
        <span className="datechip">{formatDate(movie.date)}</span>
        <Link to={`/daily/${movie.id}`} className="btn-ghost">
          查看推荐页 →
        </Link>
      </div>

      <div style={{ height: 40 }} />
      <div className="review">
        <div className="stars">{'★'.repeat(Math.max(1, movie.reviewStars || 5))}</div>
        <p>{movie.review}</p>
        <div className="by">— {movie.reviewBy || '经典电影推荐 · 每日一部'}</div>
      </div>

      {movie.why.length > 0 && (
        <section className="sec">
          <div className="sec-head">
            <span className="idx">01</span>
            <h2>为什么值得一看</h2>
            <span className="rule" />
          </div>
          <div className="why">
            {movie.why.map((w, i) => (
              <div className="why-item" key={i}>
                {w.no && <div className="no">{w.no}</div>}
                <div>
                  {w.title && <h4>{w.title}</h4>}
                  <p>{w.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {movie.highlights.length > 0 && (
        <section className="sec">
          <div className="sec-head">
            <span className="idx">02</span>
            <h2>六大亮点</h2>
            <span className="rule" />
          </div>
          <div className="cards">
            {movie.highlights.map((h, i) => (
              <div className="card" key={i}>
                {h.ic && <div className="ic">{h.ic}</div>}
                {h.title && <h3>{h.title}</h3>}
                {h.body && <p>{h.body}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {movie.honors.length > 0 && (
        <section className="sec">
          <div className="sec-head">
            <span className="idx">03</span>
            <h2>荣誉与地位</h2>
            <span className="rule" />
          </div>
          <div className="honors">
            {movie.honors.map((h, i) => (
              <span className={`tag-pill ${i < 3 ? 'hot' : ''}`} key={i}>
                {h}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
