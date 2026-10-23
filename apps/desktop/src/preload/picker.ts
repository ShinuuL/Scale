// Preload do seletor de tela (sandbox: arquivo unico, so importa 'electron').
import { contextBridge, ipcRenderer } from 'electron';
import type { PickerBridge } from '../types/bridge';

const SOURCE_ID = /^(screen|window):[A-Za-z0-9:_-]{1,200}$/;

const bridge: PickerBridge = {
  init: () => ipcRenderer.invoke('picker:init'),
  choose: (sourceId, shareAudio) => {
    if (typeof sourceId !== 'string' || !SOURCE_ID.test(sourceId) || typeof shareAudio !== 'boolean') return;
    ipcRenderer.send('picker:choose', { sourceId, shareAudio });
  },
  cancel: () => {
    ipcRenderer.send('picker:cancel');
  },
};

contextBridge.exposeInMainWorld('scalePicker', bridge);
