'use client';

import { useId, useState, type ReactNode } from 'react';
import {
  Button as AriaButton,
  Checkbox,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  type Key,
} from 'react-aria-components';
import { clsx } from 'clsx';
import {
  adminModerationUpdateSchema,
  type AdminModerationState,
  type AdminModerationUpdate,
  type ModerationOverrides,
} from '@scale/shared';
import { AppModal } from '@/components/ui/AppModal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { api, type ApiError } from '@/lib/api';
import { FIELD_LABELS, PROVIDER_LABELS, formatFieldValue, type OverrideField } from './moderationLabels';

export interface ModerationSettingsFormProps {
  state: AdminModerationState;
  /** Estado novo devolvido pelo servidor (salvar ou remover chave). */
  onStateChange: (state: AdminModerationState) => void;
  /** Aviso curto (toast) de sucesso ou falha. */
  notify: (message: string, variant: 'success' | 'error' | 'info') => void;
}

type Draft = Partial<AdminModerationUpdate>;
type Provider = 'off' | 'heuristic' | 'claude';

/** Mensagens conhecidas do 400 `{ error, field }`; o resto vai como veio. */
const ERROR_MESSAGES: Record<string, string> = {
  screen_requires_claude: 'A análise de tela exige o provedor Claude API.',
  claude_requires_api_key: 'O provedor Claude API exige uma chave configurada (banco ou .env).',
  invalid_email: 'Informe um e-mail válido.',
};

function errorMessage(err: ApiError): string {
  return ERROR_MESSAGES[err.error] ?? err.error;
}

/**
 * Formulario das configuracoes da moderacao. Cada campo tem tres estados:
 * sem override (mostra "Usando .env: valor"), override gravado e override
 * editado (rascunho). "Salvar" envia so o que mudou; `null` volta ao .env.
 */
