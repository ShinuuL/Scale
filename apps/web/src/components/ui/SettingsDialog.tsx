'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AVATAR_FILE_ACCEPT, MAX_AVATAR_SIZE_BYTES, USER_NAME_MAX, USERNAME_MAX, usernameSchema } from '@scale/shared';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { ThemePicker } from '@/components/ui/ThemePicker';
import { api, avatarUrl, type MeUser } from '@/lib/api';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SettingsDialogProps {
  /** Conta logada; null = convidado (so o tema aparece). */
  user: MeUser | null;
  onClose: () => void;
  /** Perfil salvo no servidor (nome ou foto). */
  onUserChange?: (user: MeUser) => void;
}

function errorMessage(err: unknown, fallback: string): string {
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? (err as { status?: unknown }).status
      : undefined;
  if (status === 409) return 'Esse @nome já está em uso. Escolha outro.';
  if (status === 413) return 'A foto passa de 32 MB.';
  if (status === 400) return 'Formato não aceito. Use PNG, JPEG ou WebP.';
  if (status === 429) return 'Muitas alterações seguidas. Tente de novo em alguns minutos.';
  if (status === 401) return 'Sua sessão expirou. Entre de novo.';
  return fallback;
}

/**
 * Configurações (role="dialog"): perfil (nome e foto, só com conta) e tema.
 * Foco preso, Esc fecha e o foco volta ao gatilho.
 */
export function SettingsDialog({ user, onClose, onUserChange }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [busy, setBusy] = useState<'name' | 'username' | 'avatar' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  const trimmed = name.trim();
  const nameChanged = !!user && trimmed.length > 0 && trimmed !== user.name;

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameChanged) return;
    setBusy('name');
    setError(null);
    setSaved(null);
    try {
      const res = await api.updateProfile({ name: trimmed });
      onUserChange?.(res.user);
      setSaved('Nome atualizado.');
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar o nome.'));
    } finally {
      setBusy(null);
    }
  };

  const usernameParsed = usernameSchema.safeParse(username);
  const usernameChanged =
    !!user && usernameParsed.success && usernameParsed.data !== (user.username ?? '');
  const usernameHint =
    username.trim() && !usernameParsed.success ? usernameParsed.error.issues[0]?.message : undefined;

  const saveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameChanged || !usernameParsed.success) return;
    setBusy('username');
    setError(null);
    setSaved(null);
    try {
      const res = await api.setUsername(usernameParsed.data);
      onUserChange?.(res.user);
      setUsername(res.user.username ?? '');
      setSaved('@nome atualizado.');
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar o @nome.'));
    } finally {
      setBusy(null);
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setSaved(null);
    // Feedback imediato; o servidor revalida tamanho e formato.
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      setError('A foto passa de 32 MB.');
      return;
    }
    setBusy('avatar');
    try {
      const res = await api.uploadAvatar(file);
      onUserChange?.(res.user);
      setSaved('Foto atualizada.');
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível enviar a foto.'));
    } finally {
      setBusy(null);
    }
  };

  const removeAvatar = async () => {
    setBusy('avatar');
    setError(null);
    setSaved(null);
    try {
      const res = await api.deleteAvatar();
      onUserChange?.(res.user);
      setSaved('Foto removida.');
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível remover a foto.'));
    } finally {
      setBusy(null);
    }
  };

  const photo = avatarUrl(user?.avatarUpdatedAt);

  // Portal no <body>: o header usa backdrop-blur, que vira bloco de contencao
  // de `fixed` — dentro dele o fundo nao cobria a tela (clique fora nao
  // fechava) e o topo do dialogo (foto) ficava cortado.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-forest-950/80 p-4 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={handleKeyDown}
        className="max-h-[calc(100vh-2rem)] w-full max-w-md space-y-5 overflow-y-auto rounded-2xl border border-white/10 bg-forest-900 p-6 shadow-2xl shadow-black/40"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="settings-title" className="flex items-center gap-2 text-base font-semibold text-white">
            <Icon name="settings" size={18} className="text-slate-400" />
            Configurações
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar configurações"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
          >
            <Icon name="close" />
          </button>
        </div>

        {user ? (
          <section aria-labelledby="settings-profile" className="space-y-4">
            <h3 id="settings-profile" className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Perfil
            </h3>

            <div className="flex items-center gap-4">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- export estatico, sem otimizador de imagem
                <img src={photo} alt="Sua foto de perfil" className="h-16 w-16 flex-shrink-0 rounded-full object-cover" />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-brand-600/30 text-xl font-semibold text-brand-200"
                >
                  {(user.name.trim().charAt(0) || '?').toUpperCase()}
                </span>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept={AVATAR_FILE_ACCEPT}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => void onPickFile(e)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy !== null}
                  aria-busy={busy === 'avatar'}
                >
                  <Icon name="image" size={14} />
                  {busy === 'avatar' ? 'Enviando...' : photo ? 'Trocar foto' : 'Enviar foto'}
                </Button>
                {photo && (
                  <Button variant="ghost" size="sm" onClick={() => void removeAvatar()} disabled={busy !== null}>
                    Remover
                  </Button>
                )}
                <p className="w-full text-xs text-slate-400">PNG, JPEG ou WebP, até 32 MB.</p>
              </div>
            </div>

            <form onSubmit={(e) => void saveName(e)} className="space-y-3">
              <Input
                id="settings-name"
                label="Nome de usuário"
                value={name}
                maxLength={USER_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                autoComplete="nickname"
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={!nameChanged || busy !== null} aria-busy={busy === 'name'}>
                  {busy === 'name' ? 'Salvando...' : 'Salvar nome'}
                </Button>
              </div>
            </form>

            <form onSubmit={(e) => void saveUsername(e)} className="space-y-3">
              <Input
                id="settings-username"
                label="@nome (para amizades)"
                value={username}
                maxLength={USERNAME_MAX + 1}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                spellCheck={false}
                placeholder="ex.: shinuu"
                error={usernameHint}
                helperText="Único. Letras sem acento, números e _, de 3 a 20 caracteres."
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={!usernameChanged || busy !== null}
                  aria-busy={busy === 'username'}
                >
                  {busy === 'username' ? 'Salvando...' : 'Salvar @nome'}
                </Button>
              </div>
            </form>
          </section>
        ) : (
          <p className="text-sm text-slate-400">Entre com sua conta para alterar nome e foto de perfil.</p>
        )}

        {(error || saved) && (
          <p
            role={error ? 'alert' : 'status'}
            className={
              error
                ? 'rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300'
                : 'rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-200'
            }
          >
            {error ?? saved}
          </p>
        )}

        <section aria-labelledby="settings-theme" className="space-y-3 border-t border-white/[0.08] pt-4">
          <h3 id="settings-theme" className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Tema
          </h3>
          <ThemePicker />
        </section>
      </div>
    </div>,
    document.body,
  );
}
