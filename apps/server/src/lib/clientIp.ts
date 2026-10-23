import type { IncomingMessage } from 'node:http';
import type { FastifyRequest } from 'fastify';
import proxyAddr from '@fastify/proxy-addr';

/**
 * IP do cliente — fonte única para TODOS os rate limits por IP.
 *
 * O IP que entra na chave do balde NUNCA vem de um header controlado pelo
 * cliente. Ele só pode vir de:
 *  1. O IP da conexão TCP (`request.socket.remoteAddress`, o peer) — não é
 *     forjável; é o que vale quando não há proxy confiável configurado.
 *  2. `request.ip` quando o Fastify já resolveu o `X-Forwarded-For` contra os
 *     hops confiáveis (`TRUST_PROXY=<cidr>`): o Fastify descarta os hops não
 *     confiáveis, então os valores que o cliente injeta à esquerda do header são
 *     ignorados. Como `getClientIp` delega a checagem de CIDR ao Fastify, não
 *     reimplementamos um matcher próprio (que poderia ter bug).
 * Nós NÃO lemos `cf-connecting-ip`: ngrok e proxies locais não sobrescrevem esse
 * header, então confiar nele fora da borda da Cloudflare é spoofável. O
 * `X-Forwarded-For` resolvido pelo túnel (que sempre anexa o hop real) basta.
 *
 * Caveat documentado: como `getClientIp` compara `request.ip` com o peer,
 * `TRUST_PROXY` desligado (ou ausente — o default é fail-closed, ver
 * lib/env.ts) faz os headers de proxy serem ignorados por completo.
 */

/**
 * Converte a env `TRUST_PROXY` no valor aceito pelo Fastify.
 *
 * Formas aceitas:
 *  - `false` / vazio (DEFAULT, fail-closed): não confia em nenhum proxy
 *    (`request.ip` = IP do peer). É o valor correto quando não há proxy na
 *    frente e o único seguro para não permitir spoof de X-Forwarded-For.
 *  - lista de CIDRs/IPs separada por vírgula (ex.: `"127.0.0.1/8,::1/128"` ou
 *    `"loopback"`): confia só nos hops que casam — recomendado em produção
 *    atrás do túnel.
 *  - `true`: confia em TODOS os hops. Use apenas em dev com proxy local de sua
 *    confiança; com `true` qualquer cliente forja `X-Forwarded-For` e fura
 *    TODOS os baldes por IP.
 *
 * Números (contagem de hops) NÃO são aceitos: o Fastify 5.12 trata `number`
 * como "não confiar em ninguém" (fail-closed — ver lib/request.js
 * getTrustProxyFn), e confiar cegamente nos N primeiros hops permitiria a um
 * cliente direto forjar X-Forwarded-For. Para 1 hop confiável, use o CIDR do
 * proxy (ex.: `"127.0.0.1/8"` quando o túnel roda na mesma máquina).
 */
export function resolveTrustProxy(raw: string | undefined): boolean | string | string[] {
  const value = (raw ?? '').trim().toLowerCase();
  // Fail-closed: sem configuração explícita nenhum header de proxy é aceito.
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) {
    throw new Error(
      `TRUST_PROXY inválido: "${raw}" — contagem de hops não é suportada (o Fastify 5.12 trata número como fail-closed). Informe o CIDR do proxy, ex.: "127.0.0.1/8" ou "loopback".`,
    );
  }
  // Lista de CIDRs/IPs do proxy (ex.: "10.0.0.0/8,172.16.0.0/12").
  const list = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length === 0) {
    throw new Error(`TRUST_PROXY inválido: "${raw}" (use true|false|<cidr,cidr>)`);
  }
  return list;
}

/**
 * IP do peer direto (a conexão TCP). Não é forjável; serve de fallback e de
 * referência para saber se um proxy confiável está na frente.
 */
export function getPeerIp(request: FastifyRequest): string {
  return request.socket.remoteAddress ?? '';
}

/**
 * IP do cliente usado como chave dos rate limits por IP.
 * Ver o comentário do topo para a justificativa anti-spoof.
 */
export function getClientIp(request: FastifyRequest): string {
  const peer = getPeerIp(request);
  const resolved = request.ip || peer;

  // Caminho NÃO confiável (TRUST_PROXY=false — o default): o Fastify mantém
  // `request.ip` = IP do socket e ignora X-Forwarded-For/cf-connecting-ip.
  // Devolvemos o peer e nenhum header entra na chave do balde: spoof impossível.
  if (resolved === peer) return peer;

  // Caminho confiável (TRUST_PROXY=true|<cidr>): `request.ip` já é o
  // X-Forwarded-For resolvido pelo Fastify contra os hops confiáveis — valores
  // forjados à esquerda do header são descartados pelo próprio Fastify.
  return resolved;
}

/**
 * Loopback (127.0.0.0/8 e ::1) — a própria máquina.
 *
 * Rate limits por IP só fazem sentido para tráfego EXTERNO. O tráfego local é o
 * dev, a suite E2E e o proxy `/api` do Next na mesma máquina; um único balde
 * para tudo isso inviabilizaria a suíte (só o E2E cadastra ~17 contas por run) e
 * o desenvolvimento. Este é o mesmo critério que o antigo `checkTailscale` usava
 * para liberar localhost.
 */
export function isLocalAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  if (ip === '::1') return true;
  // IPv4 mapeado em IPv6 (ex.: ::ffff:127.0.0.1) — como o Node reporta em
  // sockets dual-stack.
  if (ip.toLowerCase().startsWith('::ffff:')) return isLocalAddress(ip.slice(7));
  return ip.startsWith('127.');
}

/**
 * Isenção de loopback para os baldes por IP — usada por lib/rateLimit.ts.
 *
 * Vale APENAS fora de produção (`NODE_ENV !== 'production'`). Em dev/E2E tudo
 * (browser, proxy `/api` do Next e backend) compartilha 127.0.0.1, então um
 * balde único inviabilizaria a suíte.
 *
 * Em PRODUÇÃO atrás de um túnel no mesmo host TODOS os requests chegam com o IP
 * do túnel (127.0.0.1): isentar aqui desligaria silenciosamente TODOS os baldes
 * por IP. Por isso em produção a isenção não existe — o limite vale (pelo IP do
 * proxy quando `TRUST_PROXY` não está configurado, ou pelo IP real do cliente
 * quando `TRUST_PROXY` aponta o CIDR do proxy/túnel).
 */
export function isRateLimitExempt(ip: string | undefined): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return isLocalAddress(ip);
}

/**
 * IP do cliente de uma conexao Socket.io (handshake HTTP), com a MESMA regra do
 * Fastify: o X-Forwarded-For so e lido quando o peer casa com TRUST_PROXY
 * (@fastify/proxy-addr, o mesmo resolvedor que o Fastify usa). Com
 * TRUST_PROXY=false (default) devolve o peer TCP.
 */
export function getSocketClientIp(req: IncomingMessage, trustProxyRaw: string | undefined): string {
  const peer = req.socket?.remoteAddress ?? '';
  const trust = resolveTrustProxy(trustProxyRaw);
  if (trust === false) return peer;
  try {
    return proxyAddr(req, trust === true ? () => true : proxyAddr.compile(trust)) || peer;
  } catch {
    return peer;
  }
}
