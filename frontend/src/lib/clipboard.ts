// Copia texto para a área de transferência, com fallback para contextos
// inseguros (HTTP): navigator.clipboard só existe em contextos seguros, então
// em http://100.x:3000 usamos o caminho legado execCommand('copy').

export async function copyText(text: string): Promise<boolean> {
  try {
    if (
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      navigator.clipboard?.writeText
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Continua para o caminho legado.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}