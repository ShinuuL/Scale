'use client';

import { clsx } from 'clsx';

/**
 * Conjunto de ícones vetoriais PRÓPRIOS do Scale — sem biblioteca externa, sem
 * dependência nova e sem sprite remoto. Substitui os emojis e os glifos
 * tipográficos (setas, check e fechar) que antes apareciam na interface.
 *
 * Regras do desenho (valem para TODOS os ícones):
 *  - grade 24×24, `viewBox="0 0 24 24"`;
 *  - traço herdado por `currentColor` (funciona em botão ativo/desabilitado e
 *    nos dois temas, sem precisar de variante por cor);
 *  - espessura única: `strokeWidth={1.75}` com pontas/ junções arredondadas;
 *  - `fill` só onde o estado precisa ficar evidente: cápsula do microfone e
 *    corpo do alto-falante são PREENCHIDOS no estado "ligado" — o par
 *    desligado (`micOff`/`speakerOff`) é contorno com corte. Assim o "on/off"
 *    se lê pela silhueta, não só pela barrinha.
 *  - nenhum `path` é duplicado no JSX: a geometria é declarada uma única vez
 *    em `ICONS` e reaproveitada (ex.: `MIC_BODY` serve `mic` e `micOff`).
 */
export type IconName =
  | 'archive'
  | 'arrowLeft'
  | 'arrowRight'
  | 'ban'
  | 'book'
  | 'chat'
  | 'check'
  | 'checkCircle'
  | 'clock'
  | 'close'
  | 'document'
  | 'eye'
  | 'github'
  | 'globe'
  | 'google'
  | 'image'
  | 'info'
  | 'key'
  | 'lightbulb'
  | 'link'
  | 'maximize'
  | 'minimize'
  | 'lock'
  | 'mic'
  | 'micOff'
  | 'monitor'
  | 'music'
  | 'paperclip'
  | 'phone'
  | 'search'
  | 'settings'
  | 'speaker'
  | 'speakerOff'
  | 'trash'
  | 'users'
  | 'warning';

export interface IconProps {
  name: IconName;
  /** Lado do quadro quadrado, em px. Default 16 (~1em ao lado de texto de 16px). */
  size?: number;
  className?: string;
  /**
   * Nome acessível em PT-BR. Use quando o ícone É o rótulo (ícone sozinho).
   * Quando presente, o SVG vira `role="img"` + `aria-label`; quando ausente o
   * ícone é decorativo (`aria-hidden` + `focusable="false"`) — o caso de todos
   * os ícones que ficam dentro de um botão com `aria-label` ou ao lado de texto.
   */
  title?: string;
}

/** Uma parte do desenho. `filled` marca as formas sólidas ("estado ligado"). */
export interface IconShape {
  d: string;
  filled?: boolean;
}

// ─── Geometrias reaproveitadas ──────────────────────────────────
const MIC_BODY =
  'M12 3.4a2.85 2.85 0 0 0-2.85 2.85v5.5a2.85 2.85 0 0 0 5.7 0v-5.5A2.85 2.85 0 0 0 12 3.4Z';
const MIC_ARC = 'M5.75 11a6.25 6.25 0 0 0 12.5 0';
const MIC_STEM = 'M12 17.25v3.25';
const MIC_BASE = 'M8.5 20.5h7';
const SPEAKER_BODY =
  'M12.7 5.3a.9.9 0 0 0-1.5-.7L6.6 8.7H4.4A1.4 1.4 0 0 0 3 10.1v3.8a1.4 1.4 0 0 0 1.4 1.4h2.2l4.6 4.1a.9.9 0 0 0 1.5-.7V5.3Z';
const SLASH = 'M3.6 3.6 20.4 20.4';
/** Círculo de raio 9 (U+25CB-like) escrito como path, para manter tudo em `path`. */
const CIRCLE_R9 = 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Z';

