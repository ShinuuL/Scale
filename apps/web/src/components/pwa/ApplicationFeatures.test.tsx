import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
});
