"use client";

import { useEffect, useState } from "react";

/** Mirrors the mockups' `nav.scrolled` toggle: window.scrollY > 8. */
export function useNavScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return scrolled;
}
