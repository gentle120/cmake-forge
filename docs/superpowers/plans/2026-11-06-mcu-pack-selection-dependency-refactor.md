# MCU Pack Selection and Dependency Refactor Implementation Plan

> **For agentic workers:** Use the executing-plans skill to execute this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make CMSIS Device Family Packs the normal MCU metadata source through a five-stage sidebar flow, retain derived offline built-ins, and remove extension-owned ARM path/build controls.

**Architecture:** Keep `DeviceProfile` as the normalized generator input. Add pack/version ownership to selection and import records, derive built-ins centrally from series templates plus chip deltas, and leave CMake project artifacts for CMake Tools while deleting the extension's build runner and ARM path configuration.

**Tech Stack:** TypeScript, VS Code Webview API, Node `node:test`, `fast-xml-parser`, CMake Tools.

**Spec:** `docs/superpowers/specs/2026-11-06-mcu-pack-selection-dependency-refactor-design.md`

## Global Constraints

- Only modify the `master` repository; do not touch sibling `minor`, `out/`, or `node_modules/`.
- Keep generated compiler identifiers `arm-none-eabi-gcc`, `arm-none-eabi-g++`, `arm-none-eabi-objcopy`, and `arm-none-eabi-size` portable.
- Preserve Linux/SoC, desktop C/C++, flash script, Cortex-Debug, and CMake project generation behavior.
- Pack index/network errors must not hide built-in or installed choices; rejected downloads must not change persisted selection.
- Follow TDD for behavior changes; do not change the test fixture to make a failing behavior pass.
- Update `docs/roadmap.md` before code edits and reconcile it before closeout.

---

### Task 1: Centralize Built-In Series Metadata

**Files:**
- Create: `src/devices/builtinDeviceData.ts`
- Modify: `src/devices/deviceProfiles.ts`, `src/devices/stm32/**`, `src/devices/gd32/**`, `src/devices/profileValidation.ts`
- Test: `src/test/deviceProfile.test.ts`, `src/test/stm32*Series.test.ts`, and generated artifact tests for linker/startup/toolchain/CMake output

**Interfaces:**
- `getDeviceProfile(part: string): DeviceProfile` remains the normalized generator-facing lookup.
- Add a built-in series-template table and part-difference table; derive linker names as `<PART>.ld`, toolchain names from the series template, and startup/vector choices from the series template or explicit named part delta.

- [ ] **Step 1: Write failing behavior tests** asserting representative same-series profiles inherit the same template core/flags/vector table, part-specific memory/define/vector exceptions remain exact, and generated filenames are derived as expected.
- [ ] **Step 2: Run the focused tests in the disposable mirror**; confirm failures concern missing centralized derivation rather than compilation.
- [ ] **Step 3: Implement the smallest registry refactor** moving repeated flash/RAM, interrupt, startup and file-name values to series templates and explicit part deltas while preserving every current public profile value.
- [ ] **Step 4: Run focused profile, linker, startup, toolchain and CMake generator tests**; verify all representative generated artifacts still use the normalized profile.

### Task 2: Model Pack Identity, Installed Versions, and Full Online Versions

**Files:**
- Create or modify: `src/devices/importedProfiles.ts`, `src/devices/deviceProfiles.ts`, `src/env/toolchainScanner.ts`, `src/packs/packIndex.ts`
- Test: `src/test/importedProfiles.test.ts`, `src/test/toolchainScanner.test.ts`, `src/test/packIndex.test.ts`

**Interfaces:**
- Imported Pack records expose stable `packId`, `vendorId`, `name`, and `version` in addition to source/archive and owned parts; legacy `packs.json` entries remain readable.
- Pack catalog entries distinguish `builtin`, `installed`, `imported`, and `downloadable` versions. Selecting one installed or downloadable version resolves it to profiles owned by that exact Pack.
- Online version ordering is numeric and retains every version for sidebar selection; keyword search may still return results in deterministic order.

- [ ] **Step 1: Add failing tests** for two versions of one Pack being independently listed/owned, downloaded versions not collapsing to the newest, installed archive/directory identity, and old store migration.
- [ ] **Step 2: Run the focused Pack/index/scanner tests** and verify expected failures.
- [ ] **Step 3: Implement version-preserving catalog APIs and explicit per-Pack profile lookup**, retaining current atomic writes, serialized imports, Keil roots, and real archive-path rules.
- [ ] **Step 4: Re-run focused Pack tests**, including replacement, restore, failed import, and removal behavior.

### Task 3: Wire the Five-Stage MCU Sidebar Flow

**Files:**
- Create or modify: `src/devices/devicePacks.ts`, `src/sidebar/state.ts`, `src/sidebar/messages.ts`, `src/sidebar/provider.ts`, `src/sidebar/html.ts`, `src/sidebar/webview/main.js`, `src/sidebar/webview/main.css`, `src/extension.ts`
- Test: `src/test/sidebarState.test.ts`, `src/test/sidebarMessages.test.ts`, `src/test/sidebarAssets.test.ts`, `src/test/sidebarBuild.test.ts` (retaining discovery/scan tests only), and new `src/test/sidebarPackSelection.test.ts`

