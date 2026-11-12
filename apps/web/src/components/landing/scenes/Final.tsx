import { useStaticScene } from '../primitives/useStaticScene';
import Link from 'next/link';
import { m, useTransform, type MotionValue } from 'motion/react';
import { StickyScene } from '../primitives/StickyScene';
import { ScaleField } from '../primitives/ScaleField';
import { BrandButton } from '../primitives/BrandButton';
function Content({
  progress
}: {
  progress: MotionValue<number>;
}) {
  const reduce = useStaticScene();
  const scale = useTransform(progress, [0, 1], [1.8, 1]);
  const opacity = useTransform(progress, [0, .6], [.1, 1]);
  return <>
    <ScaleField progress={reduce ? undefined : progress} reverse />
    <div className="l-final-copy">
      <m.img src="/logo.png" alt="" style={reduce ? undefined : {
        scale,
        opacity
      }} />
      <h2>Gratuito. É só criar a sala e mandar o link.</h2>
      <div>
        <BrandButton href="/register">Criar minha sala</BrandButton>
        <Link href="/login">Já tenho conta</Link>
      </div>
    </div>
  </>;
}
export function Final() {
  return <StickyScene className="l-final">{p => <Content progress={p} />}</StickyScene>;
}
