import { useStaticScene } from '../primitives/useStaticScene';
import { m } from 'motion/react';
import { GlassPanel } from '../primitives/GlassPanel';
import { GradientText } from '../primitives/GradientText';
import { DURATION, EASE_OUT } from '../motion';
export function Platforms() {
  const reduce = useStaticScene();
  const url = process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL;
  const cards = [['No navegador', 'Sem instalar'], ['Instalado como app', 'PWA'], ...(url?.startsWith('https://') ? [['No Windows', 'Baixar para Windows', url]] : [])];
  return <section className="l-platforms l-section">
    <h2>Encontre sua turma <GradientText>onde estiver.</GradientText></h2>
    <div className="l-platform-grid">
      {cards.map(([title, sub, href], i) => <m.div key={title} initial={reduce ? false : {
        opacity: 0,
        y: 25
      }} whileInView={{
        opacity: 1,
        y: 0
      }} viewport={{
        once: true
      }} transition={{
        duration: DURATION.entrance,
        delay: i * DURATION.stagger,
        ease: EASE_OUT
      }}>
        <GlassPanel className="l-platform-card">
          <span className="l-platform-symbol" aria-hidden="true">
            {i === 0 ? '◎' : i === 1 ? '▣' : '▦'}
          </span>
          <h3>
            {title}
          </h3>
          {href ? <a href={href}>{sub} →</a> : <p>
            {sub}
          </p>}
        </GlassPanel>
      </m.div>)}
    </div>
  </section>;
}
