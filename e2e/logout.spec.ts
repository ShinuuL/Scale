import { test, expect } from '@playwright/test';
import { registerUser } from './auth';

/** Logoff pelo menu de perfil: o cookie de sessão some e a home volta a ser de visitante. */
test('sair da conta encerra a sessão e volta como visitante', async ({ page }) => {
  const user = await registerUser(page);
  await page.goto('/');
  const trigger = page.getByRole('button', { name: `Perfil de ${user.name}` });
  await expect(trigger).toBeVisible();

  await trigger.click();
  await page.getByRole('menuitem', { name: 'Sair da conta' }).click();

  await expect(page.getByRole('button', { name: `Perfil de ${user.name}` })).toHaveCount(0);
  const me = await page.request.get('/api/auth/me');
  expect(me.status()).toBe(401);
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'token')).toBeUndefined();
});