export function ModerationSettingsForm({ state, onStateChange, notify }: ModerationSettingsFormProps) {
  const [draft, setDraft] = useState<Draft>({});
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemoveKey, setConfirmRemoveKey] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);
  const removeDescId = useId();

  const { overrides, envDefaults, effective } = state;

  function current<K extends OverrideField>(key: K): ModerationOverrides[K] {
    return key in draft ? (draft[key] as ModerationOverrides[K]) : overrides[key];
  }

  function setField<K extends OverrideField>(key: K, value: ModerationOverrides[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  /** So o que difere do override gravado (mais a chave nova, se digitada). */
  function buildUpdate(): AdminModerationUpdate {
    const update: Draft = {};
    for (const key of Object.keys(draft) as OverrideField[]) {
      const value = draft[key];
      if (value !== overrides[key]) (update as Record<string, unknown>)[key] = value;
    }
    const key = apiKeyInput.trim();
    if (key) update.apiKey = key;
    return update;
  }

  const pending = buildUpdate();
  const dirty = Object.keys(pending).length > 0;

  const save = async () => {
    setFormError(null);
    const parsed = adminModerationUpdateSchema.safeParse(pending);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String(issue?.path[0] ?? '');
      if (field) setFieldErrors((prev) => ({ ...prev, [field]: issue.message }));
      else setFormError('Revise os campos antes de salvar.');
      return;
    }
    setSaving(true);
    try {
      const next = await api.updateAdminModeration(parsed.data);
      onStateChange(next);
      setDraft({});
      setApiKeyInput('');
      setFieldErrors({});
      notify('Configuração salva.', 'success');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 400 && apiErr.field) {
        setFieldErrors((prev) => ({ ...prev, [apiErr.field as string]: errorMessage(apiErr) }));
      } else if (apiErr.status === 403) {
        setFormError('Sua conta não é mais administradora deste servidor.');
      } else {
        setFormError('Não foi possível salvar. Tente de novo.');
      }
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    setRemovingKey(true);
    try {
      const next = await api.deleteAdminModerationApiKey();
      onStateChange(next);
      setConfirmRemoveKey(false);
      notify('Chave removida do banco.', 'success');
    } catch {
      notify('Não foi possível remover a chave.', 'error');
    } finally {
      setRemovingKey(false);
    }
  };

  const apiKeyStatus = effective.hasApiKey
    ? `Chave configurada (${effective.apiKeySource === 'db' ? 'banco' : '.env'})`
    : 'Sem chave';

  const providerValue: Provider = current('provider') ?? effective.provider;
  const screenValue = current('screenEnabled') ?? envDefaults.screenEnabled ?? false;

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      aria-busy={saving}
    >
      <Section title="Provedor" description="Quem classifica o texto do chat, da DM e as amostras de tela.">
        <FieldFrame
          field="provider"
          override={current('provider')}
          envValue={envDefaults.provider}
          error={fieldErrors.provider}
          onReset={() => setField('provider', null)}
        >
          <Select
            selectedKey={providerValue}
            onSelectionChange={(key: Key | null) => {
              if (key !== null) setField('provider', String(key) as Provider);
            }}
            isDisabled={saving}
            className="flex flex-col gap-1.5"
          >
            <Label className="text-sm font-medium text-ink-secondary">{FIELD_LABELS.provider}</Label>
            <AriaButton
              className={clsx(
                'input-base flex items-center justify-between gap-2 text-left',
                fieldErrors.provider && 'border-red-500',
              )}
            >
              <SelectValue>{PROVIDER_LABELS[providerValue]}</SelectValue>
              <Icon name="chevronDown" className="text-ink-muted" />
            </AriaButton>
            <Popover
              className="z-50 w-[--trigger-width] rounded-xl border border-white/10 bg-forest-900 p-1.5 shadow-[0_12px_40px_rgb(0_0_0/0.3)] data-[entering]:animate-menu-in"
            >
              <ListBox className="outline-none">
                {(Object.keys(PROVIDER_LABELS) as Provider[]).map((value) => (
                  <ListBoxItem
                    key={value}
                    id={value}
                    textValue={PROVIDER_LABELS[value]}
                    className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm text-ink-primary outline-none data-[focused]:bg-white/[0.08] data-[selected]:font-semibold"
                  >
                    {({ isSelected }) => (
                      <>
                        <span className="flex h-4 w-4 items-center justify-center" aria-hidden>
                          {isSelected && <Icon name="check" size={14} />}
                        </span>
                        {PROVIDER_LABELS[value]}
                      </>
                    )}
                  </ListBoxItem>
                ))}
              </ListBox>
            </Popover>
          </Select>
        </FieldFrame>

        <TextField
          field="model"
          value={current('model')}
          envValue={envDefaults.model}
          error={fieldErrors.model}
          disabled={saving}
          placeholder={envDefaults.model ?? 'claude-opus-5-5'}
          helper="Só com Claude API. claude-haiku-5-5 é a opção barata."
          onChange={(v) => setField('model', v === '' ? null : v)}
          onReset={() => setField('model', null)}
        />

        <div className="space-y-1.5">
          <label htmlFor="admin-api-key" className="block text-sm font-medium text-ink-secondary">
            {FIELD_LABELS.apiKey}
          </label>
          <input
            id="admin-api-key"
            type="password"
            autoComplete="off"
            className={clsx('input-base', fieldErrors.apiKey && 'border-red-500')}
            value={apiKeyInput}
            disabled={saving}
            placeholder="Cole a chave nova para substituir"
            aria-invalid={!!fieldErrors.apiKey}
            aria-describedby="admin-api-key-status"
            onChange={(e) => {
              setApiKeyInput(e.target.value);
              setFieldErrors((prev) => ({ ...prev, apiKey: undefined }));
            }}
          />
          {fieldErrors.apiKey && (
            <p className="text-xs text-red-400" role="alert">
              {fieldErrors.apiKey}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id="admin-api-key-status" className="text-xs text-ink-muted">
              {apiKeyStatus}. A chave é gravada cifrada e nunca volta para esta tela.
            </p>
            {effective.apiKeySource === 'db' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmRemoveKey(true)}
                disabled={saving}
              >
                <Icon name="trash" />
                Remover chave
              </Button>
            )}
          </div>
        </div>
      </Section>

      <Section
        title="Análise de tela"
        description="Amostras da tela compartilhada vão ao provedor (exige Claude API). O termo de partilha avisa o usuário."
      >
        <FieldFrame
          field="screenEnabled"
          override={current('screenEnabled')}
          envValue={envDefaults.screenEnabled}
          error={fieldErrors.screenEnabled}
          onReset={() => setField('screenEnabled', null)}
        >
          <Checkbox
            isSelected={screenValue}
            onChange={(v) => setField('screenEnabled', v)}
            isDisabled={saving}
            className="group flex cursor-pointer items-start gap-3 text-sm text-ink-primary"
          >
            {({ isSelected, isFocusVisible }) => (
              <>
                <span
                  aria-hidden="true"
                  className={clsx(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                    isSelected ? 'border-accent bg-accent text-white' : 'border-line bg-surface-tertiary',
                    isFocusVisible && 'outline outline-2 outline-offset-2 outline-accent',
                  )}
                >
                  {isSelected && <Icon name="check" size={14} />}
                </span>
                <span>{FIELD_LABELS.screenEnabled} ligada</span>
              </>
            )}
          </Checkbox>
        </FieldFrame>

        <NumberField
          field="frameIntervalSec"
          value={current('frameIntervalSec')}
          envValue={envDefaults.frameIntervalSec}
          error={fieldErrors.frameIntervalSec}
          disabled={saving}
          min={10}
          max={120}
          unit="segundos"
          onChange={(v) => setField('frameIntervalSec', v)}
          onReset={() => setField('frameIntervalSec', null)}
        />
      </Section>

      <Section title="Retenção" description="Por quantos dias os eventos de moderação ficam guardados.">
        <NumberField
          field="retentionDays"
          value={current('retentionDays')}
          envValue={envDefaults.retentionDays}
          error={fieldErrors.retentionDays}
          disabled={saving}
          min={1}
          max={365}
          unit="dias"
          onChange={(v) => setField('retentionDays', v)}
          onReset={() => setField('retentionDays', null)}
        />
      </Section>

      <Section title="Idade mínima" description="Idade autodeclarada exigida para compartilhar tela.">
        <NumberField
          field="minAge"
          value={current('minAge')}
          envValue={envDefaults.minAge}
          error={fieldErrors.minAge}
          disabled={saving}
          min={13}
          max={21}
          unit="anos"
          onChange={(v) => setField('minAge', v)}
          onReset={() => setField('minAge', null)}
        />
      </Section>

      <Section title="Contato do encarregado" description="E-mail exibido em /privacy como canal do encarregado (LGPD, art. 41).">
        <TextField
          field="privacyContactEmail"
          type="email"
          value={current('privacyContactEmail')}
          envValue={envDefaults.privacyContactEmail}
          error={fieldErrors.privacyContactEmail}
          disabled={saving}
          placeholder={envDefaults.privacyContactEmail || 'encarregado@exemplo.com'}
          onChange={(v) => setField('privacyContactEmail', v === '' ? null : v)}
          onReset={() => setField('privacyContactEmail', null)}
        />
      </Section>

      {formError && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-5">
        {dirty && !saving && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft({});
              setApiKeyInput('');
              setFieldErrors({});
              setFormError(null);
            }}
          >
            Descartar alterações
          </Button>
        )}
        <Button type="submit" disabled={!dirty || saving} aria-busy={saving}>
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>

      {confirmRemoveKey && (
        <AppModal
          title="Remover a chave de API?"
          icon="key"
          role="alertdialog"
          describedBy={removeDescId}
          locked={removingKey}
          onClose={() => setConfirmRemoveKey(false)}
          closeLabel="Fechar"
        >
          <p id={removeDescId} className="text-sm leading-6 text-ink-secondary">
            A chave guardada no banco será apagada.{' '}
            {envDefaults.hasApiKey
              ? 'O servidor volta a usar a chave do .env.'
              : 'Sem chave no .env, o provedor Claude API deixa de funcionar e as mensagens passam sem análise (fail-open).'}
          </p>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmRemoveKey(false)} disabled={removingKey} autoFocus>
              Cancelar
            </Button>
            <Button type="button" variant="danger" onClick={() => void removeKey()} disabled={removingKey} aria-busy={removingKey}>
              {removingKey ? 'Removendo...' : 'Remover chave'}
            </Button>
          </div>
        </AppModal>
      )}
    </form>
  );
}

