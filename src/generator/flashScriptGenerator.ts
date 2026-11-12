import type { FlashProbeProfile } from '../flash/probeProfiles';
import type { FlashTargetProfile } from '../flash/targets/targetProfiles';
import { existsSync } from 'node:fs';
import {
  backendSupportsProbe,
  jlinkDeviceName,
  pyocdTargetName,
  type FlashBackendId
} from '../flash/backendProfiles';

export interface FlashDeviceContext {
  part: string;
  core: string;
  /** Absolute path to the imported CMSIS pack; required by pyOCD for non-builtin targets. */
  packFile?: string;
}

export interface FlashExecutablePaths {
  jlink?: string;
  pyocd?: string;
}

function pythonString(value: string): string {
  return JSON.stringify(value);
}

const firmwareHelpers = `
def candidate_paths(value):
    path = Path(value).expanduser()
    yield path
    if not path.is_absolute():
        yield PROJECT_DIR / path


def find_firmware(explicit):
    if explicit:
        for path in candidate_paths(explicit):
            if path.is_file():
                return str(path.resolve())
        return None

    candidates = [FIRMWARE_DEFAULT]
    for build_dir in ("build/debug", "build/Debug", "build"):
        directory = PROJECT_DIR / build_dir
        if directory.is_dir():
            candidates.extend(
                path for path in directory.iterdir()
                if path.is_file() and path.suffix.lower() in FIRMWARE_SUFFIXES
            )
    files = [path.resolve() for path in candidates if path.is_file()]
    return str(max(files, key=lambda path: path.stat().st_mtime)) if files else None


def positive_int(value):
    try:
        parsed = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be an integer")
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed
`;

export function generateFlashScript(
  projectName: string,
  target: FlashTargetProfile,
  probe: FlashProbeProfile,
  openocdPath: string,
  backend: FlashBackendId = 'openocd',
  device?: FlashDeviceContext,
  executables: FlashExecutablePaths = {}
): string {
  if (!backendSupportsProbe(backend, probe.id)) {
    throw new Error(`Unsupported backend/probe pair: ${backend}/${probe.id}`);
  }
  if (backend === 'jlink') {
    return generateJlinkScript(projectName, device, executables.jlink ?? 'JLink');
  }
  if (backend === 'pyocd') {
    if (device?.packFile && !existsSync(device.packFile)) {
      throw new Error(`pyOCD pack file does not exist: ${device.packFile}`);
    }
    return generatePyocdScript(projectName, probe, device, executables.pyocd ?? 'pyocd');
  }
  return generateOpenocdScript(projectName, target, probe, openocdPath);
}

