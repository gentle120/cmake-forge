# Changelog

## 2.1.3

- Fix the frozen series dropdown: vendor packs name their series their own way
  (`Dfamily="STM32F1 Series"`) while the sidebar persists the curated id (`F1x`),
  so an exact-match comparison snapped the selection back to the pack text and
  every further switch bounced. Both names now match, catalog ids are deduplicated,
  a legacy persisted pack text is normalized, and a series without a matching pack
  stays selected with a note naming the DFP to install.
- Add the "生成内核包 include" switch to the sidebar: it decides whether the
  installed ARM CMSIS include directory is written into generated projects
  (default on) and persists with the rest of the selection.
- Add the ARM CMSIS core pack: device packs include `core_cm*.h` but do not ship
  it, so the sidebar gains "安装内核包…" (and the `Install ARM CMSIS Core Pack`
  command) to download or import `ARM.CMSIS`, install only its Core include
  directory, and add it to every generated project automatically.
- Show download progress while installing a pack online: the notification and the
  sidebar badge report transferred size, total size, and percentage.
- Download packs over a channel suited to mainland networks: Keil-hosted archives
  skip the slow `www.keil.com` redirect and large archives are fetched in
  parallel ranges with per-chunk retries, falling back to one streaming request.
- Add the optional `cmakeEmbedded.packMirror` setting to serve packs from a flat
  local or domestic mirror directory ahead of the public CDN.
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
