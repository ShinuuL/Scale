import { useRef, type ReactNode } from 'react';
import { useScroll, type MotionValue } from 'motion/react';
export function StickyScene({
  className = '',
  children
}: {
  className?: string;
  children: (progress: MotionValue<number>) => ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const {
    scrollYProgress
  } = useScroll({
    target: ref,
    offset: ['start start', 'end end']
  });
  return <section ref={ref} className={`l-scene ${className}`}>
    <div className="l-sticky">
      {children(scrollYProgress)}
    </div>
  </section>;
}
