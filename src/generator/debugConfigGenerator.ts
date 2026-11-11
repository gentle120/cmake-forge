import type { FlashProbeProfile } from '../flash/probeProfiles';
import type { FlashTargetProfile } from '../flash/targets/targetProfiles';
import { existsSync } from 'node:fs';
import {
  jlinkDeviceName,
  pyocdTargetName,
  type FlashBackendId
} from '../flash/backendProfiles';

const generatedConfigurationName = 'CMake Forge OpenOCD';

export interface CortexDebugConfigurationOptions {
  openocdPath: string;
  target: FlashTargetProfile;
  probe: FlashProbeProfile;
  searchDirs?: string[];
  backend?: FlashBackendId;
  device?: { part: string; core: string; packFile?: string };
  /**
   * ELF path the debugger loads. The generated presets always build into
   * `${workspaceFolder}/build/<preset>/`, so a concrete path works even when
   * CMake Tools has no active launch target (for example inside the Extension
   * Development Host, where `${command:cmake.launchTargetPath}` resolves to
   * nothing and the session closes immediately).
   */
  executable?: string;
  /** Compiler prefix used by the generated project (`arm-none-eabi-`). */
  toolchainPrefix?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function removeJsonComments(source: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === '/' && next === '/') {
      index += 1;
      while (index + 1 < source.length && source[index + 1] !== '\n') {
        index += 1;
      }
      result += '\n';
    } else if (character === '/' && next === '*') {
      index += 2;
      while (index + 1 < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      result += ' ';
    } else {
      result += character;
    }
  }
  return result;
}

function removeTrailingCommas(source: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === ',') {
      let lookahead = index + 1;
      while (/\s/.test(source[lookahead] ?? '')) {
        lookahead += 1;
      }
      if (source[lookahead] === '}' || source[lookahead] === ']') {
        continue;
      }
    }
    result += character;
  }
  return result;
}

function parseJsonc(source: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(removeTrailingCommas(removeJsonComments(source)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse .vscode/launch.json: ${message}`);
  }
  if (!isRecord(value)) {
    throw new Error('Unable to parse .vscode/launch.json: the root must be an object');
  }
  if (value.configurations !== undefined && !Array.isArray(value.configurations)) {
    throw new Error('Unable to parse .vscode/launch.json: configurations must be an array');
  }
  return value;
}

function createConfiguration(options: CortexDebugConfigurationOptions): Record<string, unknown> {
  const backend = options.backend ?? 'openocd';
  const configuration: Record<string, unknown> = {
    name: generatedConfigurationName,
    type: 'cortex-debug',
    request: 'launch',
    cwd: '${workspaceRoot}',
    executable: options.executable ?? '${command:cmake.launchTargetPath}',
    runToEntryPoint: 'main',
    showDevDebugOutput: 'none',
    toolchainPrefix: options.toolchainPrefix ?? 'arm-none-eabi'
  };
  if (backend === 'jlink') {
    configuration.servertype = 'jlink';
    configuration.device = jlinkDeviceName(options.device?.part, options.device?.core);
    configuration.interface = 'swd';
  } else if (backend === 'pyocd') {
    if (options.device?.packFile && !existsSync(options.device.packFile)) {
      throw new Error(`pyOCD pack file does not exist: ${options.device.packFile}`);
    }
    configuration.servertype = 'pyocd';
    configuration.target = pyocdTargetName(options.device?.part);
    if (options.device?.packFile) {
      configuration.serverArgs = ['--pack', options.device.packFile];
    }
  } else {
    configuration.servertype = 'openocd';
    configuration.configFiles = [options.probe.interfaceConfig, options.target.targetConfig];
    const openocdPath = options.openocdPath.trim();
    if (openocdPath && openocdPath !== 'openocd') {
      configuration.serverpath = openocdPath;
    }
    if (options.target.transport !== 'swd') {
      configuration.openOCDLaunchCommands = [`transport select ${options.target.transport}`];
    }
  }
  if (options.searchDirs && options.searchDirs.length > 0) {
    configuration.searchDir = [...options.searchDirs];
  }
  return configuration;
}

export function generateCortexDebugLaunchJson(
  existingContent: string | undefined,
  options: CortexDebugConfigurationOptions
): string {
  const document = existingContent?.trim()
    ? parseJsonc(existingContent)
    : { version: '0.2.0', configurations: [] as unknown[] };
  const configurations = Array.isArray(document.configurations) ? document.configurations : [];
  document.version = typeof document.version === 'string' ? document.version : '0.2.0';
  document.configurations = configurations.filter((configuration) => (
    !isRecord(configuration) || configuration.name !== generatedConfigurationName
  ));
  // The generated entry goes first: `F5` without an explicit selection picks the
  // first configuration, and a stale entry from another extension (a C/C++
  // Runner `cppdbg` config, for example) would then fail within a second.
  (document.configurations as unknown[]).unshift(createConfiguration(options));
  return `${JSON.stringify(document, null, 2)}\n`;
}
