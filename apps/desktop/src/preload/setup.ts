// Preload da tela de setup (sandbox: arquivo unico, so importa 'electron').
// Expoe 3 funcoes; o ipcRenderer nunca sai daqui.
import { contextBridge, ipcRenderer } from 'electron';
import type { SetupBridge } from '../types/bridge';

const MAX_LEN = 4096;

const bridge: SetupBridge = {
  init: () => ipcRenderer.invoke('setup:init'),
  submit: (url) => {
    if (typeof url !== 'string' || url.length > MAX_LEN) {
      return Promise.resolve({ ok: false, error: 'Endereço inválido.' });
    }
    return ipcRenderer.invoke('setup:submit', url);
  },
  cancel: () => {
    ipcRenderer.send('setup:cancel');
  },
};

contextBridge.exposeInMainWorld('scaleSetup', bridge);
