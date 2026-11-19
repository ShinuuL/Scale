# Servidor MCP (apps conectados)

O Scale expõe um servidor [MCP](https://modelcontextprotocol.io) para que um
assistente de IA (Claude Desktop, Claude Code, claude.ai ou outro cliente MCP)
leia e envie mensagens e configure comunidades **em nome do usuário**, com
autorização explícita dele.

- Endereço: `<origem do Scale>/mcp` (ex.: `https://scale.nexushosts.tech:8443/mcp`).
- Transporte: Streamable HTTP sem estado (`POST /mcp`, resposta JSON).
- Autorização: OAuth 2.1 com PKCE S256 e registro dinâmico de cliente.
  O cliente MCP descobre tudo sozinho a partir do `401` do `/mcp`.

## Como conectar

**Claude Code**

```bash
claude mcp add --transport http scale https://scale.nexushosts.tech:8443/mcp
```

Na primeira chamada o Claude Code abre o navegador na tela de consentimento
do Scale. Entre na conta (se precisar), confira as permissões e clique em
**Autorizar**.

**Claude Desktop / claude.ai**

Configurações > Conectores > Adicionar conector personalizado, URL acima.

O usuário vê e desconecta os apps em **Configurações > Apps conectados**.
Quando não há nenhum, a seção mostra o endereço para copiar.

## Permissões (escopos)

| Escopo | O que libera |
|---|---|
| `channels` | Listar comunidades, ler canais e tópicos, buscar, enviar mensagem em canal e tópico |
| `community.manage` | Criar/editar/apagar canais e categorias, configurar canal (avisos, modo lento, permissões), reordenar, cargos personalizados, boas-vindas |
| `room.chat` | Listar as salas de voz em que o usuário está, ler e enviar no chat delas |

Sem `scope` no pedido, o app recebe os três. Um app já conectado que pede mais
escopos vê só os novos destacados na tela de consentimento.

## Regras

- **O app nunca tem mais poder que o usuário.** Cada ferramenta chama a rota
  REST de sempre por `app.inject`, como o próprio usuário (JWT de 60 s que não
  sai do processo). Valem permissões de canal, cargos, castigo, modo lento,
  canal de avisos, baldes por usuário e os eventos em tempo real.
- **Sem modo oculto.** Mensagem enviada por app grava `ChatMessage.viaApp`
  (nome do app) e aparece com o selo "via <app>" no canal, no tópico e no chat
  da sala. Ações de configuração gravam `CommunityAuditLog.viaApp` e a
  auditoria mostra "<ator> via <app>".
- A marca "via app" só nasce dentro do servidor: a ferramenta manda um nonce de
  uso único (`x-scale-via-app`, 32 bytes, 60 s, só na memória) que o hook
  `onRequest` troca pelo nome do app (`lib/viaApp.ts`). Cliente externo não
  consegue forjar.
- **Chat de sala** só funciona enquanto o usuário está NA sala (mesma regra de
  participação). O envio usa o socket dele e o mesmo handler do `chat:message`,
  então passa pela moderação de texto.
- O nome do app é **declarado pelo próprio cliente** no registro e não é
  verificado; a tela de consentimento diz isso e mostra o host de retorno.

## Tokens e sessões

- Cliente público (`token_endpoint_auth_method: none`); URL de retorno só
  `https://` ou `http://` em loopback (porta livre em loopback, RFC 8252).
- Código de autorização: memória, uso único, 10 min.
- Token de acesso: 1 h. Token de renovação: 30 dias, **rotativo** (usar apaga o
  anterior). Só o SHA-256 vai para o banco (`OAuthToken`).
- Desconectar (`DELETE /api/me/apps/:id`) apaga o `OAuthGrant` e derruba todos
  os tokens na hora. Sair da conta (`/api/auth/logout`) **não** desconecta
  apps: são autorizações independentes da sessão do navegador.
- Tokens vencidos são apagados pela varredura diária do servidor.

## Rotas

| Rota | Uso |
|---|---|
| `GET /.well-known/oauth-protected-resource[/mcp]` | Metadados do recurso (RFC 9728) |
| `GET /.well-known/oauth-authorization-server` | Metadados do servidor (RFC 8414) |
| `POST /api/oauth/register` | Registro dinâmico (RFC 7591) |
| `/oauth/authorize` (página) | Consentimento; usa as duas rotas abaixo |
| `GET /api/oauth/authorize/info` | Quem pede o quê (logado) |
| `POST /api/oauth/authorize/decision` | Autorizar ou cancelar (logado) |
| `POST /api/oauth/token` | Troca de código e renovação (form-urlencoded) |
| `POST /api/oauth/revoke` | Revogação (RFC 7009) |
| `GET /api/me/apps`, `DELETE /api/me/apps/:id` | Apps conectados |
| `POST /mcp` | JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call` |

`PUBLIC_URL` define a origem anunciada nos metadados; sem ela vale o host da
requisição. O Caddy encaminha `/mcp` e `/.well-known/oauth-*` ao backend.

## Limites

| Balde | Limite |
|---|---|
| `oauthRegister` | 10 / hora por IP |
| `oauthToken` | 60 / 10 min por IP |
| `mcpCall` | 60 / min por app conectado |

As rotas chamadas por dentro mantêm os baldes delas (ex.: mensagens por
usuário). Pelo túnel `*.trycloudflare.com` a URL muda a cada start: o app
conectado precisa ser reconectado com o endereço novo.
