import { useEffect, useRef, type ReactNode } from 'react';

/** 滚动进入视口时渐显 */
export default function Reveal({
  children,
  className = '',
  onVisible,
}: {
  children: ReactNode;
  className?: string;
  onVisible?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            if (!fired.current && onVisible) {
              fired.current = true;
              onVisible();
            }
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onVisible]);

  return (
    <div ref={ref} className={`reveal ${className}`}>
      {children}
    </div>
  );
}
