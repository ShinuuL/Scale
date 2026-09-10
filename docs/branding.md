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
| `slate-950` | `#020617` | Background principal (dark) |
| `slate-900` | `#0f172a` | Superfícies, cards |
| `violet-500` | `#8b5cf6` | Accent primário (CTAs, links) |
| `violet-400` | `#a78bfa` | Hover states |
| `emerald-500` | `#10b981` | Status positivo (online, conectado) |
| `emerald-400` | `#34d399` | Indicators, badges |
| `slate-100` | `#f1f5f9` | Texto principal |

### Proporção

- **80%** escuros (slate-950, slate-900) — fundo e superfícies
- **15%** violeta — interações e navegação
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

O 🐉 (emoji dragão) é o ícone do Scale. Usado em:

- Título: `# Scale 🐉`
- Dashboard de métricas
- Wizard de onboarding
- Loading states

## Princípios de Design

1. **Dark-first**: fundo escuro reduz fadiga visual durante chamadas longas
2. **Minimal chrome**: ao máximo, a UI desaparece para dar espaço ao vídeo
3. **Sinalização clara**: verde = conectado, violeta = ação, vermelho = erro
4. **Grid responsivo**: vídeo em grid adaptável (2×1 até 4×2 para 8 peers)
5. **Acessibilidade**: contraste WCAG AA+, skip links, focus ring visível
