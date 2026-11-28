import type { FlashProbeProfile } from '../flash/probeProfiles';
import type { FlashTargetProfile } from '../flash/targets/targetProfiles';
import { existsSync } from 'node:fs';
import {
  jlinkDeviceName,
  pyocdTargetName,
  type FlashBackendId
} from '../flash/backendProfiles';
import { parseJsoncText } from '../shared/jsonc';

const generatedConfigurationName = 'CMake Forge OpenOCD';
const attachConfigurationName = 'CMake Forge OpenOCD (attach)';

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
  /**
   * SVD file registered with cortex-debug so peripheral registers show names
   * instead of raw addresses. Only set when the file exists on disk.
   */
  svdFile?: string;
  /**
   * Build task to run before the session starts, so F5 on a clean checkout
   * compiles first instead of failing on a missing ELF.
   */
  preLaunchTask?: string;
  /** Also emit a `request: "attach"` twin for debugging an already-running target. */
  includeAttach?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonc(source: string): Record<string, unknown> {
  const value = parseJsoncText(source, '.vscode/launch.json');
  if (!isRecord(value)) {
    throw new Error('Unable to parse .vscode/launch.json: the root must be an object');
  }
  if (value.configurations !== undefined && !Array.isArray(value.configurations)) {
    throw new Error('Unable to parse .vscode/launch.json: configurations must be an array');
  }
  return value;
}

function createConfiguration(
  options: CortexDebugConfigurationOptions,
  request: 'launch' | 'attach' = 'launch'
): Record<string, unknown> {
  const backend = options.backend ?? 'openocd';
  const configuration: Record<string, unknown> = {
    name: request === 'launch' ? generatedConfigurationName : attachConfigurationName,
    type: 'cortex-debug',
    request,
    cwd: '${workspaceRoot}',
    executable: options.executable ?? '${command:cmake.launchTargetPath}',
    showDevDebugOutput: 'none',
    toolchainPrefix: options.toolchainPrefix ?? 'arm-none-eabi'
  };
  if (options.svdFile) {
    configuration.svdFile = options.svdFile;
  }
  if (request === 'launch') {
    // `runToEntryPoint` only makes sense when the debugger starts the target;
    // an attach session joins a core that is already running.
    configuration.runToEntryPoint = 'main';
    if (options.preLaunchTask) {
      configuration.preLaunchTask = options.preLaunchTask;
    }
  }
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
    !isRecord(configuration)
    || (configuration.name !== generatedConfigurationName
      && configuration.name !== attachConfigurationName)
  ));
  // The generated entry goes first: `F5` without an explicit selection picks the
  // first configuration, and a stale entry from another extension (a C/C++
  // Runner `cppdbg` config, for example) would then fail within a second.
  // Launch stays ahead of attach so F5 keeps flashing/building as before.
  const generated = [createConfiguration(options, 'launch')];
  if (options.includeAttach) {
    generated.push(createConfiguration(options, 'attach'));
  }
  (document.configurations as unknown[]).unshift(...generated);
  return `${JSON.stringify(document, null, 2)}\n`;
}
