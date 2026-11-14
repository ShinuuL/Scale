import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { ApplicationFeatures } from './ApplicationFeatures';

const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
const notification = vi.fn();

beforeEach(() => {
  localStorage.clear();
  notification.mockClear();
  requestPermission.mockClear();
  const MockNotification = Object.assign(function (title: string, options: NotificationOptions) {
    notification(title, options);
    return { close: vi.fn() };
  }, { permission: 'granted', requestPermission });
  vi.stubGlobal('Notification', MockNotification);
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('optional application features', () => {
  it('requests permission only after an explicit click, and can be disabled', async () => {
    render(<ApplicationFeatures />);
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Aplicativo e notificações'));
    fireEvent.click(screen.getByRole('button', { name: 'Ativar notificações' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Desativar notificações' })).toBeInTheDocument());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Desativar notificações' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ativar notificações' })).toBeInTheDocument());
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
  it('only notifies opted-in hidden pages, with generic copy and throttling', () => {
    localStorage.setItem('scale:notifications', 'on');
    render(<ApplicationFeatures />);
    const notify = () => window.dispatchEvent(new CustomEvent('scale:notification', { detail: { tag: 'room', body: 'private secret', title: 'Private Name' } }));
    act(notify);
    expect(notification).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(notify);
    act(notify);
    expect(notification).toHaveBeenCalledTimes(1);
    expect(notification).toHaveBeenCalledWith('Scale', expect.objectContaining({ body: 'Nova atividade no Scale. Abra o aplicativo para conferir.' }));
    expect(JSON.stringify(notification.mock.calls)).not.toContain('private secret');
  });
  it('shows connection recovery guidance and cleans up listeners', () => {
    const { unmount } = render(<ApplicationFeatures />);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByText('Sem conexão com o servidor')).toBeInTheDocument();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByText('Sem conexão com o servidor')).not.toBeInTheDocument();
    unmount();
    act(() => window.dispatchEvent(new CustomEvent('scale:notification', { detail: { tag: 'after-unmount' } })));
    expect(notification).not.toHaveBeenCalled();
  });
  it('defers installation until requested and handles a rejected prompt', async () => {
    render(<ApplicationFeatures />);
    const prompt = vi.fn(async () => { throw new Error('blocked'); });
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Aplicativo e notificações'));
    fireEvent.click(screen.getByRole('button', { name: 'Instalar Scale' }));
    await waitFor(() => expect(screen.getByText('Use o menu do navegador para instalar o Scale.')).toBeInTheDocument());
  });
  it('returns focus to the visible header trigger after Escape', () => {
    render(<><button data-app-settings-trigger onClick={(event) => window.dispatchEvent(new CustomEvent('scale:app-settings', { detail: { trigger: event.currentTarget } }))}>Abrir recursos do aplicativo</button><ApplicationFeatures /></>);
    const trigger = screen.getByRole('button', { name: 'Abrir recursos do aplicativo' });
    const summary = screen.getByText('Aplicativo e notificações').closest('summary')!;
    // Pointer clicks need not focus buttons on every browser: the event carries the trigger explicitly.
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(summary);
    expect(summary.parentElement).toHaveAttribute('open');
    fireEvent.keyDown(summary, { key: 'Escape' });
    expect(summary.parentElement).not.toHaveAttribute('open');
    expect(document.activeElement).toBe(trigger);
  });

  it('uses the header trigger when the original drawer trigger has unmounted', () => {
    render(<><button data-app-settings-trigger>Recursos no cabeçalho</button><ApplicationFeatures /></>);
    const drawer = document.createElement('dialog');
    drawer.open = true;
    const drawerTrigger = document.createElement('button');
    drawer.appendChild(drawerTrigger);
    document.body.appendChild(drawer);
    act(() => window.dispatchEvent(new CustomEvent('scale:app-settings', { detail: { trigger: drawerTrigger } })));
    drawer.remove();
    const summary = screen.getByText('Aplicativo e notificações').closest('summary')!;
    fireEvent.keyDown(summary, { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recursos no cabeçalho' }));
  });

  it('retains focus on the native summary when no shell trigger exists', () => {
    render(<ApplicationFeatures />);
    const summary = screen.getByText('Aplicativo e notificações').closest('summary')!;
    summary.focus();
    fireEvent.click(summary);
    expect(summary.parentElement).toHaveAttribute('open');
    fireEvent.keyDown(summary, { key: 'Escape' });
    expect(summary.parentElement).not.toHaveAttribute('open');
    expect(document.activeElement).toBe(summary);
  });

  it('guides iOS Safari through Add to Home Screen and remembers "Agora não"', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });
    onTestFinished(() => { Reflect.deleteProperty(navigator, 'userAgent'); });
    const { unmount } = render(<ApplicationFeatures />);
    const offer = screen.getByRole('complementary', { name: 'Instalar o Scale' });
    expect(offer).toHaveTextContent('Adicionar à Tela de Início');
    expect(offer).toHaveTextContent('iOS 16.4');
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(screen.queryByRole('complementary', { name: 'Instalar o Scale' })).not.toBeInTheDocument();
    expect(localStorage.getItem('scale:install-offer')).toBe('dismissed');
    unmount();
    render(<ApplicationFeatures />);
    expect(screen.queryByRole('complementary', { name: 'Instalar o Scale' })).not.toBeInTheDocument();
  });
  it('hides installation when already running standalone', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<ApplicationFeatures />);
    const prompt = Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome: 'dismissed' as const }) });
    act(() => { window.dispatchEvent(prompt); });
    expect(screen.queryByRole('button', { name: 'Instalar Scale' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Instalar o Scale' })).not.toBeInTheDocument();
  });
});
