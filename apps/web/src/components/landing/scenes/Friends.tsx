import { useStaticScene } from '../primitives/useStaticScene';
import { useEffect, useRef, useState } from 'react';
import { m, useInView } from 'motion/react';
import { GlassPanel } from '../primitives/GlassPanel';
import { Avatar } from '../primitives/Avatar';
import { GradientText } from '../primitives/GradientText';
import { DURATION, EASE_OUT } from '../motion';

export function Friends() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref);
  const reduce = useStaticScene();
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    if (!inView || reduce || answered) return;
    const timer = window.setTimeout(() => setAnswered(true), 1500);
    return () => window.clearTimeout(timer);
  }, [inView, reduce, answered]);
  const isAnswered = !!reduce || answered;
  return <section className="l-friends l-section" ref={ref}>
    <div>
      <h2>Liga pros <GradientText>amigos.</GradientText></h2>
      <p>Amigos, mensagens diretas e chamadas com toque.</p>
    </div>
    <m.div animate={reduce ? undefined : { scale: isAnswered ? 1 : 0.88 }} transition={{ duration: DURATION.entrance, ease: EASE_OUT }}>
      <GlassPanel className={`l-call ${isAnswered ? 'l-call-answered' : ''}`}>
        <div className="l-call-people" aria-hidden="true">
          <div className="l-call-orbit">
            {[0, 1, 2].map(index => <m.span key={index} animate={inView && !reduce && !answered ? { scale: [0.5, 1.5], opacity: [0.7, 0] } : { opacity: 0 }} transition={{ duration: DURATION.loop, delay: index * 0.4, repeat: Infinity }} />)}
            <Avatar name="Lia" />
          </div>
          {isAnswered && <div className="l-call-peer"><Avatar name="Você" /><span>Você</span></div>}
        </div>
        <strong>{isAnswered ? 'Lia atendeu' : 'Chamando Lia…'}</strong>
      </GlassPanel>
    </m.div>
  </section>;
}
