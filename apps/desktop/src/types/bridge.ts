import type { PickerInit, SetupResult } from '../core/ipcSchemas';

export interface SetupInit {
  currentOrigin: string;
  canCancel: boolean;
}

/** API exposta em window.scaleSetup (somente na tela de setup local). */
export interface SetupBridge {
  init: () => Promise<SetupInit | null>;
  submit: (url: string) => Promise<SetupResult>;
  cancel: () => void;
}

/** API exposta em window.scalePicker (somente no seletor de tela local). */
export interface PickerBridge {
  init: () => Promise<PickerInit | null>;
  choose: (sourceId: string, shareAudio: boolean) => void;
  cancel: () => void;
}
