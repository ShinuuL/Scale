'use client';

import { useRef, useState } from 'react';
import {
  AVATAR_FILE_ACCEPT,
  MAX_AVATAR_SIZE_BYTES,
  USER_NAME_MAX,
  USERNAME_MAX,
  usernameSchema,
} from '@scale/shared';
import { AppModal } from '@/components/ui/AppModal';
import { AudioSettings } from '@/components/ui/AudioSettings';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { LinkedAccounts } from '@/components/ui/LinkedAccounts';
import { PrivacySettings } from '@/components/ui/PrivacySettings';
import { ThemePicker } from '@/components/ui/ThemePicker';
import { api, avatarUrl, type MeUser } from '@/lib/api';

export interface SettingsDialogProps {
  /** Conta logada; null = convidado (so audio e tema aparecem). */
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
 * Configurações (AppModal/react-aria): perfil (nome e foto, só com conta),
 * áudio e tema. Foco preso, Esc e clique fora fecham, o foco volta ao gatilho.
 */
export function SettingsDialog({ user, onClose, onUserChange }: SettingsDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [busy, setBusy] = useState<'name' | 'username' | 'avatar' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

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
    username.trim() && !usernameParsed.success
      ? usernameParsed.error.issues[0]?.message
      : undefined;

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

  return (
    <AppModal
      title="Configurações"
      icon="settings"
      closeLabel="Fechar configurações"
      onClose={onClose}
    >
      <div className="space-y-5">
        {user ? (
          <section aria-labelledby="settings-profile" className="space-y-4">
            <h3 id="settings-profile" className="text-xs font-medium  text-ink-muted">
              Perfil
            </h3>

            <div className="flex items-center gap-4">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- export estatico, sem otimizador de imagem
                <img
                  src={photo}
                  alt="Sua foto de perfil"
                  className="h-16 w-16 flex-shrink-0 rounded-full object-cover"
                />
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void removeAvatar()}
                    disabled={busy !== null}
                  >
                    Remover
                  </Button>
                )}
                <p className="w-full text-xs text-ink-muted">PNG, JPEG ou WebP, até 32 MB.</p>
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
                <Button
                  type="submit"
                  size="sm"
                  disabled={!nameChanged || busy !== null}
                  aria-busy={busy === 'name'}
                >
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
          <p className="text-sm text-ink-muted">
            Entre com sua conta para alterar nome e foto de perfil.
          </p>
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

        {user && <LinkedAccounts />}

        {user && <PrivacySettings user={user} onUserChange={onUserChange} />}

        <AudioSettings />

        <section
          aria-labelledby="settings-theme"
          className="space-y-3 border-t border-white/[0.08] pt-4"
        >
          <h3 id="settings-theme" className="text-xs font-medium  text-ink-muted">
            Tema
          </h3>
          <ThemePicker />
        </section>
      </div>
    </AppModal>
  );
}
