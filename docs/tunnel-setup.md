# Túnel público do Scale (cloudflared)

Guia do túnel de acesso remoto do Scale. O app deixou de ser preso a uma rede
privada (tailnet): agora ele pode ser exposto por um **túnel rápido do
cloudflared**, sem conta, sem token e sem abrir porta no roteador.

---

## O que é o túnel rápido

O cloudflared cria uma conexão de saída para a Cloudflare e devolve uma URL
pública **efêmera** no formato:

```
https://<aleatorio>.trycloudflare.com
```

A Cloudflare termina o TLS nessa URL e encaminha o tráfego pelo túnel até a sua
máquina. Nada precisa ser exposto no firewall e nenhum certificado local é
necessário — quem fala HTTPS com o browser é a Cloudflare.

**A URL muda a cada start do container.** Cada `up` gera um nome aleatório novo.
Se você reiniciar o `cloudflared`, os links antigos morrem.

---

## Como funciona por dentro (proxy interno)

O túnel rápido aponta para **um único serviço** (`http://proxy:8080`). Por isso
existe um **proxy interno** (serviço `proxy`, Caddy) entre o túnel e o app. Ele
serve o frontend **estático** (export do Next embutido na imagem, sem servidor
Node) e roteia por path para o backend:

| Path | Destino | Por quê |
|------|---------|---------|
| `/api/*` | `backend:4000` | API REST, mesmo origin |
| `/socket.io/*` | `backend:4000` | signaling; o Caddy faz o upgrade de WebSocket nativamente |
| `/room/<id>` | 302 → `/room?id=<id>` | compatibilidade com links antigos (preserva a query) |
| todo o resto | arquivos em `/srv` | `try_files {path} {path}.html {path}/ /index.html` + CSP e headers de segurança |

O `Caddyfile` é esse roteador interno. O `cloudflared` só recebe o tráfego e
repassa para `http://proxy:8080`.

Fluxo:

```
browser ──https──> Cloudflare ──túnel──> cloudflared ──http──> proxy (Caddy :8080)
                                                                 ├── /api/*       ─> backend:4000
                                                                 ├── /socket.io/* ─> backend:4000
                                                                 └── /*           ─> estaticos (/srv)
```

---

## Como subir

```bash
# Sobe backend + proxy com estaticos (default) + cloudflared (profile tunnel)
docker compose --profile tunnel up -d --build

# Confira os serviços no ar
docker compose ps
```

O `proxy` faz parte do profile default, então sobe junto. O `cloudflared` só
sobe com `--profile tunnel`.

### Ler a URL pública

A URL aparece nos logs do cloudflared:

```bash
docker compose logs cloudflared
```

Procure uma linha parecida com:

```
INF |  Your quick Tunnel has been created! Visit it at:
INF |  https://algo-aleatorio-aqui.trycloudflare.com
```

Abra essa URL no browser. Para acompanhar em tempo real:

```bash
docker compose logs -f cloudflared
```

### Parar

```bash
docker compose --profile tunnel down
```

---

## Acesso local também funciona

Sem o túnel, o app continua acessível em HTTP pelos caminhos de sempre:

| Cenário | URL |
|---------|-----|
| App (Docker, Caddy) | `http://localhost:<PROXY_PORT>` (8080 default; 8090 nesta máquina) |
| Frontend em dev (`npm run dev`) | `http://localhost:3000` |
| Backend direto (diagnóstico, loopback) | `http://localhost:<BACKEND_PORT>` |

A porta do proxy no host é configurável por `PROXY_PORT` (default `8080`). Se
você mudar `PROXY_PORT`, ajuste também `ALLOWED_ORIGINS` no `.env` (a origem
`http://localhost:<PROXY_PORT>` precisa estar na lista).

### Exposição de LAN (leia se está em rede compartilhada)

Por padrão, **só o `proxy` é publicado em `0.0.0.0`** (é a entrada do app). As
porta do `backend` fica **só no loopback** (`127.0.0.1`). Não existe mais
container de frontend (o app é estático, servido pelo próprio `proxy`):

| Serviço | Publicação default | Quem alcança |
|---------|--------------------|--------------|
| `proxy` (Caddy) | `0.0.0.0:${PROXY_PORT:-8080}` | qualquer host da LAN (`http://<seu-IP>:8080`) |
| `backend` | `127.0.0.1:${BACKEND_PORT}` | só a própria máquina |

