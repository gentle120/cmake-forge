# MCU Pack Selection and Build Ownership

## Goal

Rework MCU selection around vendor Device Family Packs while keeping built-in MCU support available offline. Remove the extension's ARM toolchain-path configuration and explicit CMake build command so CMake Tools owns toolchain discovery, configuration, and compilation.

## Scope

- Replace vendor -> series -> part selection with vendor -> pack -> version -> series -> part.
- List built-in virtual packs, installed CMSIS packs, and online catalog entries for the selected vendor. Selecting an installed pack makes its supported devices selectable. Selecting an online version downloads, parses, imports, refreshes, and selects that pack/version.
- Preserve offline use through a built-in virtual pack. Network/index failures are non-fatal and do not hide installed or built-in choices.
- Make pack metadata the source for imported MCU memory, core, defines, FPU, and interrupt data. Keep built-in profiles as an offline fallback, derived from series templates plus explicit part differences rather than repeating memory/vector/file-name fields per chip.
- Remove the plugin-owned ARM GNU path UI, setting, commands, validation, save and scan paths; remove the plugin-owned configure/build command and execution pipeline. Keep generated CMake projects, presets and portable `arm-none-eabi-*` compiler command names for CMake Tools.
- Preserve Linux/SoC, desktop C/C++, flash script, Cortex-Debug, and CMake project generation behavior.

## Architecture

Keep `DeviceProfile` as the normalized generator input, but stop treating the global profile list as the MCU selection catalog. Add a Pack catalog/selection layer that describes each selectable pack by stable identity, vendor, version and origin (built-in, installed/imported, or online). A selected pack provides its own series and parts; resolving a part materializes or retrieves the normalized profile used by existing generators.

The sidebar persists pack identity and version alongside vendor/series/part. Pack catalog state is loaded for the selected vendor asynchronously. Requests must be guarded against stale vendor changes. The webview exposes separate pack and version controls and derives series/device choices from the selected version. A busy operation covers local parsing or online download/import so repeated selections cannot race.

The built-in registry uses shared series templates for invariant core/compiler/startup/vector defaults and a part-difference table for real exceptions such as memory sizes, defines, additional regions, or vector variants. Deterministic generated filenames are derived centrally. Pack-derived profiles use parsed PDSC/SVD data for device-specific metadata; generated filenames and portable compiler command names remain generator policy.

The online catalog retains version entries instead of collapsing each pack to its latest version. Installed Pack discovery reuses the existing Keil roots and archive/directory parsers. Imported Pack records retain enough vendor/name/version/source identity to match catalog entries and restore the selected pack after restart. Existing local-import and Pack-removal commands may remain as explicit maintenance entry points; they are no longer the sidebar's normal selection flow.

## Selection and Import Behavior

1. Vendor selection loads built-in, installed/imported, and online Pack choices for that vendor.
2. Pack selection loads or reveals its versions. The built-in virtual Pack has one `Built-in` version.
3. Selecting an installed version parses/imports it if needed, then refreshes the sidebar and selects the first supported series and part.
4. Selecting an online version downloads the archive, imports it into extension storage, refreshes the sidebar and selects it. The import result reports skipped unsupported/incomplete devices; a pack with no usable devices is not selected.
5. Catalog network errors are shown as non-blocking state. Existing built-in and installed choices remain usable. Download or parse errors leave the previous valid selection intact.
6. On startup, an unavailable saved Pack falls back to that vendor's built-in Pack when present, otherwise to an available Pack/device using existing validation rules.

## Build and Toolchain Ownership

Remove `cmakeEmbedded.buildProject`, its sidebar button/message routing, build adapter/workflow/runner and their tests/docs. Keep `CMakeLists.txt`, CMake presets and toolchain-file generation; those are generated project artifacts and remain usable by the declared CMake Tools dependency. Generated compiler identifiers remain `arm-none-eabi-gcc`, `arm-none-eabi-g++`, `arm-none-eabi-objcopy`, and `arm-none-eabi-size`.

Remove the `cmakeEmbedded.armToolchainPath` contribution, `selectArmToolchain` command, sidebar card and messages, `toolchainSettings.ts`, and path-specific normalization/validation/discovery code. Cortex-Debug generation no longer injects a machine-local ARM path. C/C++ IntelliSense continues to use portable compiler command names and CMake compile commands.

## Stable Boundaries

- `DeviceProfile` remains the generator-facing, validated profile contract.
- Pack identity/version and part ownership are explicit enough that selection, replacement, restart restoration, and Pack removal do not accidentally mix devices from different Packs.
- Pack import remains serialized and atomically persisted; failed imports do not replace a previously valid Pack.
- Generated MCU build files use portable ARM GNU command names and do not embed a machine-specific toolchain path.
- Linux/native generation and flash/debug generation remain independent from the removed plugin build runner.

## Failure and Compatibility

- Treat offline/unavailable indexes as an empty online catalog with a visible non-blocking status, not as a failure of local MCU selection.
- Reject stale async catalog results after vendor or Pack changes.
- Do not update persisted selection until a chosen Pack/version has at least one usable profile.
- Preserve existing Pack store compatibility and migrate legacy records when adding identity/version metadata.
- Continue skipping unsupported Dcore or incomplete Pack devices with per-device reasons; do not create partial profiles.

## Verification

- Unit tests cover Pack identity/version catalog merging, numeric version ordering, offline catalog failure, per-pack series/device filtering, selection sanitization, built-in template/difference derivation, and Pack install/restore/remove behavior.
- Provider/webview tests exercise the five-stage selection flow, installed selection, downloaded selection, stale-request rejection, and download/import error recovery.
- Manifest/sidebar tests assert removed ARM-path and plugin-build commands/settings/UI are absent while Pack, Linux/native, flash, and debug entry points remain.
- Run focused tests first, then `npm test`. Perform rendered Webview acceptance for online-unavailable, built-in, installed, and downloaded paths; exercise preserved Linux/native/flash/debug operations and inspect generated CMake toolchain files for portable compiler names and absence of machine paths.
