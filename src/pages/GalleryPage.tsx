import { useState } from 'react';
import { Link } from 'react-router-dom';
import rawGallery from '../data/gallery.json';
import { useMovies } from '../lib/store';
import type { Movie } from '../types';

interface GalleryItem {
  id: string;
  zhTitle: string;
  enTitle?: string;
  year?: string;
  imageUrl: string;
  title?: string;
}

const gallery = rawGallery as GalleryItem[];

export default function GalleryPage() {
  const movies = useMovies().filter((m) => m.status !== 'draft');
  const [failed, setFailed] = useState<Set<string>>(new Set());

  const byId = new Map<string, Movie>(movies.map((m) => [m.id, m]));
  const items = gallery
    .filter((g) => byId.has(g.id))
    .map((g) => ({ gallery: g, movie: byId.get(g.id)! }));

  const markFailed = (id: string) =>
    setFailed((prev) => new Set(prev).add(id));

  return (
    <div className="gallery">
      <div className="page-title">
        <h1>电影海报</h1>
        <p>{items.length} 部电影经典海报 · 点击查看电影详情</p>
      </div>
      <div style={{ height: 30 }} />
      <div className="gallery-grid">
        {items.map(({ gallery: g, movie }) => (
          <Link to={`/gallery/${movie.id}`} className="g-card" key={movie.id}>
            <div className="g-art">
              {!failed.has(movie.id) && g.imageUrl ? (
                <img
                  src={g.imageUrl}
                  alt={`${g.zhTitle} 海报`}
                  loading="lazy"
                  onError={() => markFailed(movie.id)}
                />
              ) : movie.posterSvg ? (
                <div
                  style={{ width: '100%', height: '100%' }}
                  dangerouslySetInnerHTML={{ __html: movie.posterSvg }}
                />
              ) : (
                <div className="g-fallback">{movie.zhTitle.slice(0, 1)}</div>
              )}
            </div>
            <div className="g-meta">
              <h3>{movie.zhTitle}</h3>
              <span>
                {movie.year ? `${movie.year} · ` : ''}
                {movie.enTitle || '经典电影'}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
