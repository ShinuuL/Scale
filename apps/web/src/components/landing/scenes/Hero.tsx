import { useStaticScene } from '../primitives/useStaticScene';
import { useRef, useState, type FormEvent } from 'react';
import { m, useInView, useMotionValue, useMotionValueEvent, useSpring, useTransform, type MotionValue } from 'motion/react';
import { ScaleField } from '../primitives/ScaleField';
import { GradientText } from '../primitives/GradientText';
import { BrandButton } from '../primitives/BrandButton';
import { StickyScene } from '../primitives/StickyScene';
import { DURATION, SPRING_MOUSE } from '../motion';
export function Hero({
  onContinueAsGuest,
  onJoinRoom
}: {
  onContinueAsGuest: () => void;
  onJoinRoom: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduce = useStaticScene();
  const mx = useMotionValue(0),
    my = useMotionValue(0);
  const x = useSpring(mx, SPRING_MOUSE),
    y = useSpring(my, SPRING_MOUSE);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (code.trim()) onJoinRoom(code.trim());
  }
  return <StickyScene className="l-hero">
    {(progress: MotionValue<number>) => <HeroContent progress={progress} x={x} y={y} inView={inView} reduce={!!reduce} refProp={ref} onMove={e => {
      if (!reduce && window.matchMedia('(hover: hover)').matches) {
        mx.set((e.clientX / window.innerWidth - .5) * 18);
        my.set((e.clientY / window.innerHeight - .5) * 18);
      }
    }} submit={submit} code={code} setCode={setCode} onGuest={onContinueAsGuest} />}
  </StickyScene>;
}
function HeroContent({
  progress,
  x,
  y,
  inView,
  reduce,
  refProp,
  onMove,
  submit,
  code,
  setCode,
  onGuest
}: {
  progress: MotionValue<number>;
  x: MotionValue<number>;
  y: MotionValue<number>;
  inView: boolean;
  reduce: boolean;
  refProp: React.RefObject<HTMLDivElement | null>;
  onMove: React.MouseEventHandler<HTMLDivElement>;
  submit: React.FormEventHandler;
  code: string;
  setCode: (s: string) => void;
  onGuest: () => void;
}) {
  const scale = useTransform(progress, [0, 0.35, 0.8], [1, 1.8, 3]);
  const opacity = useTransform(progress, [0, 0.35, 0.8], [1, 1, 0]);
  const artX = useTransform(progress, [0, 0.35], ['70%', '0%']);
  const copyY = useTransform(progress, [0, 0.35], [0, -40]);
  const copyOpacity = useTransform(progress, [0, 0.35], [1, 0]);
  const fieldOpacity = useTransform(progress, [0, 0.25, 0.35], [0, 0.8, 1]);
  const [copyHidden, setCopyHidden] = useState(false);
  useMotionValueEvent(copyOpacity, 'change', value => setCopyHidden(!reduce && value < 0.05));
  const hidden = !reduce && copyHidden;
  const nextOpacity = useTransform(progress, [0.8, 1], [0, 1]);
  return <div className="l-hero-inner" ref={refProp} onMouseMove={onMove}>
    <m.div className="l-hero-field" style={{ opacity: reduce ? 1 : fieldOpacity }}><ScaleField progress={reduce ? undefined : progress} /></m.div>
    <m.div className="l-hero-art" style={reduce ? undefined : {
      scale,
      opacity,
      x: artX
    }}>
      <m.div className="l-hero-parallax" style={reduce ? undefined : { x, y }}>
      <div className="l-halo" />
      <img src="/logo.png" alt="" className="l-hero-logo" />
      {[1, 2, 3].map(i => <m.span key={i} className={`l-logo-node l-logo-node-${i}`} animate={inView && !reduce ? {
        opacity: [0.5, 1, 0.5],
        scale: [0.8, 1.2, 0.8]
      } : {
        opacity: 1
      }} transition={{
        duration: DURATION.loop,
        repeat: Infinity,
        delay: i * DURATION.stagger
      }} />)}
      </m.div>
    </m.div>
    <m.div className="l-hero-copy" inert={hidden || undefined} style={reduce ? undefined : { y: copyY, opacity: copyOpacity, pointerEvents: hidden ? 'none' : 'auto' }}>
      <h1>
        <span className="sr-only">Chama a turma. Abre a sala.</span>
        <span aria-hidden="true">Chama a turma.<br /><GradientText>Abre a sala.</GradientText></span>
      </h1>
      <p>Voz, tela e conversa num link só. Até 8 pessoas, direto pelo navegador. Quem recebe o link entra sem conta. Gratuito.</p>
      <BrandButton href="/register">Criar minha sala</BrandButton>
      <form onSubmit={submit} className="l-code">
        <p className="l-code-prompt">Recebeu um código?</p>
        <label htmlFor="landing-code">Código da sala</label>
        <div>
          <input id="landing-code" placeholder="Código da sala" value={code} onChange={e => setCode(e.target.value)} />
          <button type="submit" disabled={!code.trim()}>Entrar na sala</button>
        </div>
      </form>
      <button className="l-guest" onClick={onGuest}>Continuar como convidado</button>
    </m.div>
    <m.div className="l-hero-next" aria-hidden="true" style={{ opacity: reduce ? 0 : nextOpacity }}>Todo mundo junto. <GradientText>Direto.</GradientText></m.div>
  </div>;
}
