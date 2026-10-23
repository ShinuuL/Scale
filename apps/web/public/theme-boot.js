/*
 * Scale: aplica o tema salvo ANTES da primeira pintura (sem piscar em verde).
 * Arquivo estatico carregado de forma sincrona no <head>: substitui o script
 * inline antigo para a CSP poder usar script-src 'self' sem 'unsafe-inline'.
 * Allowlist: o valor do storage so vira atributo se for um tema conhecido.
 * Mantenha a chave e os ids em sincronia com src/lib/theme.ts (ha teste).
 */
(function () {
  try {
    var p = localStorage.getItem('scale:palette');
    if (p === 'grafite' || p === 'safira') document.documentElement.setAttribute('data-palette', p);
  } catch (e) {
    /* storage bloqueado: fica no tema padrao */
  }
})();
