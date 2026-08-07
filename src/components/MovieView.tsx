import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cleanQuoteText } from '../lib/cleanQuote';
import { formatDate } from '../lib/store';
import type { Movie } from '../types';
import RatingCard from './RatingCard';
import Reveal from './Reveal';

function SectionHead({ idx, title }: { idx: string; title: string }) {
  return (
    <div className="sec-head">
      <span className="idx">{idx}</span>
      <h2>{title}</h2>
      <span className="rule" />
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return <div className="sec-card">{children}</div>;
}

/** B 站风格每日推荐页 */
export default function MovieView({ movie }: { movie: Movie }) {
  const [ratingsOn, setRatingsOn] = useState(false);
  let sec = 1;
  const nextIdx = () => String(sec++).padStart(2, '0');

  return (
    <article>
      {/* ===== HERO 横幅 ===== */}
      <section className="hero">
        <div className="hero-card">
          {movie.posterSvg && (
            <div className="hero-poster">
              <div dangerouslySetInnerHTML={{ __html: movie.posterSvg }} />
            </div>
          )}
          <div className="hero-info">
            {movie.year && <span className="year-badge">{movie.year}</span>}
            {movie.enTitle && <div className="en">{movie.enTitle}</div>}
            <h1>{movie.zhTitle}</h1>
            {movie.meta && <div className="meta">{movie.meta}</div>}
            {movie.tagline && <div className="tag">{movie.tagline}</div>}
            {movie.ratings.length > 0 && (
              <div className="hero-ratings">
                {movie.ratings.slice(0, 4).map((r) => (
                  <span className="chip" key={r.source}>
                    <b>{r.source}</b>
                    <span>{r.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="wrap">
        {/* ===== 01 口碑与评分 ===== */}
        {movie.ratings.length > 0 && (
          <Reveal className="sec" onVisible={() => setRatingsOn(true)}>
            <SectionCard>
              <SectionHead idx={nextIdx()} title="口碑与评分" />
              <div className="ratings">
                {movie.ratings.map((r) => (
                  <RatingCard key={r.source} rating={r} active={ratingsOn} />
                ))}
              </div>
            </SectionCard>
          </Reveal>
        )}

        {/* ===== 02 剧情梗概 ===== */}
        {movie.plot.length > 0 && (
          <Reveal className="sec">
            <SectionCard>
              <SectionHead idx={nextIdx()} title="剧情梗概" />
              <div className="plot">
                {movie.plot.map((p, i) => (
                  <p key={i} className={i === 0 ? 'first' : ''}>
                    {p}
                  </p>
                ))}
                {movie.spoilerNote && <div className="nospoiler">◆ {movie.spoilerNote}</div>}
              </div>
            </SectionCard>
          </Reveal>
        )}

        {/* ===== 03 六大亮点 ===== */}
        {movie.highlights.length > 0 && (
          <Reveal className="sec">
            <SectionCard>
              <SectionHead idx={nextIdx()} title="六大亮点" />
              <div className="cards">
                {movie.highlights.map((h, i) => (
                  <div className="card" key={i}>
                    {h.ic && <div className="ic">{h.ic}</div>}
                    {h.title && <h3>{h.title}</h3>}
                    {h.body && <p>{h.body}</p>}
                  </div>
                ))}
              </div>
            </SectionCard>
          </Reveal>
        )}

        {/* ===== 经典台词 ===== */}
        {movie.quotes.length > 0 && (
          <Reveal className="quote">
            <div className="quote-inner">
              {movie.quotes.map((q, i) => (
                <div key={i}>
                  <blockquote>{cleanQuoteText(q.text)}</blockquote>
                  {q.who && <div className="who">— {q.who}</div>}
                </div>
              ))}
            </div>
          </Reveal>
        )}

        {/* ===== 04 为什么值得一看 ===== */}
        {movie.why.length > 0 && (
          <Reveal className="sec">
            <SectionCard>
              <SectionHead idx={nextIdx()} title="为什么值得一看" />
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
            </SectionCard>
          </Reveal>
        )}

        {/* ===== 05 荣誉与地位 ===== */}
        {movie.honors.length > 0 && (
          <Reveal className="sec">
            <SectionCard>
              <SectionHead idx={nextIdx()} title="荣誉与地位" />
              <div className="honors">
                {movie.honors.map((h, i) => (
                  <span className={`tag-pill ${i < 3 ? 'hot' : ''}`} key={i}>
                    {h}
                  </span>
                ))}
              </div>
            </SectionCard>
          </Reveal>
        )}

        {/* ===== 06 影片档案 ===== */}
        {movie.archive.length > 0 && (
          <Reveal className="sec">
            <SectionCard>
              <SectionHead idx={nextIdx()} title="影片档案" />
              <table className="archive">
                <tbody>
                  {movie.archive.map((row) => (
                    <tr key={row.k}>
                      <td className="k">{row.k}</td>
                      <td className="v">{row.v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          </Reveal>
        )}

        {/* ===== 07 编辑评语 ===== */}
        {movie.review && (
          <Reveal className="sec">
            <SectionCard>
              <SectionHead idx={nextIdx()} title="编辑评语" />
              <div className="review">
                <div className="stars">{'★'.repeat(Math.max(1, movie.reviewStars || 5))}</div>
                <p>{movie.review}</p>
                <div className="by">— {movie.reviewBy || '经典电影推荐 · 每日一部'}</div>
              </div>
            </SectionCard>
          </Reveal>
        )}
      </div>

      <footer>
        <div className="fmark">经典电影推荐</div>
        <br />
        每日一部公认经典 · 评分高 · 口碑好 · 不剧透
        <br />
        {formatDate(movie.date)} ·{' '}
        <Link to="/history">历史推荐</Link>
      </footer>
    </article>
  );
}
