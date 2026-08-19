"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Scroll-triggered fade/rise-in wrapper, matching the mockups' `.reveal` /
 * `.reveal.in` IntersectionObserver pattern. The `.reveal`/`.reveal.in`
 * transition itself lives in app/eos-design/tokens.css.
 */
export default function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Generous threshold/margin so a fast or "jumped" scroll (Page Down, End
    // key, flick gestures) can't skip an element's intersecting frame
    // entirely and leave it permanently at opacity:0.
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0, rootMargin: "200px 0px 200px 0px" });

    io.observe(el);

    // Safety net: if the element is already on-screen (or was scrolled past
    // before the observer attached) by the next frame, reveal it directly.
    const rectCheck = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        setVisible(true);
      }
    });

    return () => {
      io.disconnect();
      cancelAnimationFrame(rectCheck);
    };
  }, []);

  return (
    <div ref={ref} className={`reveal ${visible ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}s` }}>
      {children}
    </div>
  );
}
