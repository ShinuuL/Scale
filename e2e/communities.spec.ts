import { expect, test, type Browser, type Page } from '@playwright/test';
import { registerUser } from './auth';

/**
 * Fase 1 das comunidades: presenca, nao lidas, categorias, menu de membro,
 * reordenar comunidades e ocultar a barra lateral. Dois usuarios reais
 * (contextos separados) conversando pelo backend de dev.
 */

async function newUser(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await registerUser(page);
  const res = await page.request.put('/api/me/username', { data: { username } });
  expect(res.ok(), `username -> ${res.status()}`).toBeTruthy();
  return page;
}

test('comunidade: presenca, nao lidas, categorias e menu de membro', async ({ browser }) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const owner = await newUser(browser, `dono_${suffix}`);
  const member = await newUser(browser, `membro_${suffix}`);

  const created = await owner.request.post('/api/communities', { data: { name: `Teste ${suffix}` } });
  expect(created.status()).toBe(201);
  const { community } = (await created.json()) as { community: { id: string } };
  const invite = await owner.request.post(`/api/communities/${community.id}/invites`, { data: {} });
  const { invite: inv } = (await invite.json()) as { invite: { code: string } };
  expect((await member.request.post('/api/invites/accept', { data: { code: inv.code } })).ok()).toBeTruthy();

  // Segundo canal de texto para gerar nao lidas fora do canal aberto.
  const channelRes = await owner.request.post(`/api/communities/${community.id}/channels`, {
    data: { name: 'avisos', kind: 'TEXT' },
  });
  const { channel } = (await channelRes.json()) as { channel: { id: string } };

  await owner.goto(`/communities?c=${community.id}`);
  await member.goto(`/communities?c=${community.id}`);
  await owner.setViewportSize({ width: 1440, height: 900 });
  await member.setViewportSize({ width: 1440, height: 900 });

  // Presenca: os dois aparecem online para o dono.
  const ownerMembers = owner.getByRole('complementary', { name: 'Membros' });
  await expect(ownerMembers.getByText('Online — 2')).toBeVisible();

  // Nao lidas: dono posta em "avisos"; membro esta em "geral".
  await expect(member.getByRole('button', { name: /geral/ }).first()).toBeVisible();
  const post = await owner.request.post(`/api/channels/${channel.id}/messages`, { data: { content: 'oi pessoal' } });
  expect(post.ok()).toBeTruthy();
  const avisos = member.getByRole('button', { name: /avisos.*1 mensagem/ });
  await expect(avisos).toBeVisible();
  await avisos.click();
  await expect(member.getByText('oi pessoal')).toBeVisible();
  await expect(member.getByRole('button', { name: /avisos.*mensage/ })).toHaveCount(0);

  // Categoria criada pelo dono aparece e recolhe.
  const cat = await owner.request.post(`/api/communities/${community.id}/categories`, { data: { name: 'Projetos' } });
  expect(cat.status()).toBe(201);
  const categoryButton = owner.getByRole('button', { name: /Projetos/i });
  await expect(categoryButton).toBeVisible();
  await expect(categoryButton).toHaveAttribute('aria-expanded', 'true');
  await categoryButton.click();
  await expect(categoryButton).toHaveAttribute('aria-expanded', 'false');

  // Menu de contexto do membro: perfil e adicionar amigo.
  const memberRow = ownerMembers.getByRole('button', { name: /Opções de .*online/ }).filter({ hasNotText: '(você)' });
  await memberRow.click({ button: 'right' });
  await expect(owner.getByRole('menuitem', { name: /Adicionar amigo/ })).toBeVisible();
  await owner.getByRole('menuitem', { name: /Ver perfil/ }).click();
  await expect(owner.getByText(`@membro_${suffix}`)).toBeVisible();
  await owner.getByRole('button', { name: 'Fechar perfil' }).click();
  await ownerMembers.getByRole('button', { name: /como amigo/ }).click();
  await expect(owner.getByText(/Pedido de amizade enviado/)).toBeVisible();

  // Presenca: membro sai, dono ve 1 online.
  await member.context().close();
  await expect(ownerMembers.getByText('Online — 1')).toBeVisible();
  await expect(ownerMembers.getByText('Offline — 1')).toBeVisible();

  // Barra lateral principal oculta e volta.
  await owner.getByRole('button', { name: 'Ocultar barra lateral' }).click();
  await expect(owner.getByRole('complementary', { name: 'Navegação principal' })).toBeHidden();
  await owner.getByRole('button', { name: 'Mostrar barra lateral' }).click();
  await expect(owner.getByRole('complementary', { name: 'Navegação principal' })).toBeVisible();

  await owner.context().close();
});

test('comunidade: reordenar blocos com Alt+seta persiste', async ({ browser }) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const page = await newUser(browser, `ordem_${suffix}`);
  for (const name of ['Alfa', 'Beta']) {
    expect((await page.request.post('/api/communities', { data: { name: `${name} ${suffix}` } })).status()).toBe(201);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/communities');
  const rail = page.getByRole('navigation', { name: 'Comunidades' });
  const names = () => rail.getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
  await expect.poll(async () => (await names()).filter((n) => n.includes(suffix)).length).toBe(2);
  const before = (await names()).filter((n) => n.includes(suffix));
  await rail.getByRole('button', { name: before[1]! }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(async () => (await names()).filter((n) => n.includes(suffix))).toEqual([before[1], before[0]]);
  await page.reload();
  await expect.poll(async () => (await names()).filter((n) => n.includes(suffix))).toEqual([before[1], before[0]]);
  await page.context().close();
});
