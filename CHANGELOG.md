# Changelog

## 2.1.3

- Replace the built-in chip tables with CMSIS Pack parsing: every device profile
  comes from a pack's PDSC, so any 32-bit ARM MCU with a pack is supported.
- Add dynamic vendor and series registries plus curated mainstream chip vendors,
  and reorder the MCU selection to vendor, series, pack, version, and part.
- Add "Import CMSIS Pack" for local archives, Keil installations, and the public
  CMSIS index, and "Install Pack Online" which downloads the selected series'
  device pack inside the extension, imports it, and activates it.
- Imported packs persist in extension storage; identity comes from the PDSC, and
  a broken upgrade never erases the last known-good pack.
- Add J-Link and pyOCD flash backends next to OpenOCD, driven by the pack's
  debug target, and generate the matching flash scripts and debug configuration.
- Extend the sidebar to MCU, Linux / SoC cross-compilation, and desktop C/C++
  projects with persistent per-workspace selections, workspace and project
  discovery, and cancellable scans.
- Add the architecture, contracts, and roadmap governance documents.

## 2.1.2

- Add the `CMake-Embedded: Build Project` command and MCU sidebar build action
  using the generated Debug/Release presets, live output, and cancellation.

## 2.1.1

- Compress the Marketplace icon to a 256x256 PNG below the 1 MB upload limit.
- Remove the obsolete README screenshot and its packaged image asset.

## 2.1.0

- Add a sidebar with one-click generation for MCU, Linux / SoC, and ordinary
  desktop C/C++ CMake projects.
- Add persistent per-workspace selections, workspace scanning, generated-file
  feedback, and a compact VS Code-native interface.
- Add desktop C/C++ project generation with executable, static-library, and
  shared-library targets, language standards, Ninja presets, and IntelliSense.
- Make the Chinese README the default documentation and package all sidebar
  assets with the extension.
