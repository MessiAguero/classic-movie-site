import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import rawGallery from '../data/gallery.json';
import { cleanQuoteText } from '../lib/cleanQuote';
import { formatDate, getMovieById } from '../lib/store';

interface GalleryItem {
  id: string;
  zhTitle: string;
  enTitle?: string;
  year?: string;
  imageUrl: string;
  title?: string;
}

const gallery = rawGallery as GalleryItem[];

export default function PosterPage() {
  const { id } = useParams();
  const [imgFailed, setImgFailed] = useState(false);
  if (!id) return <Navigate to="/gallery" replace />;

  const item = gallery.find((g) => g.id === id);
  const movie = getMovieById(id);
  if (!item || !movie) return <Navigate to="/gallery" replace />;

  const quotes = movie.quotes.map((q) => cleanQuoteText(q.text)).filter(Boolean);

  return (
    <div className="poster-page">
      <div className="poster-card">
        <div className="poster-art">
          {!imgFailed && item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={`${movie.zhTitle} 海报`}
              onError={() => setImgFailed(true)}
            />
          ) : movie.posterSvg ? (
            <div dangerouslySetInnerHTML={{ __html: movie.posterSvg }} />
          ) : (
            <div className="g-fallback">{movie.zhTitle.slice(0, 1)}</div>
          )}
        </div>

        <div className="poster-info">
          <div className="p-nav">
            <Link to="/gallery" className="btn-ghost">
              ← 全部海报
            </Link>
            <span className="p-date">{formatDate(movie.date)}</span>
          </div>

          {movie.year && <span className="p-year">{movie.year}</span>}
          <h1>{movie.zhTitle}</h1>
          {movie.enTitle && <div className="p-en">{movie.enTitle}</div>}
          {movie.meta && <div className="p-meta">{movie.meta}</div>}
          {movie.tagline && <div className="p-tagline">{movie.tagline}</div>}

          <div className="p-quotes">
            <h2>经典语录</h2>
            {quotes.length > 0 ? (
              quotes.map((q, i) => (
                <div className="p-quote" key={i}>
                  <span className="p-q-mark">“</span>
                  <p>{q}</p>
                  {movie.quotes[i]?.who && <div className="p-q-who">— {movie.quotes[i].who}</div>}
                </div>
              ))
            ) : (
              <p className="p-noquote">本片暂无收录语录</p>
            )}
          </div>

          <div className="p-actions">
            <Link to={`/daily/${movie.id}`} className="auth-submit" style={{ width: 'auto', padding: '10px 26px', textDecoration: 'none' }}>
              查看每日推荐
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
