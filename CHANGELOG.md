# Changelog

## 2.2.2

- 修复在线安装报「Failed to fetch pack index … HTTP undefined」：请求包装器用对象
  展开复制 `Response`，而真实的 `Response` 把 `ok`/`status`/`headers` 放在原型上，
  展开后状态丢失，所有在线索引请求都被判为失败。现在显式复制这些字段，在线安装
  恢复正常；下载进度与分段下载同样受益。
- 状态码缺失时的报错改为可执行的提示（代理/VPN/防火墙拦截，或改用本地导入）。

## 2.2.1

- 修复打包的 VSIX 漏带运行时依赖 `fast-xml-parser`：扩展激活失败，点击活动栏后
  侧栏一直空白。新增 `npm run vsix` 打包脚本，保留运行时依赖；更新安装后如果窗口
  仍在跑旧版本，执行一次 `Developer: Reload Window`。

## 2.2.0

2.2 版本。相比 2.1.x，主要变化集中在三方向生成质量、器件支持与侧栏交互：
精选 5 家主流 Cortex-M 厂商、CMSIS 内核头按内核裁剪、器件头/system 文件按 Pack
复制、调试配置可直接 F5、Linux 支持 sysroot、生成文件以树形展示，并修复了一批
厂商 Pack（Zip64、variant、内存区命名等）解析问题。要求 VS Code 1.85+。本版同时更换了扩展图标（256×256 PNG），并修正 manifest 的图标路径。

- Curated MCU catalog: the 5 most common Cortex-M vendors/families (STM32,
  GD32, NXP, nRF, Microchip) with curated series and real part-number prefixes,
  so installing that vendor's Pack makes the series/model dropdowns usable.
  Other vendors still appear automatically after importing their `.pack`. Series matching now prefers the
  longest part prefix, so nested families (Kinetis K vs KL, STM32WB vs STM32WBA)
  do not claim each other's parts. Generating flash/debug for a vendor without a
  built-in OpenOCD target mapping warns instead of silently using an STM32/GD32
  target config.
