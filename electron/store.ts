import Store from 'electron-store';

interface StoreSchema {
  windowState: {
    width: number;
    height: number;
    x: number | undefined;
    y: number | undefined;
    isMaximized: boolean;
  };
  scanPath: string;
  userName: string;
  userEmail: string;
  theme: 'dark' | 'mid' | 'light';
  projectColors: Record<string, string>;
  projectStatuses: Record<string, 'active' | 'paused' | 'finished'>;
  recentProjects: string[];
  splitRatios: Record<string, number>;
  projectUrls: Record<string, string>;
  sidebarWidth: number;
  editorFontSize: number;
  terminalFontSize: number;
  deployConfigs: Record<string, { host: string; user: string; password: string; remotePath: string }>;
  pinnedProjects: string[];
  projectPrefs: Record<string, { panelsSwapped?: boolean; workspaceLayout?: unknown; editorOpenFiles?: string[]; previewUrl?: string }>;
  ccNotifications: boolean;
  ccSound: boolean;
  projectLastOpened: Record<string, number>;
  welcomeSeen: boolean;
  autostartDev: boolean;
  locale: 'en' | 'cs';
  monitorDiagonal: number;
  cmdSave: string;
  cmdPush: string;
  projectGroups: Record<string, string>;
  projectOrder: string[];
}

export const store = new Store<StoreSchema>({
  defaults: {
    windowState: {
      width: 1400,
      height: 900,
      x: undefined,
      y: undefined,
      isMaximized: false,
    },
    scanPath: 'C:\\dev',
    userName: '',
    userEmail: '',
    theme: 'dark',
    projectColors: {},
    projectStatuses: {},
    recentProjects: [],
    splitRatios: {},
    projectUrls: {},
    sidebarWidth: 220,
    editorFontSize: 14,
    terminalFontSize: 13,
    deployConfigs: {},
    pinnedProjects: [],
    projectPrefs: {},
    ccNotifications: true,
    ccSound: true,
    projectLastOpened: {},
    welcomeSeen: false,
    autostartDev: true,
    locale: 'cs',
    monitorDiagonal: 24,
    projectGroups: {},
    projectOrder: [],
    cmdSave: '/commit',
    cmdPush: '/commit && git push',
  },
});
