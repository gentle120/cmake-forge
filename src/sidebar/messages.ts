export type SidebarIncomingMessage =
  | { type: 'ready' }
  | { type: 'saveSelection'; selection: unknown }
  | { type: 'setProjectRoot'; root: string }
  | { type: 'selectPack'; packId: string }
  | { type: 'activatePack'; packId: string; version: string }
  | { type: 'scanWorkspace' }
  | { type: 'cancelWorkspaceScan' }
  | { type: 'importPack' }
  | { type: 'installPackOnline' }
  | { type: 'generateProject' }
  | { type: 'generateFlashScript' }
  | { type: 'generateDebugConfiguration' }
  | { type: 'openSettings' };

export type SidebarOutgoingMessage =
  | { type: 'state'; state: unknown }
  | { type: 'packCatalogState'; vendor: string; packs: unknown[]; versions: unknown[]; notice?: string }
  | {
      type: 'packCatalogLoading';
      vendor: string;
      packs: unknown[];
      versions: unknown[];
      notice?: string;
    }
  | { type: 'operationStarted'; operation: string }
  | {
      type: 'operationFinished';
      result: {
        ok: boolean;
        cancelled?: boolean;
        message: string;
        files: string[];
      };
    }
  | { type: 'workspaceScan'; sources: number; includeDirs: number; defines: number }
  | { type: 'notification'; level: 'info' | 'warning' | 'error'; message: string };

const commandTypes = new Set([
  'ready',
  'scanWorkspace',
  'cancelWorkspaceScan',
  'importPack',
  'installPackOnline',
  'generateProject',
  'generateFlashScript',
  'generateDebugConfiguration',
  'openSettings'
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function parseIncomingMessage(value: unknown): SidebarIncomingMessage | undefined {
  const record = asRecord(value);
  if (!record || typeof record.type !== 'string') {
    return undefined;
  }
  if (record.type === 'saveSelection') {
    return record.selection === undefined
      ? undefined
      : { type: 'saveSelection', selection: record.selection };
  }
  if (record.type === 'setProjectRoot') {
    return typeof record.root === 'string'
      ? { type: 'setProjectRoot', root: record.root }
      : undefined;
  }
  if (record.type === 'selectPack') {
    return typeof record.packId === 'string'
      ? { type: 'selectPack', packId: record.packId }
      : undefined;
  }
  if (record.type === 'activatePack') {
    return typeof record.packId === 'string' && typeof record.version === 'string'
      ? { type: 'activatePack', packId: record.packId, version: record.version }
      : undefined;
  }
  if (!commandTypes.has(record.type)) {
    return undefined;
  }
  return { type: record.type } as SidebarIncomingMessage;
}