**Por que o `backend` é loopback-only.** Publicá-lo em `0.0.0.0` abre um
**bypass de rate limit**: quem alcança a porta direto consegue forjar o
header e, com isso, furar **todos** os baldes por IP (login, registro, upload).
Isso anula a Etapa 4. Nada do fluxo real precisa dessas portas fora do loopback:

- o **túnel** fala com o `proxy` interno (que roteia para os containers pela rede
  Docker), nunca com `:4100`;
- o **navegador local** em `http://localhost:8090` fala só com o `proxy`
  (páginas, `/api` e WebSocket no mesmo origin).

Se você **realmente** precisa de acesso direto pela LAN (ex.: testar de outro
dispositivo direto no `:4100`), descomente no `docker-compose.yml` a variante
antiga da porta (logo abaixo da versão loopback). Para usar o app pela LAN isso
**não** é necessário: o `proxy` já está em `0.0.0.0`.

```yaml
# backend
- "${BACKEND_PORT:-4000}:4000"   # 0.0.0.0 — REINTRODUZ a superfície de spoof
```

**AVISO:** essa variante reintroduz exatamente o buraco descrito acima — a LAN
inteira passa a poder forjar `X-Forwarded-For`. Use só em rede de confiança, de
propósito. (O `proxy` segue publicado em `0.0.0.0` de propósito: é a entrada que
o túnel e o navegador local usam.)

> Acesso HTTP puro pela LAN em `:8090` tem outra limitação (cookie `Secure`), ver
> a seção abaixo — o caminho recomendado é o túnel HTTPS ou `http://localhost`.

---

## CORS não precisa de configuração nova

Pelo túnel, o app é **same-origin**: o browser carrega a página em
`https://<aleatorio>.trycloudflare.com` e chama `/api/...` e `/socket.io/...` no
**mesmo origin**. Requisições same-origin não passam por CORS, então não há nada
para adicionar em `ALLOWED_ORIGINS` — mesmo que a URL mude a cada start.

Em HTTP local pelo proxy (`http://localhost:<PROXY_PORT>`) o app também é
same-origin. `http://localhost:3000` continua em `ALLOWED_ORIGINS` só para o
`npm run dev`, em que o WebSocket vai direto ao backend (cross-origin).

### Acesso por IP da LAN (HTTP puro)

Pelo proxy (`http://192.168.x.y:<PROXY_PORT>`) o app é same-origin: páginas,
`/api` e WebSocket vão para o mesmo host, então não é preciso acrescentar a
origem em `ALLOWED_ORIGINS`. (Lembre que microfone e tela exigem contexto
seguro: fora de `localhost`, use o túnel HTTPS.)

Pelo túnel (HTTPS) isso **não** é necessário: o app é same-origin e o CORS não
entra em jogo.

---

## Segurança — leia antes de expor

O túnel rápido é conveniente, mas **não é uma fronteira de segurança**:

- **A URL é pública.** Qualquer pessoa que tiver o link entra no app. O nome
  aleatório só dificulta a descoberta; ele não impede o acesso.
- **O quick tunnel não tem WAF nem Access.** Não há firewall de aplicação nem
  política de identidade da Cloudflare na frente.
- O TLS é terminado pela Cloudflare (browser ⇄ Cloudflare criptografado); o
  trecho Cloudflare ⇄ sua máquina também vai por túnel criptografado.

O que **realmente** protege o app nesse cenário:

1. **Rate limit por IP real do cliente.** O container roda com
   `NODE_ENV=production` e `TRUST_PROXY` apontando **apenas para os hops reais**
   (proxy e cloudflared — ver "Modelo de confiança" abaixo). Nesse
   arranjo o Caddy anexa o IP real do cliente e o backend o usa como chave dos
   baldes. Ex.: `POST /api/rooms` é limitado a 10 salas / 5s por IP (429 acima
   disso); login 10/5min; registro 5/hora; upload 30/min.
- **Autenticação e ACL de sala.** Endpoints de dados exigem JWT
  (`/api/metrics`, etc.) e salas privadas/protegidas exigem `inviteToken` ou
  senha. Trate o link de uma sala como uma credencial: não cole em canal público.

### Modelo de confiança (quem pode dizer qual é o IP do cliente)

Os baldes de rate limit são por IP. A pergunta de segurança é: **em quem o
backend confia para informar o IP do cliente?** A resposta está em dois lugares,
e os dois precisam estar certos.

**1) Backend — `TRUST_PROXY` (docker-compose.yml).** Confia só nos dois hops
reais da rede Docker, cada um com IP estático fixado em `ipv4_address`:

| Hop | IP | Por que entra |
|-----|----|---------------|
| `proxy` (Caddy) | `172.28.0.4/32` | único hop HTTP na frente do backend (`/api/*` e `/socket.io/*`) |
| `cloudflared` | `172.28.0.5/32` | último hop do `X-Forwarded-For` quando o request cruza o túnel |

**O gateway `172.28.0.1` NÃO entra na lista.** Ele é o peer de quem alcança uma
porta publicada (a conexão sai do host e chega ao container vinda do gateway da
rede). Incluí-lo — ou usar a subnet inteira (`172.28.0.0/16`) — faz o
`proxy-addr` "descer" para o `X-Forwarded-For` e aceitar um valor forjado.

**NUNCA use `TRUST_PROXY=true`** nem a subnet inteira: os dois confiam em hops
que o atacante controla e reintroduzem o spoof (qualquer cliente fura TODOS os
baldes por IP).

**2) Caddy — `trusted_proxies` (Caddyfile).** Por padrão o Caddy **ignora** o
`X-Forwarded-For` que recebe e o **substitui** pelo IP do peer imediato. Atrás do
túnel esse peer é o container do `cloudflared` (`172.28.0.5`, privado) — então
**todo o tráfego do túnel cai no MESMO balde** (ex.: 5 cadastros/hora para o
mundo inteiro, um DoS trivial de login/registro). Para corrigir, o `Caddyfile`
declara no bloco global:

```
{
	servers {
		trusted_proxies static 172.28.0.5/32
	}
}
```

Com isso o Caddy **anexa** o IP real do cliente vindo do túnel em vez de
descartá-lo (e habilita o *client IP parsing* para todos os proxy handlers). Só
o `cloudflared` é confiado — **não** a subnet inteira nem o gateway.

### Como testar (probe de spoof)

O baixo custo de um ataque justifica o teste. Com a stack no ar, dispare 15
`POST /api/auth/login` com **emails diferentes** (para isolar o balde por email)
e um `X-Forwarded-For` forjado e rotativo em cada um, **reiniciando o backend
antes** de cada alvo (os baldes são em memória):

```bash
# esperado: [401 x10, 429 x5] nos caminhos via proxy/túnel (o 11º request é 429)
node xff-probe.mjs "http://localhost:8090/api/auth/login" 15
node xff-probe.mjs "https://<tunel>.trycloudflare.com/api/auth/login" 15
```

```powershell
docker compose restart backend; Start-Sleep 12
node xff-probe.mjs "http://localhost:8090/api/auth/login" 15
```

Em `:4100` **fora do loopback** a conexão deve ser **recusada** (nada
publicado). No loopback, `localhost:4100` (backend direto) é seguro: o peer é o
gateway `172.28.0.1`, que **não** está no `TRUST_PROXY`, então o
`X-Forwarded-For` forjado é ignorado e o balde fica com uma chave estável.

O antigo risco residual de `localhost:3000` (rewrite `/api` do Next repassando o
`X-Forwarded-For` recebido, com o container do frontend confiável) **deixou de
existir**: o frontend agora é estático e o Caddy é o único hop HTTP até o backend.

**IP real sobrevive ao túnel?** Faça uma requisição pelo túnel e leia o log do
backend — o `remoteAddress` deve ser **o seu IP público atual**, nunca
`172.28.x.x`:

```bash
curl https://<tunel>.trycloudflare.com/api/health
docker compose logs backend --tail 20
# {"req":{"url":"/api/health","host":"<tunel>.trycloudflare.com","remoteAddress":"<SEU-IP-PUBLICO>"},...}
```

### HTTP fora de localhost: o cookie `Secure` é descartado

No container o backend roda com `NODE_ENV=production`, então o cookie de auth
(`token`) é setado com `Secure` (`apps/server/src/routes/auth.ts`). Browsers só
aceitam cookie `Secure` em HTTPS **ou** em `localhost`.

Consequência prática: se você acessar por **HTTP puro num endereço que não é
localhost** (ex.: `http://<IP-da-LAN>:8090`), o browser **descarta** o cookie. O
`POST /api/auth/login` responde `200` e parece ter logado, mas a requisição
seguinte chega sem cookie e volta `401` — o login "passa" e não persiste.

Como resolver:

- **Use o túnel (HTTPS):** o `https://<aleatorio>.trycloudflare.com` é TLS, então
  o cookie `Secure` é aceito e a sessão persiste. É o caminho recomendado.
