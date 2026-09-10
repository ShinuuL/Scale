# Configuracao do Tailscale para Scale

## O que e Tailscale?

[Tailscale](https://tailscale.com/) e uma rede privada virtual (mesh VPN) baseada no WireGuard. Ele cria uma rede segura entre seus dispositivos, onde cada um recebe um IP unico na faixa `100.x.x.x` (chamado de **Tailscale IP** ou **Clef IP**). Com Tailscale, seus dispositivos podem se comunicar diretamente, sem a necessidade de configurar port forwarding,.Firewall rules ou servidores de intermediacao.

### Por que usar Tailscale com Scale?

Scale e um sistema de videochamadas P2P (mesh). Para que os participantes se conectem diretamente via WebRTC, eles precisam poder se alcancar na rede. Tailscale resolve isso ao:

1. **Atribuir IPs fixos** a cada dispositivo (`100.x.x.x`)
2. **Traversal de NAT automatico** usando relays (DERP)
3. **Seguranca por padrao** com criptografia WireGuard
4. **Sem port forwarding** necessario

### Plano Gratuito

O plano gratuito do Tailscale inclui:

- Ate **3 usuarios** e **100 dispositivos**
- Rede mesh completa
- Relays DERP globais
- MagicDNS (resolucao de nomes por IP)
- Suficiente para uso pessoal e pequenas equipes

---

## Passo a Passo de Instalacao

### Windows

1. Baixe o Tailscale em [tailscale.com/download](https://tailscale.com/download)
2. Execute o instalador e siga as instrucoes
3. Abra o Tailscale na bandeja do sistema (area de notificacao)
4. Clique em **"Sign in"** e faca login com sua conta (Google, Microsoft, GitHub, etc.)
5. Apos o login, seu dispositivo estara conectado a rede
6. Verifique seu IP com:

```powershell
tailscale ip -4
```

Saida esperada: `100.x.x.x`

### macOS

1. Baixe o Tailscale no [App Store](https://apps.apple.com/app/tailscale/id1475387142) ou em [tailscale.com/download](https://tailscale.com/download)
2. Abra o Tailscale e faca login
3. Verifique seu IP:

```bash
tailscale ip -4
```

### Linux (Ubuntu/Debian)

```bash
# Instalacao
curl -fsSL https://tailscale.com/install.sh | sh

# Iniciar e fazer login
sudo tailscale up

# Verificar IP
tailscale ip -4
```

### Linux (Arch Linux)

```bash
# Instalacao via pacman
sudo pacman -S tailscale

# Habilitar e iniciar
sudo systemctl enable --now tailscaled
sudo tailscale up

# Verificar IP
tailscale ip -4
```

### Android

1. Baixe o Tailscale na [Google Play Store](https://play.google.com/store/apps/details?id=com.tailscale.ipn)
2. Abra o app e faca login
3. Seu dispositivo recebera um IP na rede

### iOS

1. Baixe o Tailscale na [App Store](https://apps.apple.com/app/tailscale/id1475387142)
2. Abra o app e faca login
3. Seu dispositivo recebera um IP na rede

---

## Como Pegar seu Tailscale IP

Apos fazer login em qualquer dispositivo, verifique seu IP:

| SO | Comando |
|----|---------|
| Windows | `tailscale ip -4` |
| macOS | `tailscale ip -4` |
| Linux | `tailscale ip -4` |
| Android/iOS | Ver no app Tailscale > Settings |

O IP tera o formato `100.x.y.z` (ex: `100.64.0.1`).

---

## Como Compartilhar um Link de Sala

Com o Tailscale rodando, voce pode acessar o Scale de qualquer dispositivo na rede usando o IP do servidor:

1. Descubra o IP do servidor (dispositivo onde o Scale esta rodando):

```bash
tailscale ip -4
# Ex: 100.64.0.10
```

2. Compartilhe o link no formato:

```
http://100.64.0.10:3000/room/<UUID-da-sala>
```

Exemplo:
```
http://100.64.0.10:3000/room/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

3. Todos na rede Tailscale poderao acessar esse link diretamente.

### Usando MagicDNS

Se MagicDNS estiver habilitado no Tailscale, voce pode usar o nome do dispositivo:

```
http://meu-computador:3000/room/<UUID-da-sala>
```

Para habilitar MagicDNS:
1. Acesse [login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns)
2. Ative **MagicDNS**

---

## Configuracao do Scale com Tailscale

### Variavel de Ambiente

Defina o IP Tailscale do servidor no arquivo `.env`:

```env
TAILSCALE_IP=100.64.0.10
```

Isso permite que o backend saiba seu proprio IP na rede Tailscale, util para:
- Gerar links de convite corretos
- WebRTC ICE candidates
- Configuracao de CORS

### Configuracao do CORS

O CORS deve incluir o IP Tailscale do servidor:

```env
ALLOWED_ORIGINS=http://localhost:3000,http://100.64.0.10:3000
```

---

## Troubleshooting

### Firewall bloqueando conexao

#### Windows
1. Abra o Windows Defender Firewall
2. Clique em "Regras de Entrada" > "Nova Regra"
3. Selecione "Porta" > TCP > Porta 3000 (frontend) e 4000 (backend)
4. Permitir a conexao
5. Repita para as portas TCP necessarias

#### macOS
1. Abra "Preferencias do Sistema" > "Seguranca e Privacidade" > "Firewall"
2. Clique em "Opcoes do Firewall"
3. Adicione regras para permitir as portas 3000 e 4000

#### Linux (UFW)
```bash
sudo ufw allow 3000/tcp
sudo ufw allow 4000/tcp
sudo ufw reload
```

### ACL (Access Control List)

Se voce tem um ACL configurado no Tailscale, garanta que as portas HTTP estejam permitidas:

1. Acesse [login.tailscale.com/admin/acls](https://login.tailscale.com/admin/acls)
2. Verifique se as regras permitem trafego TCP entre dispositivos

Exemplo de ACL basico:
```json
{
  "acls": [
    {
      // Permite todo trafego entre dispositivos na rede
      "action": "accept",
      "src": ["autogroup:member"],
      "dst": ["autogroup:member:*"]
    }
  ]
}
```

### MagicDNS nao funciona

Se voce nao consegue acessar o Scale pelo nome do dispositivo:

1. Verifique se MagicDNS esta ativo em [login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns)
2. Reinicie o servico Tailscale:

```bash
# Linux
sudo systemctl restart tailscaled

# macOS
sudo tailscale down && tailscale up
```

### WebRTC nao conecta (STUN/TURN)

Se os participantes nao conseguem conectar via WebRTC:

1. Verifique se todos estao no mesmo Tailscale
2. O STUN publico (`stun:stun.l.google.com:19302`) deve funcionar pela rede
3. Se houver problemas de NAT, configure um servidor TURN (profile `turn` no Docker Compose)
4. Para ativar o coturn:

```bash
docker compose --profile turn up -d coturn
```

### Dispositivo nao aparece na rede

1. Verifique se o Tailscale esta rodando no dispositivo
2. Verifique se voce esta logado na mesma conta
3. Reinicie o Tailscale:

```bash
tailscale down && tailscale up
```

---

## HTTPS com Tailscale Cert (opcional, free)

Voce pode habilitar HTTPS na rede Tailscale usando certificados gerados pelo proprio Tailscale, sem precisar de Let's Encrypt nem Cloudflare. O plano gratuito inclui isso.

### Por que HTTPS?

- Browsers modernos bloqueiam **microfone/camera** em paginas HTTP (exceto localhost). Com HTTPS via Tailscale, todos os browsers concedem acesso automatico.
- Criptografia ponta-a-ponta na rede mesh.
- Sem alertas de "Not Secure" na barra de endereco.

### Pre-requisito: MagicDNS

Para usar `tailscale cert`, MagicDNS precisa estar habilitado:

1. Acesse [login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns)
2. Ative **MagicDNS**

### Gerar os certificados

O comando abaixo gera um par de certificado + chave para o hostname do seu dispositivo na rede Tailscale:

```bash
tailscale cert <seu-host>.tailnet.ts.net
```

Exemplo:
```bash
tailscale cert desktop-sio88bu.tail-xxxxx.ts.net
```

O comando cria dois arquivos no diretorio atual:
- `desktop-sio88bu.tail-xxxxx.ts.net.crt` (certificado)
- `desktop-sio88bu.tail-xxxxx.ts.net.key` (chave privada)

### Onde colocar os certificados

Copie os arquivos para a pasta `certs/` na raiz do projeto:

```bash
# No Windows (PowerShell)
mkdir certs
Copy-Item desktop-sio88bu.tail-xxxxx.ts.net.crt certs/server.crt
Copy-Item desktop-sio88bu.tail-xxxxx.ts.net.key certs/server.key

# No macOS / Linux
mkdir -p certs
cp desktop-sio88bu.tail-xxxxx.ts.net.crt certs/server.crt
cp desktop-sio88bu.tail-xxxxx.ts.net.key certs/server.key
```

> **Importante:** A pasta `certs/` esta no `.gitignore` — os certificados nunca vao para o repositorio.

### Opcao A: Caddy Reverse Proxy (recomendado)

O docker-compose inclui um servico **Caddy** (perfil `https`) que termina HTTPS e repassa para o frontend/backend internamente:

```bash
# Preparar .env (opcional, usado como referencia pela equipe)
TAILSCALE_HOST=desktop-sio88bu.tail-xxxxx.ts.net
ENABLE_HTTPS=true
HTTPS_PORT=3443

# Subir com HTTPS
docker compose --profile https up --build

# Acessar
https://desktop-sio88bu.tail-xxxxx.ts.net:3443
```

O Caddy cuida automaticamente do TLS usando os certificados em `certs/` e repassa:
- Paginas do frontend -> `frontend:3000`
- Signaling Socket.io (`/socket.io`) -> `backend:4000` (Next.js nao proxeia WebSockets)

> **Importante:** adicione a origem HTTPS ao CORS do backend no `.env`:
>
> ```env
> ALLOWED_ORIGINS=http://localhost:3000,http://100.64.0.10:3000,https://desktop-sio88bu.tail-xxxxx.ts.net:3443
> ```

> O fluxo HTTP padrao (`http://localhost:3000` e `http://<ip>:3000`) continua funcionando
> normalmente sem o perfil `https` — o perfil e opcional e nao altera o comportamento padrao.

### Opcao B: Next.js experimental HTTPS (apenas teste visual local)

Para ver a pagina com HTTPS em dev, rapidinho:

```bash
cd frontend
npx next dev --experimental-https --port 3000
```

> **Limitacao:** esta opcao serve apenas para testar o visual/local do HTTPS. O signaling
> Socket.io precisa de um proxy WebSocket (Caddy) — com `--experimental-https` puro, a sala
> nao conecta e micro/camera nao funcionam. Para o fluxo completo (micro/tela), use a **Opcao A**.

### Como acessar

| Cenario | URL |
|---------|-----|
| HTTP (local) | `http://localhost:3000` |
| HTTP (rede Tailscale) | `http://100.x.x.x:3000` |
| HTTPS via Caddy | `https://<host>.tailnet.ts.net:3443` |

### Renovacao de certificados

Os certificados Tailscale duram **90 dias**. Para renovar:

```bash
tailscale cert <seu-host>.tailnet.ts.net
cp <seu-host>.tailnet.ts.net.crt certs/server.crt
cp <seu-host>.tailnet.ts.net.key certs/server.key
# Reiniciar Caddy para recarregar
docker compose --profile https restart caddy
```

---

## Referencia ao Wizard da UI

O Scale inclui um **Tailscale Wizard** na tela de onboarding que ajuda os usuarios a:

1. Verificar se o Tailscale esta instalado e rodando
2. Mostrar o IP Tailscale atual
3. Testar a conectividade com o servidor
4. Gerar links de convite automaticamente

Para acessar o wizard:
1. Crie uma sala no Scale
2. Clique em "Compartilhar"
3. O wizard mostrara as instrucoes de conexao

---

## Comandos Uteis

```bash
# Ver status do Tailscale
tailscale status

# Ver IP Tailscale
tailscale ip -4

# Fazer ping entre dispositivos
tailscale ping <IP-do-dispositivo>

# Ver lista de dispositivos conectados
tailscale status --json | python3 -m json.tool

# Desconectar
tailscale down

# Reconectar
tailscale up
```