/** Catálogo fechado: todo `IconName` tem geometria aqui (o Record garante em tipo). */
export const ICONS: Record<IconName, IconShape[]> = {
  mic: [{ d: MIC_BODY, filled: true }, { d: MIC_ARC }, { d: MIC_STEM }, { d: MIC_BASE }],
  micOff: [
    { d: MIC_BODY },
    { d: MIC_ARC },
    { d: MIC_STEM },
    { d: MIC_BASE },
    { d: SLASH },
  ],
  speaker: [
    { d: SPEAKER_BODY, filled: true },
    { d: 'M15.8 9.6a3.4 3.4 0 0 1 0 4.8' },
    { d: 'M18.4 7.2a7 7 0 0 1 0 9.6' },
  ],
  speakerOff: [
    { d: SPEAKER_BODY },
    { d: 'M15.7 9.7 20.5 14.5' },
    { d: 'M20.5 9.7 15.7 14.5' },
  ],
  monitor: [
    {
      d: 'M5.2 4.2h13.6a2.4 2.4 0 0 1 2.4 2.4v7.8a2.4 2.4 0 0 1-2.4 2.4H5.2a2.4 2.4 0 0 1-2.4-2.4V6.6a2.4 2.4 0 0 1 2.4-2.4Z',
    },
    { d: 'M12 16.8v3.7' },
    { d: 'M8.4 20.5h7.2' },
  ],
  eye: [
    { d: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z' },
    { d: 'M12 9.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z' },
  ],
  maximize: [
    { d: 'M8.5 3.5h-5v5' },
    { d: 'M15.5 3.5h5v5' },
    { d: 'M20.5 15.5v5h-5' },
    { d: 'M3.5 15.5v5h5' },
  ],
  minimize: [
    { d: 'M3.5 8.5h5v-5' },
    { d: 'M20.5 8.5h-5v-5' },
    { d: 'M15.5 20.5v-5h5' },
    { d: 'M8.5 20.5v-5h-5' },
  ],
  link: [
    { d: 'M9.9 13.3a4.5 4.5 0 0 0 6.8.5l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5' },
    { d: 'M14.1 10.7a4.5 4.5 0 0 0-6.8-.5l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5' },
  ],
  chat: [
    { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v10a2.5 2.5 0 0 1-2.5 2.5H9.6L4 21.5V5.5Z' },
  ],
  phone: [
    {
      d: 'M6.9 3.5a3.4 3.4 0 0 0-3.4 3.7c.7 7.4 6.5 13.2 13.9 13.9a3.4 3.4 0 0 0 3.7-3.4v-2.1a1.35 1.35 0 0 0-1.05-1.32l-2.5-.63a1.35 1.35 0 0 0-1.32.4l-1.4 1.4a13.6 13.6 0 0 1-4.9-4.9l1.4-1.4a1.35 1.35 0 0 0 .4-1.32l-.63-2.5A1.35 1.35 0 0 0 9 3.5H6.9Z',
    },
  ],
  users: [
    { d: 'M10 4.2a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z' },
    { d: 'M3.6 20.5v-1.3a4.2 4.2 0 0 1 4.2-4.2h4.4a4.2 4.2 0 0 1 4.2 4.2v1.3' },
    { d: 'M20.4 20.5v-1.3a4.2 4.2 0 0 0-3.15-4.06' },
    { d: 'M15 4.62a3.6 3.6 0 0 1 0 6.36' },
  ],
  book: [
    {
      d: 'M12 6.6C10.3 5.2 8.2 4.5 5.7 4.6A1.6 1.6 0 0 0 4.2 6.2v11.3a1.6 1.6 0 0 0 1.7 1.6c2.4-.1 4.4.5 6.1 1.9 1.7-1.4 3.7-2 6.1-1.9a1.6 1.6 0 0 0 1.7-1.6V6.2a1.6 1.6 0 0 0-1.5-1.6c-2.5-.1-4.6.6-6.3 2Z',
    },
    { d: 'M12 6.6V21' },
  ],
  lock: [
    {
      d: 'M6.6 10.4h10.8a2.4 2.4 0 0 1 2.4 2.4v5.3a2.4 2.4 0 0 1-2.4 2.4H6.6a2.4 2.4 0 0 1-2.4-2.4v-5.3a2.4 2.4 0 0 1 2.4-2.4Z',
    },
    { d: 'M8.2 10.4V7.9a3.8 3.8 0 0 1 7.6 0v2.5' },
    { d: 'M12 14.3v2.2' },
  ],
  key: [
    { d: 'M8.4 11.2a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8Z' },
    { d: 'M11.5 12.5 20.4 3.6' },
    { d: 'M17.4 6.6 19.8 9' },
    { d: 'M15.1 8.9 17.5 11.3' },
  ],
  lightbulb: [
    {
      d: 'M12 3.2a6.1 6.1 0 0 0-3.6 11c.55.4.85 1 .85 1.65v.75h5.5v-.75c0-.65.3-1.25.85-1.65A6.1 6.1 0 0 0 12 3.2Z',
    },
    { d: 'M9.6 19.4h4.8' },
    { d: 'M10.6 21.6h2.8' },
  ],
  globe: [
    { d: CIRCLE_R9 },
    { d: 'M3.2 12h17.6' },
    {
      d: 'M12 3a14.5 14.5 0 0 1 3.9 9.2 14.5 14.5 0 0 1-3.9 9.2 14.5 14.5 0 0 1-3.9-9.2A14.5 14.5 0 0 1 12 3Z',
    },
  ],
  warning: [
    { d: 'M12 4 20.8 19.4H3.2L12 4Z' },
    { d: 'M12 9.8v4.1' },
    { d: 'M12 16.7h.01' },
  ],
  ban: [{ d: CIRCLE_R9 }, { d: 'M5.9 5.9 18.1 18.1' }],
  info: [{ d: CIRCLE_R9 }, { d: 'M12 11.2v5.2' }, { d: 'M12 7.9h.01' }],
  check: [{ d: 'M5 12.6 9.6 17.2 19 6.8' }],
  checkCircle: [{ d: CIRCLE_R9 }, { d: 'M8.2 12.4 10.9 15.1 16.1 9.8' }],
  close: [{ d: 'M6 6 18 18' }, { d: 'M18 6 6 18' }],
  arrowLeft: [{ d: 'M19.2 12H4.8' }, { d: 'M11 5.4 4.4 12l6.6 6.6' }],
  arrowRight: [{ d: 'M4.8 12h14.4' }, { d: 'M13 5.4 19.6 12 13 18.6' }],
  search: [
    { d: 'M10.8 4a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6Z' },
    { d: 'M15.7 15.7 20.4 20.4' },
  ],
  clock: [
    { d: 'M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2Z' },
    { d: 'M12 7.3v5.2l3.4 2' },
  ],
  paperclip: [
    {
      d: 'M20 11.4l-7.5 7.5a4.6 4.6 0 0 1-6.5-6.5l7.9-7.9a3.1 3.1 0 0 1 4.4 4.4l-7.9 7.9a1.55 1.55 0 0 1-2.2-2.2l7.2-7.2',
    },
  ],
  image: [
    {
      d: 'M6.2 4.6h11.6a2.6 2.6 0 0 1 2.6 2.6v9.6a2.6 2.6 0 0 1-2.6 2.6H6.2a2.6 2.6 0 0 1-2.6-2.6V7.2a2.6 2.6 0 0 1 2.6-2.6Z',
    },
    { d: 'M9 11a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 9 11Z' },
    { d: 'M3.9 17.4l4.7-4a1.9 1.9 0 0 1 2.5 0l5.3 4.6' },
    { d: 'M14.4 14.6l1.5-1.3a1.9 1.9 0 0 1 2.5 0l1.7 1.5' },
  ],
  document: [
    {
      d: 'M14.2 3.5H7.6A2.6 2.6 0 0 0 5 6.1v11.8a2.6 2.6 0 0 0 2.6 2.6h8.8a2.6 2.6 0 0 0 2.6-2.6V8.3L14.2 3.5Z',
    },
    { d: 'M14 3.6v4.8h4.8' },
    { d: 'M8.9 13h6.2' },
    { d: 'M8.9 16.4h4.2' },
  ],
  music: [
    { d: 'M9 18.3V6.3l10-2.1v12.1' },
    { d: 'M6.5 15.8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z' },
    { d: 'M16.5 13.8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z' },
  ],
  archive: [
    {
      d: 'M5.4 4h13.2a1.9 1.9 0 0 1 1.9 1.9v1a1.9 1.9 0 0 1-1.9 1.9H5.4a1.9 1.9 0 0 1-1.9-1.9v-1A1.9 1.9 0 0 1 5.4 4Z',
    },
    { d: 'M5.2 8.8v9.1A2.6 2.6 0 0 0 7.8 20.5h8.4a2.6 2.6 0 0 0 2.6-2.6V8.8' },
    { d: 'M9.9 12.6h4.2' },
  ],
  // Engrenagem: miolo circular e coroa com oito dentes.
  settings: [
    { d: 'M12 15.1a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Z' },
    {
      d: 'M10.3 3.5h3.4l.5 2.3 1.6.9 2.2-.8 1.7 2.9-1.8 1.6v1.8l1.8 1.6-1.7 2.9-2.2-.8-1.6.9-.5 2.3h-3.4l-.5-2.3-1.6-.9-2.2.8-1.7-2.9 1.8-1.6v-1.8L4.3 8.8 6 5.9l2.2.8 1.6-.9.5-2.3Z',
    },
  ],
  // Marca do Google ("G" monocromatico, silhueta solida, CC0 Simple Icons):
  // icone de marca usado so no botao "Entrar com Google".
  google: [
    {
      d: 'M12.48 10.92v3.28h7.84c-.24 1.84-.85 3.19-1.79 4.13-1.15 1.15-2.93 2.4-6.05 2.4-4.83 0-8.6-3.89-8.6-8.72s3.77-8.72 8.6-8.72c2.6 0 4.51 1.03 5.91 2.35l2.31-2.31C18.75 1.44 16.13 0 12.48 0 5.87 0 .31 5.39.31 12s5.56 12 12.17 12c3.57 0 6.27-1.17 8.37-3.36 2.16-2.16 2.84-5.21 2.84-7.67 0-.76-.05-1.47-.17-2.05h-11.04Z',
      filled: true,
    },
  ],
  // Marca do GitHub (silhueta solida): icone de marca usado so no botao
  // "Entrar com GitHub", onde a marca identifica o provedor.
  github: [
    {
      d: 'M12 2.2a9.8 9.8 0 0 0-3.1 19.1c.5.1.7-.2.7-.5v-1.7c-2.7.6-3.3-1.3-3.3-1.3-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.2-4.5-1.1-4.5-4.9 0-1.1.4-2 1-2.6-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.6 1 2.6 0 3.8-2.3 4.6-4.5 4.9.4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A9.8 9.8 0 0 0 12 2.2Z',
      filled: true,
    },
  ],
  // Lixeira: tampa com alça, corpo afunilado e dois frisos.
  trash: [
    { d: 'M4 6.5h16' },
    { d: 'M9.2 6.5V4.8A1.3 1.3 0 0 1 10.5 3.5h3a1.3 1.3 0 0 1 1.3 1.3v1.7' },
    { d: 'M6.3 6.5l.9 12.1a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-12.1' },
    { d: 'M10.2 10.5v6' },
    { d: 'M13.8 10.5v6' },
  ],
};

/**
 * Ícone vetorial do Scale.
 *
 * ```tsx
 * <Icon name="mic" />                       // decorativo (dentro de botão com aria-label)
 * <Icon name="micOff" title="Mudo" />       // é o rótulo: ganha role="img" + aria-label
 * ```
 */
export function Icon({ name, size = 16, className, title }: IconProps) {
  const labelled = typeof title === 'string' && title.length > 0;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={clsx('inline-block align-middle shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable={labelled ? undefined : 'false'}
    >
      {ICONS[name].map((shape) => (
        <path
          key={shape.d}
          d={shape.d}
          fill={shape.filled ? 'currentColor' : 'none'}
          stroke={shape.filled ? 'none' : 'currentColor'}
        />
      ))}
    </svg>
  );
}
