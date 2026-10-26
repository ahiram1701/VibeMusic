import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { MENU_COMMAND_EVENT, type MenuCommand } from '@shared/ipc-contract'
import { logDir } from './log'

// Menú de la ventana en español. Los comandos de la app (deshacer, zoom, paneles…)
// los ejecuta el renderer: aquí solo se le avisa con un evento. Los atajos que ya
// maneja la ventana se muestran pero no se registran (registerAccelerator: false):
// así Ctrl+Z sigue deshaciendo el texto dentro del chat, por ejemplo.

const send = (command: MenuCommand) => (): void => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(MENU_COMMAND_EVENT, command)
}

export function buildMenu(): void {
  const shown = (accelerator: string): Partial<MenuItemConstructorOptions> => ({
    accelerator,
    registerAccelerator: false
  })
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Proyectos (inicio)…', click: send('home') },
        { type: 'separator' },
        { label: 'Importar audio…', click: send('import') },
        { label: 'Exportar…', click: send('export') },
        { type: 'separator' },
        { label: 'Ajustes…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { type: 'separator' },
        { label: 'Salir', role: 'quit' }
      ]
    },
    {
      label: 'Edición',
      submenu: [
        { label: 'Deshacer', ...shown('CmdOrCtrl+Z'), click: send('undo') },
        { label: 'Rehacer', ...shown('CmdOrCtrl+Y'), click: send('redo') },
        { type: 'separator' },
        { label: 'Cortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Pegar', role: 'paste' },
        { label: 'Seleccionar todo', role: 'selectAll' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Acercar', click: send('zoomIn') },
        { label: 'Alejar', click: send('zoomOut') },
        { type: 'separator' },
        { label: 'Panel del productor', click: send('toggleAside') },
        { label: 'Mezclador', click: send('toggleMixer') },
        { type: 'separator' },
        { label: 'Pantalla completa', role: 'togglefullscreen' },
        ...(app.isPackaged
          ? []
          : ([
              { type: 'separator' },
              { label: 'Recargar', role: 'reload' },
              { label: 'Herramientas de desarrollo', role: 'toggleDevTools' }
            ] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Atajos de teclado y gestos', ...shown('F1'), click: send('shortcuts') },
        { type: 'separator' },
        { label: 'Abrir el registro de la app', click: () => void shell.openPath(logDir()) },
        {
          label: 'Página del proyecto',
          click: () => void shell.openExternal('https://github.com/ahiram1701/VibeMusic')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
