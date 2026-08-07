import { useEffect, useRef, useState } from 'react';
import { ratingPercent } from '../lib/store';
import type { Rating } from '../types';

function animateValue(to: number, dec: number, suffix: string, cb: (s: string) => void) {
  const dur = 1500;
  const st = performance.now();
  const step = (t: number) => {
    let p = Math.min((t - st) / dur, 1);
    p = 1 - Math.pow(1 - p, 3);
    const cur = to * p;
    cb(`${cur.toFixed(dec)}${suffix}`);
    if (p < 1) requestAnimationFrame(step);
    else cb(`${to.toFixed(dec)}${suffix}`);
  };
  requestAnimationFrame(step);
}

export default function RatingCard({ rating, active = true }: { rating: Rating; active?: boolean }) {
  const [text, setText] = useState('0');
  const started = useRef(false);
  const value = rating.value || '';
  const m = value.match(/(\d+(?:\.\d+)?)/);
  const num = m ? parseFloat(m[1]) : 0;
  const dec = value.includes('.') ? 1 : 0;
  const suffix = value.includes('%') ? '%' : value.includes('/100') ? '' : '';
  const bar = ratingPercent(value);

  useEffect(() => {
    if (started.current || !active) return;
    started.current = true;
    animateValue(num, dec, suffix, setText);
  }, [active, num, dec, suffix]);

  return (
    <div className="rate">
      <div className="lab">{rating.source}</div>
      <div className="num">
        {text}
        {value.includes('/10') || value.includes('/100') ? <small>/10</small> : null}
      </div>
      <div className="bar">
        <i style={{ width: `${bar}%` }} />
      </div>
      {rating.sub ? <div className="sub">{rating.sub}</div> : null}
    </div>
  );
}