- **Use `http://localhost:8090`** no próprio host (localhost é isento da regra).
- Em dev no host (`npm run dev`, `NODE_ENV=development`) o cookie **não** é
  `Secure`, então HTTP na LAN funciona — a limitação é só no container.

### Como restringir acesso

- **Compartilhe o link só com quem deve entrar.** Trate a URL como uma senha.
- **Use salas com senha** (e/ou `inviteToken`) para que o link da sala sozinho
  não baste.
- **Derrube o túnel quando não estiver usando:**
  `docker compose --profile tunnel down`. Como a URL muda a cada start, isso
  invalida os links antigos de imediato.
- **Não confie na URL como controle de acesso.** Para uma fronteira de verdade,
  use um túnel nomeado com Cloudflare Access (abaixo).

---

## Caminho futuro: túnel nomeado com domínio próprio

O túnel rápido é o passo barato. Quando quiser uma URL estável (e políticas de
acesso), migre para um **túnel nomeado**: requer conta Cloudflare, um domínio e
um `CLOUDFLARE_TUNNEL_TOKEN` (não commite o token).

O roteamento **não muda**: o túnel nomeado aponta para o mesmo proxy interno
(`http://proxy:8080`) e o `Caddyfile` continua dividindo `/socket.io` e o resto.
O que muda é só a borda (nome fixo + políticas), via um `ingress` equivalente:

```yaml
# config.yml do túnel nomeado (o mesmo papel do `--url http://proxy:8080`)
ingress:
  - hostname: scale.seudominio.com
    service: http://proxy:8080
  - service: http_status:404
```

No compose, o serviço trocaria o comando por:

```yaml
command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
```

Com domínio próprio e Cloudflare Access você ganha: URL estável, WAF/regras de
borda e autenticação na frente do app (por exemplo, exigir e-mail/SSO antes de
chegar ao Scale).

---

## Troubleshooting

### A URL não aparece nos logs

```bash
docker compose ps
docker compose logs cloudflared
```

- O `cloudflared` precisa de saída para a internet (porta 443).
- Ele só sobe com `--profile tunnel`.
- Se o `proxy` estiver `unhealthy`, o `cloudflared` não inicia
  (`depends_on: proxy: service_healthy`). Veja `docker compose logs proxy`.

### Página abre, mas a sala não conecta

O signaling (Socket.io) precisa chegar ao backend via `/socket.io/*` no proxy.
Confirme pelo host:

```bash
curl "http://localhost:8080/socket.io/?EIO=4&transport=polling"
```

Espera-se um payload começando com `0{...` (o handshake do Socket.io).

Se a resposta for `404` com `Route GET:/?EIO=4&transport=polling not found`, o
`Caddyfile` está usando `handle_path /socket.io/*`, que **apaga o prefixo casado**
antes do `reverse_proxy` e manda `/?EIO=4&...` para o backend. O correto é
`handle /socket.io/*`: casa o path e mantém `/socket.io/...` intacto.

Para checar o upgrade de WebSocket (o `signaling` da sala), peça o upgrade com
curl — a resposta deve começar com `HTTP/1.1 101 Switching Protocols` (se vier
`200`/`404`, o proxy não está fazendo o upgrade e a sala não conecta):

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "http://localhost:8080/socket.io/?EIO=4&transport=websocket"
```

Depois do `101`, o servidor manda o frame `0{...}` do handshake do Engine.io —
o mesmo payload do handshake de polling, agora pelo WebSocket.

### Erros 429 em excesso (todo o tráfego do túnel num balde só)

Se **todos** os usuários do túnel passarem a bater no mesmo 429 (ex.: o 6º
cadastro de qualquer pessoa já é recusado), o IP real do cliente **não** está
sobrevivendo ao proxy. Verifique:

1. `Caddyfile` tem o bloco global `servers { trusted_proxies static
   172.28.0.5/32 }`? Sem ele o Caddy substitui o `X-Forwarded-For` pelo IP do
   `cloudflared` e todo o túnel vira uma chave só.
2. `TRUST_PROXY` no `docker-compose.yml` ainda lista os hops reais
   (`172.28.0.4/32,172.28.0.5/32`) e **não** a subnet inteira nem
   `true`?
3. O log do backend mostra `remoteAddress` = **seu IP público** para uma linha
   com `host=<tunel>.trycloudflare.com`? Se mostrar `172.28.x.x`, o IP real se
   perdeu em algum hop.

Em produção (`NODE_ENV=production` no container) os baldes por IP valem de
verdade — não há isenção de loopback.
