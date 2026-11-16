import { useMediaQuery, useStaticScene } from './useStaticScene';
import { useId } from 'react';
import { m, useTransform, type MotionValue } from 'motion/react';

const COLUMNS = 10;
const ROWS = 8;

function OpeningScale({ index, radius, progress, gradientId }: {
  index: number;
  radius: number;
  progress: MotionValue<number>;
  gradientId: string;
}) {
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const distance = Math.hypot((column - 4.5) / 4.5, (row - 3.5) / 3.5) / Math.SQRT2;
  const start = 0.35 + distance * 0.27;
  const end = start + 0.18;
  const wave = useTransform(progress, [start, end], [0, 1]);
  const rotation = useTransform(wave, [0, 1], [0, index % 2 ? 25 : -25]);
  const scale = useTransform(wave, [0, 1], [1, 0]);
  const opacity = useTransform(wave, [0, 1], [1, 0]);
  const x = column * 2 * radius + (row % 2 ? radius : 0);
  const y = row * radius / 2;
  const shape = `M0,0 A${radius} ${radius} 0 0 0 ${2 * radius},0 Z`;

  return <g transform={`translate(${x} ${y})`}>
    <m.path d={shape} fill={`url(#${gradientId})`} fillOpacity="0.16" stroke="rgba(120,150,255,.5)" strokeWidth="1" style={{ rotate: rotation, scale, opacity, transformOrigin: `${radius}px 0px` }} />
  </g>;
}

function Pattern({ id, radius }: { id: string; radius: number }) {
  const shape = `M0,0 A${radius} ${radius} 0 0 0 ${2 * radius},0 Z`;
  return <pattern id={id} patternUnits="userSpaceOnUse" width={2 * radius} height={radius}>
    <g fill="var(--l-bg)" stroke="rgba(120,150,255,.28)" strokeWidth="1">
      <path d={shape} />
      <path d={shape} transform={`translate(${radius} ${radius / 2})`} />
      <path d={shape} transform={`translate(${-radius} ${radius / 2})`} />
      <path d={shape} transform={`translate(0 ${-radius})`} />
      <path d={shape} transform={`translate(${radius} ${-radius / 2})`} />
      <path d={shape} transform={`translate(${-radius} ${-radius / 2})`} />
    </g>
  </pattern>;
}

export function ScaleField({ progress, reverse = false }: {
  progress?: MotionValue<number>;
  reverse?: boolean;
}) {
  const isStatic = useStaticScene();
  const mobile = useMediaQuery('(max-width: 767px)');
  const id = useId().replace(/:/g, '');
  const desktopPattern = `scales-${id}-desktop`;
  const mobilePattern = `scales-${id}-mobile`;
  const gradient = `scales-${id}-gradient`;
  return <svg className="l-scales" width="100%" height="100%" aria-hidden="true">
    <defs>
      <Pattern id={desktopPattern} radius={32} />
      <Pattern id={mobilePattern} radius={22} />
      <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#5aa2ff" />
        <stop offset="1" stopColor="#7b4dff" />
      </linearGradient>
    </defs>
    <rect className="l-scales-desktop" width="100%" height="100%" fill={`url(#${desktopPattern})`} />
    <rect className="l-scales-mobile" width="100%" height="100%" fill={`url(#${mobilePattern})`} />
    {progress && !reverse && !isStatic && (mobile ?
      <svg className="l-scales-opening" x="50%" y="50%" width="484" height="110" viewBox="0 0 484 110">
        {Array.from({ length: 60 }, (_, index) => <OpeningScale key={index} index={index} radius={22} progress={progress} gradientId={gradient} />)}
      </svg> :
      <svg className="l-scales-opening" x="50%" y="50%" width="704" height="160" viewBox="0 0 704 160">
        {Array.from({ length: COLUMNS * ROWS }, (_, index) => <OpeningScale key={index} index={index} radius={32} progress={progress} gradientId={gradient} />)}
      </svg>)}
  </svg>;
}
