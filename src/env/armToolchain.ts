import { statSync } from 'node:fs';

export interface ArmToolchainStatus {
  binDir: string;
  state: 'path' | 'ready' | 'missing';
  message: string;
}

const buildTools = ['gcc', 'g++', 'objcopy', 'size'].map(name => `arm-none-eabi-${name}`);

/** Accepts a bin directory or its GCC executable; settings always store the directory. */
export function normalizeArmToolchainPath(input: string): string {
  const unquoted = input.trim().replace(/^"(.*)"$/, '$1');
  const path = unquoted.replace(/\\/g, '/').replace(/\/+$/, '');
  return path.replace(/\/arm-none-eabi-gcc(?:\.exe)?$/i, '');
}

export function armGccExecutablePath(binDirectory: string, platform: NodeJS.Platform = process.platform): string {
  const bin = normalizeArmToolchainPath(binDirectory);
  return bin ? `${bin}/arm-none-eabi-gcc${platform === 'win32' ? '.exe' : ''}` : 'arm-none-eabi-gcc';
}

/** Puts the current effective installation first so an explicit scan does not silently switch tools. */
export function prioritizeArmToolchainHits<T extends { path: string }>(hits: T[], current: string): T[] {
  const normalizedCurrent = normalizeArmToolchainPath(current);
  return hits
    .map((hit, index) => ({ hit, index, current: Boolean(normalizedCurrent) && normalizeArmToolchainPath(hit.path) === normalizedCurrent }))
    .sort((left, right) => Number(right.current) - Number(left.current) || left.index - right.index)
    .map(entry => entry.hit);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function inspectArmToolchainPath(
  input: string,
  fileExists: (path: string) => boolean = isFile
): ArmToolchainStatus {
  const binDir = normalizeArmToolchainPath(input);
  if (!binDir) {
    return { binDir, state: 'path', message: '使用 PATH 查找 ARM GNU 工具链，也可扫描或浏览已安装的目录。' };
  }
  const missing = buildTools.filter(name =>
    !fileExists(`${binDir}/${name}`) && !fileExists(`${binDir}/${name}.exe`)
  );
  return missing.length > 0
    ? { binDir, state: 'missing', message: `缺少 ${missing.join('、')}。请选择 ARM GNU 工具链的 bin 目录。` }
    : { binDir, state: 'ready', message: '已找到 ARM GCC、G++、objcopy 和 size。' };
}
