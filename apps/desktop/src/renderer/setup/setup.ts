import type { SetupBridge } from '../../types/bridge';

declare global {
  interface Window {
    scaleSetup: SetupBridge;
  }
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`elemento #${id} ausente`);
  return node as T;
}

const form = el<HTMLFormElement>('form');
const input = el<HTMLInputElement>('url');
const error = el<HTMLParagraphElement>('error');
const status = el<HTMLParagraphElement>('status');
const submit = el<HTMLButtonElement>('submit');
const cancel = el<HTMLButtonElement>('cancel');
let canCancel = false;

function showError(message: string): void {
  error.textContent = message;
  error.hidden = false;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

function clearError(): void {
  error.hidden = true;
  error.textContent = '';
  input.removeAttribute('aria-invalid');
}

async function onSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  clearError();
  submit.disabled = true;
  status.textContent = 'Testando conexão com o servidor...';
  try {
    const result = await window.scaleSetup.submit(input.value);
    if (result.ok) {
      status.textContent = 'Servidor conectado. Abrindo o Scale...';
      return;
    }
    status.textContent = '';
    showError(result.error);
  } catch {
    status.textContent = '';
    showError('Falha inesperada ao testar o servidor.');
  } finally {
    submit.disabled = false;
  }
}

form.addEventListener('submit', (e) => void onSubmit(e));
input.addEventListener('input', clearError);
cancel.addEventListener('click', () => window.scaleSetup.cancel());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && canCancel) window.scaleSetup.cancel();
});

void window.scaleSetup.init().then((init) => {
  if (!init) return;
  input.value = init.currentOrigin;
  canCancel = init.canCancel;
  cancel.hidden = !init.canCancel;
  input.focus();
  input.select();
});