function generateOpenocdScript(
  projectName: string,
  target: FlashTargetProfile,
  probe: FlashProbeProfile,
  openocdPath: string
): string {
  const defaultFirmware = `build/debug/${projectName}.elf`;
  return `#!/usr/bin/env python3
"""Flash ${projectName} with OpenOCD.

The script is independent from CMake. Select another firmware or OpenOCD
executable with --firmware and --openocd when using a custom build system.
"""

import argparse
from pathlib import Path
import os
import shlex
import shutil
import subprocess
import sys

OPENOCD_DEFAULT = ${pythonString(openocdPath)}
PROJECT_DIR = Path(__file__).resolve().parent
FIRMWARE_DEFAULT = PROJECT_DIR / ${pythonString(defaultFirmware)}
TARGET_CFG = ${pythonString(target.targetConfig)}
TRANSPORT = ${pythonString(target.transport)}
FLASH_BASE = 0x${target.flashBase.toString(16).toUpperCase().padStart(8, '0')}
DEFAULT_PROBE = ${pythonString(probe.id)}
FIRMWARE_SUFFIXES = (".elf", ".hex", ".bin")

PROBE_INTERFACES = {
    "jlink-ob": "interface/jlink.cfg",
    "jlink": "interface/jlink.cfg",
    "stlink": "interface/stlink.cfg",
    "daplink": "interface/cmsis-dap.cfg",
}


def candidate_paths(value):
    path = Path(value).expanduser()
    yield path
    if not path.is_absolute():
        yield PROJECT_DIR / path


def find_openocd(explicit):
    candidate = explicit or OPENOCD_DEFAULT
    for path in candidate_paths(candidate):
        if path.is_file():
            return str(path.resolve())
    found = shutil.which(str(candidate))
    return str(Path(found).resolve()) if found else None


def find_firmware(explicit):
    if explicit:
        for path in candidate_paths(explicit):
            if path.is_file():
                return str(path.resolve())
        return None

    candidates = [FIRMWARE_DEFAULT]
    for build_dir in ("build/debug", "build/Debug", "build"):
        directory = PROJECT_DIR / build_dir
        if directory.is_dir():
            candidates.extend(
                path for path in directory.iterdir()
                if path.is_file() and path.suffix.lower() in FIRMWARE_SUFFIXES
            )
    files = [path.resolve() for path in candidates if path.is_file()]
    return str(max(files, key=lambda path: path.stat().st_mtime)) if files else None


def find_scripts_root(openocd):
    executable = Path(openocd).resolve()
    prefix = executable.parent.parent
    roots = []
    environment_root = os.environ.get("OPENOCD_SCRIPTS")
    if environment_root:
        roots.append(Path(environment_root).expanduser())
    roots.extend([
        prefix / "scripts",
        prefix / "share" / "openocd" / "scripts",
        prefix / "openocd" / "scripts",
        executable.parent / "scripts",
    ])
    seen = set()
    for root in roots:
        resolved = root.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if (resolved / "target").is_dir():
            return str(resolved)
    return None


def resolve_config(scripts_root, config):
    value = Path(config)
    if (value.is_absolute() or value.suffix.lower() != ".cfg"
            or chr(92) in str(config) or ".." in value.parts):
        raise ValueError("Unsafe OpenOCD configuration path")
    root = Path(scripts_root).resolve()
    config_path = (root / value).resolve()
    try:
        config_path.relative_to(root)
    except ValueError:
        raise ValueError("Unsafe OpenOCD configuration path")
    if not config_path.is_file():
        raise FileNotFoundError("OpenOCD configuration not found: " + str(config))
    return str(config_path)


def tcl_quote(value):
    return chr(34) + value.replace(chr(92), "/").replace(chr(34), chr(92) + chr(34)) + chr(34)


def build_program_command(firmware, verify, reset):
    command = ["program", tcl_quote(firmware)]
    if Path(firmware).suffix.lower() == ".bin":
        command.append(hex(FLASH_BASE))
    if verify:
        command.append("verify")
    if reset:
        command.append("reset")
    command.append("exit")
    return " ".join(command)


def positive_int(value):
    try:
        parsed = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be an integer")
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def run_openocd(command, scripts_root):
    print("---- OpenOCD output ----")
    process = None
    try:
        process = subprocess.Popen(command, cwd=scripts_root)
        returncode = process.wait(timeout=120)
    except subprocess.TimeoutExpired:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait()
        sys.exit("Error: OpenOCD timed out after 120 seconds. Check target power and wiring.")
    except KeyboardInterrupt:
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait()
        sys.exit("Error: OpenOCD was interrupted.")
    except OSError as error:
        sys.exit("Error: unable to start OpenOCD: " + str(error))
    return returncode


def main():
    parser = argparse.ArgumentParser(
        description="Flash ${projectName} with OpenOCD",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--firmware", "-f", help="Firmware file (.elf/.hex/.bin)")
    parser.add_argument("--probe", "--interface", dest="probe", choices=PROBE_INTERFACES,
                        default=DEFAULT_PROBE, help="Probe type (default: %(default)s)")
    parser.add_argument("--openocd", "-o", help="OpenOCD executable path")
    parser.add_argument("--target", default=TARGET_CFG, help="OpenOCD target cfg")
    parser.add_argument("--transport", choices=("swd", "jtag"), default=TRANSPORT,
                        help="Debug transport (default: %(default)s)")
    parser.add_argument("--speed", type=positive_int, default=4000, help="Debug clock in kHz")
    parser.add_argument("--no-verify", action="store_false", dest="verify",
                        help="Skip verification after programming")
    parser.add_argument("--no-reset", action="store_false", dest="reset",
                        help="Do not reset and run after programming")
    parser.add_argument("--dry-run", action="store_true", help="Print the command without running it")
    args = parser.parse_args()

    openocd = find_openocd(args.openocd)
    firmware = find_firmware(args.firmware)
    if not openocd:
        sys.exit("Error: OpenOCD was not found. Set --openocd or cmakeForge.openocdPath.")
    if not firmware:
        message = "specified firmware was not found" if args.firmware else "firmware was not found"
        sys.exit("Error: " + message + ". Set --firmware to an ELF, HEX, or BIN file.")
    if Path(firmware).suffix.lower() not in FIRMWARE_SUFFIXES:
        sys.exit("Error: firmware must be an ELF, HEX, or BIN file.")

    scripts_root = find_scripts_root(openocd)
    if not scripts_root:
        sys.exit("Error: OpenOCD scripts directory was not found next to the executable.")
    try:
        interface_cfg = resolve_config(scripts_root, PROBE_INTERFACES[args.probe])
        target_cfg = resolve_config(scripts_root, args.target)
    except (ValueError, FileNotFoundError) as error:
        sys.exit("Error: " + str(error))

    command = [
        openocd,
        "-s", scripts_root,
        "-f", interface_cfg,
        "-f", target_cfg,
        "-c", "foreach _mcu_target [target names] { $_mcu_target configure -work-area-backup 1 }",
        "-c", "adapter speed " + str(args.speed),
        "-c", "transport select " + args.transport,
        "-c", build_program_command(firmware, args.verify, args.reset),
    ]

    print("=" * 60)
    print("OpenOCD:", openocd)
    print("Probe:", args.probe, "(" + PROBE_INTERFACES[args.probe] + ")")
    print("Target:", args.target)
    print("Transport:", args.transport)
    print("Firmware:", firmware)
    print("Verify:", "yes" if args.verify else "no", "Reset:", "yes" if args.reset else "no")
    print("=" * 60)
    print("Command:")
    print("  " + shlex.join(command))
    if args.dry_run:
        return

    returncode = run_openocd(command, scripts_root)
    if returncode != 0:
        print("Flash failed (OpenOCD exit code %d)" % returncode)
        sys.exit(returncode)
    print("Flash completed successfully.")


if __name__ == "__main__":
    main()
`;
}

