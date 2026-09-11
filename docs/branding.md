# Scale — Identidade Visual

## Conceito

**Scale** (escama de dragão) — cada peer na mesh é uma escama. Escamas se sobrepõem, se protegem mutuamente e formam uma camada resistente. Assim como uma malha de escamas protege o dragão, a mesh de peers protege a privacidade dos participantes com criptografia ponta-a-ponta via Tailscale.

### Metáforas

| Elemento | Significado |
|----------|-------------|
| **Escama** | Peer na mesh — individual, protegido, conectado |
| **Sobreposição** | Redundância e resiliência da mesh |
| **Proteção** | Criptografia WireGuard + WebRTC SRTP |
| **Dragão** | O sistema como um todo — forte, ágil, impossível de derrubar |

## Paleta de Cores

| Token | Cor | Uso |
|-------|-----|-----|
| `forest-950` | `#071412` | Background principal (dark verdant) |
| `forest-900` | `#0f2620` | Superfícies, cards |
| `moss-600`/`brand-600` | `#059669` | Accent primário (CTAs, links) |
| `emerald-400` | `#34d399` | Hover states, indicators, badges |
| `emerald-500` | `#10b981` | Status positivo + accent primário (online, conectado) |
| `mint-300` | `#6ee7b7` | Focus rings |
| `slate-100` | `#f1f5f9` | Texto principal |

### Proporção

- **80%** escuros verdant (forest-950, forest-900) — fundo e superfícies
- **15%** verde moss/emerald — interações e navegação
- **5%** verde-êsmeralda — feedback e status

## Tipografia

| Elemento | Fonte | Peso | Tamanho |
|----------|-------|------|---------|
| Display / H1 | Inter | 800 (extrabold) | 2.5rem |
| Heading / H2 | Inter | 700 (bold) | 1.75rem |
| Body | Inter | 400 (regular) | 1rem |
| Caption | Inter | 500 (medium) | 0.875rem |
| Mono | JetBrains Mono | 400 | 0.875rem |

**Fallback:** `system-ui, -apple-system, sans-serif`

## Ícone

O ícone do Scale é o **S escamado** em PNG: gradiente **azul → roxo** (`#3b82f6 → #8b5cf6 → #7c3aed`), escamas sobrepostas e **3 nós brancos** conectados por uma linha curva fina — os peers da mesh. O PNG (`frontend/public/logo.png`, 512×512, fundo transparente) é a **fonte da verdade**. O `logo.svg` existe apenas como fallback vetorial extra e **nunca é referenciado** na aplicação.

### Formatos

| Arquivo | Uso |
|---------|-----|
| `logo.png` (512×512) | Master — usado pelo componente `<Logo />` (variants `mark`/`full`) |
| `favicon.ico` (32×32) | Favicon do browser |
| `favicon-32x32.png` / `favicon-16x16.png` | Favicons PNG (com e sem hint de tamanho) |
| `apple-touch-icon.png` (180×180) | Home screen iOS |
| `icon-192.png` / `icon-512.png` | Ícones PWA |
| `og-image.png` (1200×630) | Open Graph / compartilhamento social |

### Uso

- **Mark** (somente o S): header, footer, status — `<Logo variant="mark" size={28} />`
- **Full** (S + wordmark "Scale"): loading states — `<Logo variant="full" />`
- **Wordmark** (somente texto "Scale"): espaços compactos — `<Logo variant="wordmark" />`
- O emoji 🐉 **não** é mais usado como ícone — apenas o PNG escamado.

## Princípios de Design

1. **Dark-first verdant**: fundo forest (`#071412`) escuro e profundo reduz fadiga visual durante chamadas longas
2. **Minimal chrome**: ao máximo, a UI desaparece para dar espaço ao vídeo
3. **Sinalização clara**: verde = conectado e ação, vermelho = erro
4. **Grid responsivo**: vídeo em grid adaptável (2×1 até 4×2 para 8 peers)
5. **Acessibilidade**: contraste WCAG AA+, skip links, focus ring visível
