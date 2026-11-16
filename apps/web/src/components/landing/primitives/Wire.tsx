import { m, type MotionValue } from 'motion/react';
export function Wire({
  d,
  progress,
  isStatic = false
}: {
  d: string;
  progress: MotionValue<number>;
  isStatic?: boolean;
}) {
  return <m.path d={d} fill="none" stroke="url(#wire-gradient)" strokeWidth="1" style={{
    pathLength: isStatic ? 1 : progress
  }} />;
}
