import type { FlashProbeId } from './probeProfiles';

export type FlashBackendId = 'openocd' | 'jlink' | 'pyocd';

export interface FlashBackendProfile {
  id: FlashBackendId;
  label: string;
  probes: FlashProbeId[];
}

const flashBackendProfiles: FlashBackendProfile[] = [
  { id: 'openocd', label: 'OpenOCD', probes: ['jlink-ob', 'jlink', 'stlink', 'daplink'] },
  { id: 'jlink', label: 'J-Link', probes: ['jlink-ob', 'jlink'] },
  { id: 'pyocd', label: 'pyOCD (ST-Link / DAPLink)', probes: ['stlink', 'daplink'] }
];

export function listFlashBackendProfiles(): FlashBackendProfile[] {
  return flashBackendProfiles.map((profile) => ({ ...profile, probes: [...profile.probes] }));
}

export function getFlashBackendProfile(id: string): FlashBackendProfile {
  const profile = flashBackendProfiles.find((candidate) => candidate.id === id.trim().toLowerCase());
  if (!profile) {
    throw new Error(`Unsupported flash backend: ${id}`);
  }
  return { ...profile, probes: [...profile.probes] };
}

/** pyOCD has no J-Link probe support; the matrix above encodes that hardware limit. */
export function backendSupportsProbe(backend: FlashBackendId, probe: FlashProbeId): boolean {
  return getFlashBackendProfile(backend).probes.includes(probe);
}

export function defaultBackendFor(
  profile: Pick<DeviceDebugTarget, 'debugTarget'>,
  probe: FlashProbeId
): FlashBackendId {
  if (profile.debugTarget) {
    return 'openocd';
  }
  return probe === 'jlink' || probe === 'jlink-ob' ? 'jlink' : 'pyocd';
}

interface DeviceDebugTarget {
  debugTarget?: string;
}

/** Generic SEGGER device selector for unlisted parts; users can substitute exact names. */
export function jlinkGenericDeviceName(core: string): string {
  const genericNames: Record<string, string> = {
    'cortex-m0': 'Cortex-M0',
    'cortex-m0plus': 'Cortex-M0+',
    'cortex-m1': 'Cortex-M1',
    sc000: 'Cortex-M0',
    'cortex-m3': 'Cortex-M3',
    'cortex-m4': 'Cortex-M4',
    'cortex-m7': 'Cortex-M7',
    'cortex-m23': 'Cortex-M23',
    'cortex-m33': 'Cortex-M33',
    'cortex-m35p': 'Cortex-M35P',
    'cortex-m55': 'Cortex-M55'
  };
  return genericNames[core] ?? 'Cortex-M4';
}

/**
 * J-Link knows STM32/GD32 part numbers without the two-character package
 * suffix (STM32F103C8T6 -> STM32F103C8); other parts fall back to a generic
 * core-level device name that still selects a flash loader for unlisted chips.
 */
export function jlinkDeviceName(part: string | undefined, core: string | undefined): string {
  if (part && /^(STM32|GD32)/.test(part)) {
    return part.slice(0, -2);
  }
  return jlinkGenericDeviceName(core ?? 'cortex-m4');
}

/** pyOCD ships built-in STM32/GD32 boards/targets under lowercase names. */
export function pyocdTargetName(part: string | undefined): string {
  if (part && /^(STM32|GD32)/.test(part)) {
    return part.slice(0, -2).toLowerCase();
  }
  return (part ?? '').toLowerCase();
}
