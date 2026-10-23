import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { isDev } from './paths';
import { getAllowedOrigin } from './security';

export interface MenuActions {
  changeServer: () => void;
  getWindow: () => BrowserWindow | undefined;
}

export function buildMenu(actions: MenuActions): Menu {
  const view: MenuItemConstructorOptions[] = [
    { label: 'Tela cheia', role: 'togglefullscreen', accelerator: 'F11' },
    { type: 'separator' },
    { label: 'Aumentar zoom', role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
    { label: 'Diminuir zoom', role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
    { label: 'Tamanho original', role: 'resetZoom', accelerator: 'CmdOrCtrl+0' },
  ];
  if (isDev) {
    view.push({ type: 'separator' }, { label: 'Ferramentas do desenvolvedor', role: 'toggleDevTools' });
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Trocar servidor...', accelerator: 'CmdOrCtrl+Shift+S', click: () => actions.changeServer() },
        { label: 'Recarregar', role: 'reload', accelerator: 'CmdOrCtrl+R' },
        { type: 'separator' },
        { label: 'Sair', role: 'quit', accelerator: 'CmdOrCtrl+Q' },
      ],
    },
    { label: 'Exibir', submenu: view },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Sobre o Scale',
          click: () => {
            const win = actions.getWindow();
            const options = {
              type: 'info' as const,
              title: 'Sobre o Scale',
              message: `Scale ${app.getVersion()}`,
              detail: [
                `Servidor: ${getAllowedOrigin() ?? 'não configurado'}`,
                `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
                'Mastersys',
              ].join('\n'),
              buttons: ['Fechar'],
              noLink: true,
            };
            void (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