**Interfaces:**
- Persist MCU selection as `{ vendor, packId, version, series, part }`.
- Sidebar state exposes vendor, Pack, version, series, and device option arrays. `loadPackCatalog(vendor)` returns Pack/version choices with origin labels; `activatePack(vendor, packId, version)` returns the activated pack's usable profiles and import summary.
- Built-in virtual Pack identity is stable per vendor and has a single `Built-in` version.

- [ ] **Step 1: Add failing state/message/provider tests** for vendor -> Pack -> version -> series -> part, built-in offline fallback, installed activation, online activation, stale catalog response rejection, and activation-error selection preservation.
- [ ] **Step 2: Run those focused tests** and confirm failures expose missing Pack selection behavior.
- [ ] **Step 3: Implement catalog loading and activation** so installed packs parse/import locally, downloadable versions download/import once selected, successful activation refreshes and selects the first usable series/part, and failures leave the previous persisted choice intact.
- [ ] **Step 4: Replace the webview controls** with the five-stage selects and render a non-blocking offline/index status while retaining operation feedback and existing flash/debug controls.
- [ ] **Step 5: Run sidebar tests and inspect rendered markup behavior** at narrow widths; assert Pack options remain usable when online loading fails.

### Task 4: Remove Plugin-Owned Toolchain Path and Build Workflows

**Files:**
- Delete: `src/integration/toolchainSettings.ts`, `src/env/armToolchain.ts`, `src/integration/buildProject.ts`, `src/generation/buildWorkflow.ts`, `src/generation/buildRunner.ts`, their dedicated tests
- Delete tests: `src/test/armToolchain.test.ts`, `src/test/toolchainSettings.test.ts`, `src/test/buildProjectAdapter.test.ts`, `src/test/buildWorkflow.test.ts`, `src/test/buildRunner.test.ts`, `src/test/buildRunnerIntegration.test.ts`, `src/test/sidebarToolchain.test.ts`
- Modify: `package.json`, `src/extension.ts`, `src/sidebar/state.ts`, `src/sidebar/messages.ts`, `src/sidebar/provider.ts`, `src/sidebar/html.ts`, `src/sidebar/webview/main.js`, `src/sidebar/webview/main.css`, `src/env/toolchainScanner.ts`, `src/generator/debugConfigGenerator.ts`, `src/generation/workflow.ts`, `src/integration/cppProperties.ts`, `src/test/sidebarBuild.test.ts`, README files, `docs/contracts.md`, `docs/architecture.md`
- Test: `src/test/packageManifest.test.ts`, sidebar tests, `src/test/debugConfigGenerator.test.ts`, `src/test/toolchainScanner.test.ts`, `src/test/cppProperties.test.ts`

**Interfaces:**
- No `cmakeEmbedded.buildProject`, `cmakeEmbedded.selectArmToolchain`, or `cmakeEmbedded.armToolchainPath` extension surface remains.
- MCU generated toolchain/compiler files continue to use portable command names. Cortex-Debug no longer receives a machine-local ARM path; IntelliSense uses the portable command and generated compile commands.
- `cmakeBuild.test.ts` remains because it validates generated CMake artifacts, not the deleted extension build command.

- [ ] **Step 1: Add failing manifest/consumer tests** confirming command/settings/UI absence, portable compiler names, and unchanged Linux/native/flash/debug interfaces.
- [ ] **Step 2: Run focused tests** and confirm failures identify remaining extension-owned path/build behavior.
- [ ] **Step 3: Remove the setting, commands, card, message handlers, path scanner/validator, and configure/build runner**; preserve Pack discovery and non-ARM tool scanning.
- [ ] **Step 4: Update English/Chinese user docs, `docs/contracts.md`, and `docs/architecture.md`** only where their stable behavior/ownership changed.
- [ ] **Step 5: Run focused tests and search source/manifests/docs** for removed command and setting identifiers; retain generator tests for portable command names.

### Task 5: Functional Acceptance and Closeout

**Files:**
- Modify: `docs/roadmap.md`, tests/docs only for acceptance findings

- [ ] **Step 1: Exercise selection behavior** for built-in offline, installed archive/directory, downloadable version, network-index failure, download/parse error, and switching vendors while a catalog request is pending.
- [ ] **Step 2: Exercise preserved behavior** for Linux/SoC generation, desktop C/C++ generation, flash script generation, Cortex-Debug generation, and generated CMake toolchain portability.
- [ ] **Step 3: Run `npm test` in a fresh disposable mirror** that excludes the repository's `.git`, `minor`, `out/`, and `node_modules/` paths; link only the existing dependency directory read-only by convention, and record the exact command and result.
- [ ] **Step 4: Reconcile roadmap**, inspect `git status --short`, `git diff --check`, and the full scoped diff; confirm no `minor`, `out/`, or `node_modules/` content changed.
- [ ] **Step 5: Stage explicit changed files and create one `change: ...` commit only after all repository gates pass; never push.**
