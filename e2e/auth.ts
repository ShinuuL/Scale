import { expect, Page } from '@playwright/test';

/**
 * Ajuda de autenticação para os specs E2E.
 *
 * `POST /api/rooms` passou a EXIGIR login (regra de negócio): criar sala sem
 * sessão devolve 401. Os specs criam a sala pela API (mesmo proxy /api do Next
 * que o browser usa), então precisam registrar/logar antes.
 *
 * `page.request` compartilha o storage de cookies com o BrowserContext do
 * `page`; logo, o cookie HttpOnly `token` setado no register fica disponível
 * para as chamadas seguintes via `page.request` (e para o browser navegar já
 * autenticado).
 */

let counter = 0;

export interface E2EUser {
  email: string;
  password: string;
  name: string;
}

/** Registra um usuário único e devolve as credenciais usadas. */
export async function registerUser(page: Page): Promise<E2EUser> {
  counter += 1;
  // Unicidade robusta: cada worker do Playwright carrega este módulo do zero
  // (counter reinicia em 0), então Date.now()+counter ainda pode colidir entre
  // workers no mesmo milissegundo. O sufixo aleatório elimina a colisão.
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `e2e-${Date.now()}-${counter}-${suffix}@scale.test`;
  const password = 'senha-e2e-123';
  const name = `E2E ${counter}`;

  const res = await page.request.post('/api/auth/register', {
    data: { email, password, name },
  });
  expect(
    res.ok(),
    `POST /api/auth/register -> ${res.status()} ${await res.text()}`,
  ).toBeTruthy();

  return { email, password, name };
}

export interface CreateRoomOptions {
  name: string;
  isPersistent?: boolean;
  isPrivate?: boolean;
}

/**
 * Registra um usuário (login obrigatório para criar sala) e cria a sala pelo
 * mesmo proxy /api que o browser usa. Devolve o id da sala.
 */
export async function registerAndCreateRoom(
  page: Page,
  opts: CreateRoomOptions,
): Promise<string> {
  await registerUser(page);

  const res = await page.request.post('/api/rooms', {
    data: {
      name: opts.name,
      isPersistent: opts.isPersistent ?? false,
      isPrivate: opts.isPrivate ?? false,
    },
  });
  expect(
    res.ok(),
    `POST /api/rooms -> ${res.status()} ${await res.text()}`,
  ).toBeTruthy();

  const body = (await res.json()) as { room: { id: string } };
  return body.room.id;
}
