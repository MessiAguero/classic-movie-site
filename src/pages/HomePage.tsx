import MovieView from '../components/MovieView';
import { formatDate, getTodayMovie, todayStr } from '../lib/store';
import { Link } from 'react-router-dom';

export default function HomePage() {
  const movie = getTodayMovie();
  const isToday = movie.date === todayStr();

  return (
    <div>
      <div className="daynav">
        <span className="datechip">
          {isToday ? '今日推荐' : '最近推荐'} · {formatDate(movie.date)}
        </span>
        <Link to="/history" className="btn-ghost">
          历史推荐
        </Link>
      </div>
      <MovieView movie={movie} />
    </div>
  );
}