// ─── Blocos ───────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className="glass p-5 sm:p-6" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-base font-semibold text-ink-primary">
        {title}
      </h3>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

interface FieldFrameProps {
  field: OverrideField;
  /** Override atual (rascunho ou gravado); null = usando o .env. */
  override: unknown;
  envValue: unknown;
  error?: string;
  onReset: () => void;
  children: ReactNode;
}

/** Envolve um campo com o estado "Usando .env" / "Voltar ao .env" e o erro. */
function FieldFrame({ field, override, envValue, error, onReset, children }: FieldFrameProps) {
  const usingEnv = override === null || override === undefined;
  return (
    <div className="space-y-1.5">
      {children}
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        {usingEnv ? (
          <span>Usando .env: {formatFieldValue(field, envValue)}</span>
        ) : (
          <>
            <span>Valor do painel (sobrepõe o .env: {formatFieldValue(field, envValue)})</span>
            <button
              type="button"
              onClick={onReset}
              className="min-h-[32px] rounded-md px-2 font-medium text-brand-300 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Voltar ao .env ({FIELD_LABELS[field]})
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface TextFieldProps {
  field: 'model' | 'privacyContactEmail';
  type?: 'text' | 'email';
  value: string | null;
  envValue: string | null;
  error?: string;
  disabled: boolean;
  placeholder?: string;
  helper?: string;
  onChange: (value: string) => void;
  onReset: () => void;
}

function TextField({ field, type = 'text', value, envValue, error, disabled, placeholder, helper, onChange, onReset }: TextFieldProps) {
  const id = `admin-${field}`;
  return (
    <FieldFrame field={field} override={value} envValue={envValue} error={error} onReset={onReset}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-secondary">
        {FIELD_LABELS[field]}
      </label>
      <input
        id={id}
        type={type}
        className={clsx('input-base', error && 'border-red-500')}
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
      />
      {helper && <p className="text-xs text-ink-muted">{helper}</p>}
    </FieldFrame>
  );
}

interface NumberFieldProps {
  field: 'frameIntervalSec' | 'retentionDays' | 'minAge';
  value: number | null;
  envValue: number | null;
  error?: string;
  disabled: boolean;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number | null) => void;
  onReset: () => void;
}

function NumberField({ field, value, envValue, error, disabled, min, max, unit, onChange, onReset }: NumberFieldProps) {
  const id = `admin-${field}`;
  return (
    <FieldFrame field={field} override={value} envValue={envValue} error={error} onReset={onReset}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-secondary">
        {FIELD_LABELS[field]} ({min} a {max} {unit})
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        className={clsx('input-base', error && 'border-red-500')}
        value={value ?? ''}
        placeholder={envValue == null ? undefined : String(envValue)}
        disabled={disabled}
        aria-invalid={!!error}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(null);
            return;
          }
          const n = Number(raw);
          onChange(Number.isFinite(n) ? Math.trunc(n) : null);
        }}
      />
    </FieldFrame>
  );
}
