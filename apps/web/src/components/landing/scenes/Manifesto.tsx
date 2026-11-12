import { useStaticScene } from '../primitives/useStaticScene';
import { Fragment } from 'react';
import Link from 'next/link';
import { m, useTransform, type MotionValue } from 'motion/react';
import { StickyScene } from '../primitives/StickyScene';
import { ScaleField } from '../primitives/ScaleField';

const phrases = [
  'O Scale não grava suas chamadas.',
  'Sua voz e sua tela vão direto entre vocês.',
  'É gratuito.',
];
const count = phrases.flatMap(phrase => phrase.split(' ')).length;

function Word({ word, index, progress }: { word: string; index: number; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [index / count * 0.8, index / count * 0.8 + 0.1], [0.55, 1]);
  const reduce = useStaticScene();
  return <m.span style={{ opacity: reduce ? 1 : opacity }}>{word}</m.span>;
}

export function Manifesto() {
  return (
    <StickyScene className="l-manifesto">
      {progress => (
        <>
          <ScaleField />
          <div className="l-manifesto-copy">
            <h2>
              {phrases.map((phrase, phraseIndex) => (
                <span className="l-manifesto-phrase" key={phrase}>
                  {phrase.split(' ').map((word, position) => {
                    const wordIndex = phrases.slice(0, phraseIndex).reduce((total, item) => total + item.split(' ').length, 0) + position;
                    return <Fragment key={wordIndex}><Word word={word} index={wordIndex} progress={progress} />{' '}</Fragment>;
                  })}
                </span>
              ))}
            </h2>
            <p>Mensagens são verificadas antes de publicar e a tela por amostragem; o áudio não é analisado.</p>
            <Link href="/privacy">Como cuidamos da privacidade</Link>
          </div>
        </>
      )}
    </StickyScene>
  );
}