- Read Zip64 pack archives (TI's MSPM0 DFP), NXP/Microchip `<variant>` parts,
  `name=` memory regions and vendor startup vector tables with comments; skip
  devices whose declared header is missing from the Pack; drop
  `USE_STDPERIPH_DRIVER` from generated defines (drivers are the project's own)
  and emit linker sizes as exact bytes when a region is not a whole KiB.

- List generated files as a collapsible tree grouped by directory (with per-folder
  counts and the full path in the row tooltip) instead of a flat path list.

- Linux direction: optional `CMAKE_SYSROOT` (sidebar field, command-palette
  prompt, saved in `.linux-cmake.json` and reused on regeneration), written to
  the toolchain file together with `CMAKE_FIND_ROOT_PATH*`.
- The generated Cortex-Debug configuration uses `showDevDebugOutput: "raw"`, so
  a probe mismatch (`unable to find a matching CMSIS-DAP device`) is visible in
  DEBUG CONSOLE instead of only in the `gdb-server` terminal; the sidebar shows
  a probe/hardware hint next to the probe dropdown.

- Write only the device header, `system_<stem>.h/.c`, the vendor umbrella header
  and the single register header the system source needs; the rest of the
  peripheral driver library stays out of the project and an empty
  `RTE_Components.h` is generated when the umbrella includes Keil's RTE header.
- Mark device snapshots with `snapshot.json` so an up-to-date snapshot is not
  rebuilt from the Pack archive on every generation, and only scan installed
  Pack directories when the stored archive is actually missing.
- Copy device files only when their content differs, so editors and the C/C++
  index are not reloaded on every regeneration.
- Do not treat a project's `RTE_Components.h` / umbrella / RCU header as "the
  project already has device support"; only its device header or `system_*.c`
  suppresses the copy.
- Confirm overwrites with a modal dialog: a collapsed notification could leave
  the generation waiting and the sidebar stuck on "正在生成工程".
- Keep the persisted part while profiles are still loading, and keep the
  persisted `sourcePack` until the catalog revalidates it.

- Remove `preLaunchTask` from the development launch configuration: the shared
  build terminal could sit on "终端将被任务重用，按任意键关闭" and F5 looked like
  it did nothing (run `npm run compile` before launching instead).
- Document the probe mismatch that ends a firmware F5 within a second:
  `Error: unable to find a matching CMSIS-DAP device` in the `gdb-server`
  terminal means the selected debug probe does not match the connected hardware.
- Keep the persisted vendor/Pack/version/part while the Pack catalog is still
  loading and revalidate it once the catalog arrives. Without this the sidebar
  reset to "版本 — 选择版本 —" / "型号 — 无可用项 —" on every Extension
  Development Host start, so generation could not resolve a device.

- Put the generated Cortex-Debug entry first in `launch.json` so a plain F5 no
  longer runs a stale configuration another extension left at the top, and stop
  sub-directories of the copied CMSIS include roots (`CMSIS/Include/m-profile`)
  from being emitted as extra include directories.
- Make the generated debug configuration independent of CMake Tools state: the
  executable is the preset's concrete `build/debug/<project>.elf`, and the sidebar
  now falls back to the configured `cmakeEmbedded.openocdPath` (written as
  `serverpath`) instead of the bare `openocd` command, which is not on `PATH` on
  a typical Windows install.
- Explain the recurring "F5 closes immediately" in the Extension Development
  Host: the development launch configuration used `--disable-extensions`, which
  also disables CMake Tools and Cortex-Debug, so no debug target or adapter
  existed in that window. The launch configuration now keeps installed
  extensions (only the published CMake-Embedded is disabled), and generating a
  debug configuration in such a window names the cause instead of offering an
  install that cannot help.

- Trim the generated CMSIS copy to what the selected core needs: `CMSIS/Include`
  now carries the core header plus its include closure (and the GCC compiler
  headers) instead of every Cortex-M core and every toolchain's variant.
- Keep peripheral driver headers out of `CMSIS/Device`: only the device header,
  its umbrella `gd32f10x_libopt.h`, the system header/`system_*.c` and the single
  register header the system source needs (`gd32f10x_rcu.h`) are copied. The
  umbrella header includes Keil's generated `RTE_Components.h` unconditionally,
  so a stub is generated for it; enabling more peripherals is then a matter of
  defining the `RTE_DEVICE_STDPERIPH...` macros and pointing the include path at
  the project's own driver folder.
- Give the extension build task a dedicated terminal: the previous shared
  terminal could sit on "终端将被任务重用，按任意键关闭" and F5 appeared to do
  nothing.
- Keep the vendor driver library out of the device snapshot and prefer
  `Device/Include` when deriving a missing device header, so an STM32F1 Pack no
  longer looks ambiguous because of its StdPeriph headers. Snapshots written by
  the earlier filter are rebuilt automatically on the next generation.
- Recover device support files for Packs imported before the snapshot existed:
  the header is derived from the Pack's single device header (or the series
  name), and the snapshot is rebuilt from the stored archive or the installed
  directory. Directory imports now remember their source root.
- Copy the series' own device support files into generated projects:
  `CMSIS/Device/Include` gets the Pack's device header and
  `system_<stem>.h`, `CMSIS/Device/Source` gets `system_<stem>.c`, so `SystemInit`
  and the clock setup come from the selected DFP. The files are snapshotted when
  a Pack is imported and replaced when the Pack or series changes; a Pack
  without a declared device header falls back to the startup's weak default.

- Explain F5 sessions that close within a second: generating a debug
  configuration now reports a missing Cortex-Debug adapter, an unresolvable
  OpenOCD executable, and a preset that has not been built yet, instead of
  writing a launch configuration that cannot run. The README documents the
  remaining cause (`arm-none-eabi-gdb` not on `PATH`).

- Link generated MCU projects without the vendor system file: the startup now
  carries a weak, typed `SystemInit` default, so a missing
  `system_<device>.c` no longer fails the link with binutils 2.44+'s
  "Unknown destination type (ARM/Thumb)" / "dangerous relocation" error. A
  project-provided `SystemInit` still overrides it.

- Stop asking for overwrite when a regeneration changes nothing: the check now
  compares content in the MCU, Linux, native and flash-only flows, and an
  unchanged `launch.json` merge is not rewritten.
- Let the Linux direction pick an output type (executable, static or shared
  library) in the sidebar and remember it in `.linux-cmake.json`; reuse that and
  the saved language standards as defaults in the command palette for desktop
  projects.
- Share the scanner exclusion rules between source scanning and project
  discovery instead of keeping two copies, and resolve OpenOCD script roots in
  Cortex-Debug configuration the same way flash.py does (`OPENOCD_SCRIPTS`
  first).
- Reject unit-suffixed PDSC sizes instead of silently truncating them to the
  leading digits, give extra RAM banks unique section names, identify archive
  vendors from the package node when no family declares one, and report a
  saturated Zip64 entry count instead of scanning 65535 entries.
- Memoize the drive/Pack root scan, collapse the duplicate sidebar state posts,
  keep a notification from replacing the live busy badge during an operation,
  and disable only the real MCU generation commands when a Pack is missing.
- Keep the secondary README as a short index instead of a second full document.

- Regenerating an unchanged project no longer asks for overwrite: only files
  whose content differs are confirmed, the CMake source list is written in a
  stable order, and copied CMSIS headers are listed in the generated file list.
  Headers a core-pack version change no longer ships are removed.
- Selecting a Pack activates its best installed or imported version, so the
  device list fills in without a second click; the version select asks for a
  pick instead of showing a version the selection does not own.
- Merge the flash and debug switches into the two direct actions "生成 flash.py"
  and "生成 Debug 配置"; project generation no longer writes them implicitly in
  either the sidebar or the command palette.
- Tidy the sidebar layout: two-column field grid, inline core-pack version row,
  section icon badges, sticky primary action, and an explicit empty-option
  placeholder.
- Fix the flash target lookup so an imported GigaDevice pack maps to GD32
  metadata instead of falling back to the first STM32 entry, and stop bridging
  third-party STM32-compatible vendors to ST OpenOCD targets.
- Keep the request timeout armed while a response body is still loading, stop
  retrying a timed-out chunk, and cap ranged downloads before allocating the
  output buffer.
- Validate ZIP entries only when a caller reads them (an encrypted or Zip64
  entry elsewhere no longer fails the archive) and verify each entry's CRC.
- Never lose the Pack store when the Windows atomic rename has to replace the
  existing file, and tolerate restored profiles whose vendor is not registered.
- Raise the project list on workspace-folder changes, queue sidebar messages
  posted before the view resolves, and stop aborting a vendor list on an
  unregistered vendor.
- Remove the dead flash/debug selection fields and the unused probe pyOCD
  field; declare the Node.js 22 requirement and skip the Python syntax checks
  when no interpreter is installed.
- Keep the series dropdown usable on first open: curated vendors stay valid
  before the asynchronous pack scan registers them, and an empty selection
  adopts the first offered vendor and its first series.
- Copy the installed ARM CMSIS core headers into generated MCU projects
  (`CMSIS/Include`) instead of pointing at the extension storage, and offer
  the installed core-pack versions in the sidebar so a project can pin one.
- Guard the core-pack installer against archive entries that escape the install
  directory and against `.`/`..` identity fields, and write its manifest
  atomically.
- Keep hand-written assembly sources in generated CMake projects; only legacy
  `startup*` assembly is replaced by the generated GNU startup.
- Clear the previous generated-file list when a sidebar run fails, redraw
  dropdowns when option labels change, and reject truncated ZIP archives with a
  clear error instead of a range error.
- Keep the Pack dropdown consistent with the selected series: it now lists only
  Packs that serve that series (imported Packs by their parsed parts, installed and
  downloadable Packs by their DFP name), and a Pack serving another series is no
  longer kept as the active choice.
- Block MCU generation when no Pack serves the selected series: the sidebar
  explains which DFP is needed and disables "生成工程", "仅 flash.py", and
  "仅 Debug" instead of failing after the click, and the command palette reports
  the same message.
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
