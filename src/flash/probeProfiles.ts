export type FlashProbeId = 'jlink-ob' | 'jlink' | 'stlink' | 'daplink';

export interface FlashProbeProfile {
  id: FlashProbeId;
  label: string;
  interfaceConfig: string;
  /** Probe identifier understood by pyOCD; undefined when pyOCD cannot drive the probe. */
  pyocdProbe?: string;
}

const flashProbeProfiles: FlashProbeProfile[] = [
  { id: 'jlink-ob', label: 'J-Link OB', interfaceConfig: 'interface/jlink.cfg' },
  { id: 'jlink', label: 'J-Link', interfaceConfig: 'interface/jlink.cfg' },
  { id: 'stlink', label: 'ST-Link', interfaceConfig: 'interface/stlink.cfg', pyocdProbe: 'stlink' },
  { id: 'daplink', label: 'DapLink', interfaceConfig: 'interface/cmsis-dap.cfg', pyocdProbe: 'cmsis-dap' }
];

export function listFlashProbeProfiles(): FlashProbeProfile[] {
  return flashProbeProfiles.map((profile) => ({ ...profile }));
}

export function getFlashProbeProfile(id: string): FlashProbeProfile {
  const profile = flashProbeProfiles.find((candidate) => candidate.id === id.trim().toLowerCase());
  if (!profile) {
    throw new Error(`Unsupported debug probe: ${id}`);
  }
  return { ...profile };
}
