import { Link, Navigate, useParams } from 'react-router-dom';
import MovieView from '../components/MovieView';
import { formatDate, getMovieById, getNeighbors } from '../lib/store';

export default function MoviePage() {
  const { id } = useParams();
  if (!id) return <Navigate to="/" replace />;
  const movie = getMovieById(id);
  if (!movie) return <Navigate to="/" replace />;
  const { prev, next } = getNeighbors(movie.id);

  return (
    <div>
      <div className="daynav">
        {next ? (
          <Link to={`/daily/${next.id}`} className="btn-ghost">
            ← {next.zhTitle}
          </Link>
        ) : (
          <span />
        )}
        <span className="datechip">{formatDate(movie.date)}</span>
        <Link to="/history" className="btn-ghost">
          历史推荐
        </Link>
        {prev ? (
          <Link to={`/daily/${prev.id}`} className="btn-ghost">
            {prev.zhTitle} →
          </Link>
        ) : (
          <span />
        )}
      </div>
      <MovieView movie={movie} />
    </div>
  );
}
