import { useStaticScene } from '../primitives/useStaticScene';
import { m, useTransform, type MotionValue } from 'motion/react';
import { StickyScene } from '../primitives/StickyScene';
import { GlassPanel } from '../primitives/GlassPanel';
import { Avatar } from '../primitives/Avatar';
import { GradientText } from '../primitives/GradientText';
const names = ['Lia', 'Bruno', 'Caio', 'Duda', 'Rafa', 'Nina', 'Téo', 'Mel'];
const steps = ['Abre a sala', 'Compartilha a tela', 'Conversa do lado'];
function Participant({ name, index, progress, reduce, sidebar }: {
  name: string; index: number; progress: MotionValue<number>; reduce: boolean; sidebar: boolean;
}) {
  const speaking = useTransform(progress, value => (() => {
    const phase = value * 8;
    const segment = Math.floor(phase);
    const target = segment % 2 === index % 2 ? 1 : 0;
    const t = Math.min(1, (phase - segment) / 0.32);
    return (1 - target) * (1 - t) + target * t;
  })());
  return <div className={sidebar ? 'l-room-side-tile' : 'l-room-tile'}>
    <span className="l-room-avatar-wrap"><Avatar name={name} /><m.span className="l-speaking-ring" style={{ opacity: reduce ? Number(index === 0) : speaking }} /></span>
    <small>{name}</small>
  </div>;
}
function Step({
  label,
  index,
  progress,
  reduce
}: {
  label: string;
  index: number;
  progress: MotionValue<number>;
  reduce: boolean;
}) {
  const opacity = useTransform(progress, value => {
    const fade = (at: number) => Math.max(0, Math.min(1, (value - at) / 0.04));
    if (index === 0) return 1 - fade(0.33);
    if (index === 1) return fade(0.33) * (1 - fade(0.63));
    return fade(0.63);
  });
  return <m.span aria-hidden="true" style={{
    opacity: reduce ? Number(index === 2) : opacity
  }}>
    {label}
  </m.span>;
}
function Content({
  progress
}: {
  progress: MotionValue<number>;
}) {
  const reduce = !!useStaticScene();
  const y = useTransform(progress, [0, 0.3], [120, 0]);
  const rotateX = useTransform(progress, [0, 0.3], [18, 0]);
  const scale = useTransform(progress, [0, 0.3], [0.9, 1]);
  const gridOpacity = useTransform(progress, [0.3, 0.45], [1, 0]);
  const sidebarOpacity = useTransform(progress, [0.4, 0.55], [0, 1]);
  const screenScale = useTransform(progress, [0.3, 0.55], [0.3, 1]);
  const screenX = useTransform(progress, [0.3, 0.55], ['-31%', '0%']);
  const screenOpacity = useTransform(progress, [0.3, 0.34], [0, 1]);
  const chat1 = useTransform(progress, [0.55, 0.65], [0, 1]);
  const chat2 = useTransform(progress, [0.65, 0.75], [0, 1]);
  const chat3 = useTransform(progress, [0.75, 0.85], [0, 1]);
  return <div className="l-room-content">
    <h2>Uma sala. <GradientText>Voz, tela e chat.</GradientText></h2>
    <div className={`l-room-steps ${reduce ? 'is-static' : ''}`}>
      <span className="sr-only">Abre a sala, compartilha a tela e conversa do lado.</span>
      {reduce ? <ol>{steps.map(label => <li key={label}>{label}</li>)}</ol> : steps.map((label, index) => <Step key={label} label={label} index={index} progress={progress} reduce={reduce} />)}
    </div>
    <m.div style={reduce ? undefined : {
      y,
      rotateX,
      scale
    }}>
      <div aria-hidden="true">
        <GlassPanel className="l-room-mock">
          <div className="l-room-top">Sala principal</div>
          <div className="l-room-body">
            <div className="l-room-visual">
              <m.div className="l-room-grid" style={{ opacity: reduce ? 0 : gridOpacity }}>
                {names.map((name, index) => <Participant key={name} name={name} index={index} progress={progress} reduce={reduce} sidebar={false} />)}
              </m.div>
              <m.div className="l-room-sidebar" style={{ opacity: reduce ? 1 : sidebarOpacity }}>
                {names.map((name, index) => <Participant key={name} name={name} index={index} progress={progress} reduce={reduce} sidebar />)}
              </m.div>
              <m.div className="l-screen" style={{
                opacity: reduce ? 1 : screenOpacity,
                scale: reduce ? 1 : screenScale,
                x: reduce ? '0%' : screenX
              }}>
                <span>Tela da Lia</span>
                <div className="l-screen-art">
                  <i />
                  <i />
                  <i />
                </div>
              </m.div>
            </div>
            <div className="l-chat">
              <strong>Conversa</strong>
              <m.p style={{
                opacity: reduce ? 1 : chat1
              }}>Lia <small>Olha essa ideia!</small></m.p>
              <m.p style={{
                opacity: reduce ? 1 : chat2
              }}>Duda <small><b>@Bruno</b> o que acha?</small></m.p>
              <m.p style={{
                opacity: reduce ? 1 : chat3
              }}>Rafa <small className="l-file">ideias.pdf</small></m.p>
            </div>
          </div>
        </GlassPanel>
      </div>
    </m.div>
    <span className="sr-only">Ilustração de uma sala com participantes, tela compartilhada e chat.</span>
  </div>;
}
export function Room() {
  return <StickyScene className="l-room">
    {progress => <Content progress={progress} />}
  </StickyScene>;
}