function generateJlinkScript(
  projectName: string,
  device: FlashDeviceContext | undefined,
  jlinkDefault: string
): string {
  const defaultFirmware = `build/debug/${projectName}.hex`;
  return `#!/usr/bin/env python3
"""Flash ${projectName} with SEGGER J-Link Commander.

Edit JLINK_DEVICE below with the exact device name from the SEGGER database
when the generic name does not select the right flash loader.
"""

import argparse
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile

JLINK_DEFAULT = ${pythonString(jlinkDefault)}
PROJECT_DIR = Path(__file__).resolve().parent
FIRMWARE_DEFAULT = PROJECT_DIR / ${pythonString(defaultFirmware)}
JLINK_DEVICE = ${pythonString(jlinkDeviceName(device?.part, device?.core))}
FIRMWARE_SUFFIXES = (".elf", ".hex")
${firmwareHelpers}
def find_jlink(explicit):
    candidates = [explicit or JLINK_DEFAULT]
    base = candidates[0]
    if sys.platform == "win32":
        candidates.append(base + ".exe")
    else:
        candidates.append("JLinkExe")
    for name in candidates:
        for path in candidate_paths(name):
            if path.is_file():
                return str(path.resolve())
        found = shutil.which(str(name))
        if found:
            return str(Path(found).resolve())
    return None


def run_jlink(jlink, jlink_args, command_file):
    print("---- J-Link output ----")
    process = None
    try:
        process = subprocess.Popen([jlink, *jlink_args, "-CommanderScript", command_file])
        returncode = process.wait(timeout=120)
    except subprocess.TimeoutExpired:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait()
        sys.exit("Error: J-Link timed out after 120 seconds. Check target power and wiring.")
    except KeyboardInterrupt:
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait()
        sys.exit("Error: J-Link was interrupted.")
    except OSError as error:
        sys.exit("Error: unable to start J-Link: " + str(error))
    return returncode


def main():
    parser = argparse.ArgumentParser(
        description="Flash ${projectName} with J-Link Commander",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--firmware", "-f", help="Firmware file (.elf/.hex)")
    parser.add_argument("--jlink", help="J-Link Commander executable path")
    parser.add_argument("--device", default=JLINK_DEVICE,
                        help="SEGGER device name (default: %(default)s)")
    parser.add_argument("--speed", type=positive_int, default=4000, help="Debug clock in kHz")
    parser.add_argument("--no-reset", action="store_false", dest="reset",
                        help="Do not reset and run after programming")
    parser.add_argument("--dry-run", action="store_true", help="Print the command without running it")
    args = parser.parse_args()

    jlink = find_jlink(args.jlink)
    firmware = find_firmware(args.firmware)
    if not jlink:
        sys.exit("Error: J-Link Commander was not found. Set --jlink or cmakeForge.jlinkPath.")
    if not firmware:
        message = "specified firmware was not found" if args.firmware else "firmware was not found"
        sys.exit("Error: " + message + ". Set --firmware to an ELF or HEX file (BIN needs an address).")
    if Path(firmware).suffix.lower() not in FIRMWARE_SUFFIXES:
        sys.exit("Error: J-Link flashes ELF or HEX files; convert BIN files first.")

    # J-Link Commander treats the rest of the line as the file name, so a
    # project under a path with spaces must be quoted.
    commands = [f'loadfile "{firmware.replace(chr(92), "/")}"']
    if args.reset:
        commands.extend(["r", "g"])
    commands.append("qc")

    jlink_args = [
        "-device", args.device,
        "-if", "SWD",
        "-speed", str(args.speed),
        "-autoconnect", "1",
    ]
    command = [jlink, *jlink_args, "-CommanderScript", "<command file>"]

    print("=" * 60)
    print("J-Link:", jlink)
    print("Device:", args.device)
    print("Firmware:", firmware)
    print("Command file:")
    print("  " + commands[0])
    for line in commands[1:]:
        print("  " + line)
    print("=" * 60)
    print("Command:")
    print("  " + shlex.join(command))
    if args.dry_run:
        return

    with tempfile.NamedTemporaryFile("w", suffix=".jlink", delete=False) as handle:
        handle.write("\\n".join(commands) + "\\n")
        command_file = handle.name
    returncode = run_jlink(jlink, jlink_args, command_file)
    if returncode != 0:
        print("Flash failed (J-Link exit code %d)" % returncode)
        sys.exit(returncode)
    print("Flash completed successfully.")


if __name__ == "__main__":
    main()
`;
}

