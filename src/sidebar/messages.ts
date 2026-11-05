export type SidebarIncomingMessage =
  | { type: 'ready' }
  | { type: 'saveSelection'; selection: unknown }
  | { type: 'scanWorkspace' }
  | { type: 'scanEnvironment' }
  | { type: 'importPack' }
  | { type: 'generateProject' }
  | { type: 'generateFlashScript' }
  | { type: 'generateDebugConfiguration' }
  | { type: 'buildProject' }
  | { type: 'browseArmToolchain' }
  | { type: 'setArmToolchainPath'; path: string }
  | { type: 'openSettings' };

export type SidebarOutgoingMessage =
  | { type: 'state'; state: unknown }
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
  'scanEnvironment',
  'importPack',
  'generateProject',
  'generateFlashScript',
  'generateDebugConfiguration',
  'buildProject',
  'browseArmToolchain',
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
  if (record.type === 'setArmToolchainPath') {
    return typeof record.path === 'string'
      ? { type: 'setArmToolchainPath', path: record.path }
      : undefined;
  }
  if (!commandTypes.has(record.type)) {
    return undefined;
  }
  return { type: record.type } as SidebarIncomingMessage;
}
