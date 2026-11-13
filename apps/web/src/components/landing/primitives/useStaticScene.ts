import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function useStaticScene() {
  const reduced = useReducedMotion();
  const shortViewport = useMediaQuery('(max-height: 639px)');
  return !!reduced || shortViewport;
}
