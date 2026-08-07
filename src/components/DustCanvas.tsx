import { useEffect, useRef } from 'react';

/** 沙漠光尘 + 落日余晖粒子背景（移植自原页面） */
export default function DustCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let DPR = 1;
    let raf = 0;

    const resize = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.width = innerWidth * DPR;
      H = cv.height = innerHeight * DPR;
      cv.style.width = `${innerWidth}px`;
      cv.style.height = `${innerHeight}px`;
    };

    resize();
    window.addEventListener('resize', resize);

    const N = Math.round((innerWidth * innerHeight) / 26000);
    const dust = Array.from({ length: N }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: (Math.random() * 2.2 + 0.6) * DPR,
      a: Math.random() * 0.5 + 0.15,
      vy: -(Math.random() * 0.25 + 0.06) * DPR,
      vx: (Math.random() * 0.4 - 0.2) * DPR,
      ph: Math.random() * Math.PI * 2,
      sp: Math.random() * 0.02 + 0.008,
      hue: Math.random() < 0.55 ? '108,172,228' : '30,90,160',
    }));

    const frame = () => {
      ctx.clearRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W * 0.78, H * 0.02, 0, W * 0.78, H * 0.02, H * 0.7);
      g.addColorStop(0, 'rgba(108,172,228,0.16)');
      g.addColorStop(1, 'rgba(108,172,228,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      for (const d of dust) {
        d.ph += d.sp;
        d.y += d.vy;
        d.x += d.vx + Math.sin(d.ph) * 0.18 * DPR;
        if (d.y < -10) { d.y = H + 10; d.x = Math.random() * W; }
        if (d.x < -10) d.x = W + 10;
        if (d.x > W + 10) d.x = -10;
        const pulse = 0.6 + 0.4 * Math.sin(d.ph);
        const rr = d.r * (0.8 + pulse * 0.5);
        const rg = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, rr * 4);
        rg.addColorStop(0, `rgba(${d.hue},${d.a * pulse})`);
        rg.addColorStop(1, `rgba(${d.hue},0)`);
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(d.x, d.y, rr * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas id="fx" ref={ref} />;
}
