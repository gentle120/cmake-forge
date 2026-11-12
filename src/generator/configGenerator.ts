import type { DeviceProfile, MemoryRegion } from '../devices/deviceProfiles';
import { getWorkspaceIntegration } from '../integration/workspaceSettings';
import { hexadecimal } from '../shared/cmakeText';

export interface ProjectFlashConfiguration {
  script: string;
  probe: string;
  interfaceConfig: string;
  openocdPath: string;
  target: string;
  transport: string;
}

function memorySummary(region: MemoryRegion): { origin: string; sizeBytes: number; sizeKB: number } {
  return {
    origin: hexadecimal(region.origin),
    sizeBytes: region.length,
    sizeKB: region.length / 1024
  };
}

export function generateProjectConfig(
  projectName: string,
  profile: DeviceProfile,
  generatedFiles: string[],
  overwrittenFiles: string[],
  flash?: ProjectFlashConfiguration
): string {
  const config = {
    projectName,
    device: profile.part,
    toolchain: {
      family: profile.toolchainFamily ?? 'gcc',
      compiler: profile.mcuCompiler
        ?? (profile.toolchainFamily === 'armclang'
          ? 'armclang'
          : profile.toolchainFamily === 'clang'
            ? 'clang'
            : `${profile.toolchainPrefix}-gcc`),
      linker: profile.linkerFileName
    },
    memory: {
      flash: memorySummary(profile.flash),
      ram: memorySummary(profile.ram),
      additional: (profile.additionalMemory ?? []).map((region) => ({
        name: region.name,
        attributes: region.attributes,
        origin: hexadecimal(region.origin),
        sizeBytes: region.length,
        sizeKB: region.length / 1024
      }))
    },
    integration: getWorkspaceIntegration(),
    generatedFiles,
    overwrittenFiles
  };
  if (flash) {
    Object.assign(config, { flash });
  }

  return `${JSON.stringify(config, null, 2)}\n`;
}
