import { useStaticScene } from '../primitives/useStaticScene';
import { m, useTransform, type MotionValue } from 'motion/react';
import { StickyScene } from '../primitives/StickyScene';
import { GradientText } from '../primitives/GradientText';
import { Node } from '../primitives/Node';
import { Wire } from '../primitives/Wire';

const names = ['Lia', 'Bruno', 'Caio', 'Duda', 'Rafa', 'Nina', 'Téo', 'Mel'];

function Point({ name, index, progress, isStatic }: { name: string; index: number; progress: MotionValue<number>; isStatic: boolean }) {
  const opacity = useTransform(progress, [index / 12, index / 12 + 0.1], [0, 1]);
  return <m.div className="l-connection-point" style={{ left: `${50 + 43 * Math.cos(index * Math.PI / 4)}%`, top: `${50 + 40 * Math.sin(index * Math.PI / 4)}%`, opacity: isStatic ? 1 : opacity }}><Node name={name} /></m.div>;
}

function wirePath(index: number, offset: number) {
  const a = index * Math.PI / 4;
  const b = (index + offset) * Math.PI / 4;
  const middle = (a + b) / 2;
  const controlRadius = offset === 1 ? 185 : 300;
  return `M ${200 + 172 * Math.cos(a)} ${200 + 160 * Math.sin(a)} Q ${200 + controlRadius * Math.cos(middle)} ${200 + controlRadius * Math.sin(middle)} ${200 + 172 * Math.cos(b)} ${200 + 160 * Math.sin(b)}`;
}

function Content({ progress }: { progress: MotionValue<number> }) {
  const reduce = useStaticScene();
  const count = useTransform(progress, value => Math.min(8, Math.max(1, Math.floor(value * 8) + 1)));
  return <div className="l-split">
    <div>
      <h2>Todo mundo junto. <GradientText>Direto.</GradientText></h2>
      <p>Até 8 pessoas por sala. Áudio e tela vão direto entre vocês; o servidor só cuida do login, da conexão e do texto.</p>
      <svg className="l-count" viewBox="0 0 160 200" role="img" aria-label="Até 8 pessoas">
        <defs><linearGradient id="count-gradient"><stop stopColor="#5aa2ff" /><stop offset="1" stopColor="#7b4dff" /></linearGradient></defs>
        <m.text x="50%" y="85%" textAnchor="middle" fill="none" stroke="url(#count-gradient)" strokeWidth="1">{reduce ? 8 : count}</m.text>
      </svg>
    </div>
    <div className="l-network" aria-hidden="true">
      <svg viewBox="0 0 400 400" preserveAspectRatio="none">
        <defs><linearGradient id="wire-gradient"><stop stopColor="#5aa2ff" /><stop offset="1" stopColor="#7b4dff" /></linearGradient></defs>
        {names.flatMap((_, i) => [1, 3].map(offset => <Wire key={`${i}-${offset}`} d={wirePath(i, offset)} progress={progress} isStatic={reduce} />))}
      </svg>
      {names.map((name, i) => <Point key={name} name={name} index={i} progress={progress} isStatic={reduce} />)}
      <div className="l-server"><span className="l-server-circle" />Voz e tela não passam por aqui</div>
    </div>
  </div>;
}
export function Connection() { return <StickyScene className="l-connection">{progress => <Content progress={progress} />}</StickyScene>; }