function generatePyocdScript(
  projectName: string,
  probe: FlashProbeProfile,
  device: FlashDeviceContext | undefined,
  pyocdDefault: string
): string {
  const defaultFirmware = `build/debug/${projectName}.hex`;
  const packFile = device?.packFile;
  return `#!/usr/bin/env python3
"""Flash ${projectName} with pyOCD.

Built for ST-Link and DAPLink probes. Targets imported from a CMSIS pack
pass the pack file on the pyOCD command line, so any vendor is supported.
"""

import argparse
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

PYOCD_DEFAULT = ${pythonString(pyocdDefault)}
PROJECT_DIR = Path(__file__).resolve().parent
FIRMWARE_DEFAULT = PROJECT_DIR / ${pythonString(defaultFirmware)}
PYOCD_TARGET = ${pythonString(pyocdTargetName(device?.part))}
PYOCD_PACK = ${packFile ? pythonString(packFile) : 'None'}
DEFAULT_PROBE = ${pythonString(probe.id)}
FIRMWARE_SUFFIXES = (".elf", ".hex")
${firmwareHelpers}
PYOCD_PROBES = {
    "stlink": "stlink",
    "daplink": "cmsis-dap",
}


def find_pyocd(explicit):
    candidate = explicit or PYOCD_DEFAULT
    for path in candidate_paths(candidate):
        if path.is_file():
            return str(path.resolve())
    found = shutil.which(str(candidate))
    return str(Path(found).resolve()) if found else None


def run_pyocd(command):
    print("---- pyOCD output ----")
    process = None
    try:
        process = subprocess.Popen(command)
        returncode = process.wait(timeout=120)
    except subprocess.TimeoutExpired:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait()
        sys.exit("Error: pyOCD timed out after 120 seconds. Check target power and wiring.")
    except KeyboardInterrupt:
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait()
        sys.exit("Error: pyOCD was interrupted.")
    except OSError as error:
        sys.exit("Error: unable to start pyOCD: " + str(error))
    return returncode


def main():
    parser = argparse.ArgumentParser(
        description="Flash ${projectName} with pyOCD",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--firmware", "-f", help="Firmware file (.elf/.hex)")
    parser.add_argument("--probe", choices=PYOCD_PROBES, default=DEFAULT_PROBE,
                        help="Probe type (default: %(default)s)")
    parser.add_argument("--pyocd", help="pyOCD executable path")
    parser.add_argument("--target", default=PYOCD_TARGET,
                        help="pyOCD target name (default: %(default)s)")
    parser.add_argument("--pack", default=PYOCD_PACK, help="CMSIS pack file for the target")
    parser.add_argument("--speed", type=positive_int, default=4000, help="Debug clock in kHz")
    parser.add_argument("--dry-run", action="store_true", help="Print the command without running it")
    args = parser.parse_args()

    pyocd = find_pyocd(args.pyocd)
    firmware = find_firmware(args.firmware)
    if not pyocd:
        sys.exit("Error: pyOCD was not found. Set --pyocd or cmakeForge.pyocdPath.")
    if not firmware:
        message = "specified firmware was not found" if args.firmware else "firmware was not found"
        sys.exit("Error: " + message + ". Set --firmware to an ELF or HEX file.")
    if Path(firmware).suffix.lower() not in FIRMWARE_SUFFIXES:
        sys.exit("Error: pyOCD flashes ELF or HEX files; convert BIN files first.")
    if not args.target:
        sys.exit("Error: no pyOCD target. Set --target to a target name and --pack to its CMSIS pack.")

    command = [
        pyocd,
        "flash",
        "--target", args.target,
    ]
    if args.pack:
        command.extend(["--pack", args.pack])
    command.extend([
        "--probe", PYOCD_PROBES[args.probe],
        "--frequency", str(args.speed) + "k",
        firmware,
    ])

    print("=" * 60)
    print("pyOCD:", pyocd)
    print("Target:", args.target)
    if args.pack:
        print("Pack:", args.pack)
    print("Probe:", PYOCD_PROBES[args.probe])
    print("Firmware:", firmware)
    print("=" * 60)
    print("Command:")
    print("  " + shlex.join(command))
    if args.dry_run:
        return

    returncode = run_pyocd(command)
    if returncode != 0:
        print("Flash failed (pyOCD exit code %d)" % returncode)
        sys.exit(returncode)
    print("Flash completed successfully.")


if __name__ == "__main__":
    main()
`;
}
