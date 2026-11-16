import { useStaticScene } from '../primitives/useStaticScene';
import { useRef, useState, useEffect } from 'react';
import { m, useTransform, type MotionValue } from 'motion/react';
import { StickyScene } from '../primitives/StickyScene';
import { GlassPanel } from '../primitives/GlassPanel';
import { GradientText } from '../primitives/GradientText';
const cards = [['#', 'geral', 'Texto'], ['#', 'clipes', 'Texto'], ['◉', 'Sala principal', 'Voz'], ['◉', 'Jogatina', 'Voz'], ['◇', 'Cargos', 'Dono / Moderação / Membro'], ['↗', 'Convite', 'Só entra quem você chamar']];
function Content({
  progress
}: {
  progress: MotionValue<number>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);
  const reduce = useStaticScene();
  useEffect(() => {
    const measure = () => {
      if (ref.current) setDistance(Math.max(0, ref.current.scrollWidth - ref.current.clientWidth));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ref.current) {
      observer?.observe(ref.current);
      if (ref.current.firstElementChild) observer?.observe(ref.current.firstElementChild);
    }
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const x = useTransform(progress, [0, 1], [0, -distance]);
  return <div className="l-community-inner">
    <div className="l-community-copy">
      <h2>Sua comunidade, <GradientText>do seu jeito.</GradientText></h2>
      <p>Canais de texto e voz, cargos com cor e permissões, entrada só por convite.</p>
    </div>
    <div className="l-track-viewport" ref={ref}>
      <m.div className="l-track" style={reduce ? undefined : {
        x
      }}>
        {cards.map(([icon, title, sub]) => <GlassPanel className="l-community-card" key={title}>
          <span className="l-card-icon" aria-hidden="true">
            {icon}
          </span>
          <strong>
            {title}
          </strong>
          <small>
            {sub}
          </small>
        </GlassPanel>)}
      </m.div>
    </div>
  </div>;
}
export function Community() {
  return <StickyScene className="l-community">
    {p => <Content progress={p} />}
  </StickyScene>;
}
