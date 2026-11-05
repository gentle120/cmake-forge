# Preset Build Implementation Plan

**Goal:** Execute existing CMake Debug/Release presets from command palette and sidebar.

**Architecture:** Node runner owns process lifetime and child environment; VS Code adapter owns workspace permission, UI and command registration; sidebar forwards one typed command.

**Tech stack:** TypeScript, Node child_process/StringDecoder, VS Code output/progress APIs, CMake/Ninja.

## Runner

- Add tests in `src/test/buildRunner.test.ts` for sequential configure/build, configure failure, spawn failure, cancellation, UTF-8/final-line forwarding and ARM bin PATH propagation.
- Run `npx tsc -p .` and `node --test out/test/buildRunner.test.js` to verify the missing behavior is detected.
- Implement `src/generation/buildRunner.ts` using current Node types and `events.once` for the supported extension-host baseline; no shell commands or unused locator abstraction.
- Run the focused tests and a real temporary CMake/Ninja project with Debug/Release build presets.

## Extension adapter

- Implement `src/integration/buildProject.ts`: trusted workspace and CMake-file checks, Debug/Release picker, one active build, cancellable progress and live output.
- Register `cmakeEmbedded.buildProject` in `src/extension.ts` and `package.json`; update manifest tests before modifying the manifest.
- Exercise the adapter with a VS Code API fixture and actual child processes, covering missing workspace/presets, denied trust, success/failure, cancelled picker and duplicate requests.

## Sidebar

- Recognize `buildProject` in `src/sidebar/messages.ts`.
- Forward it in `src/sidebar/provider.ts` to `cmakeEmbedded.buildProject`.
- Add the build quick-action to `src/sidebar/webview/main.js` and verify rendered button dispatch using a browser fixture.

## Closeout

- Run `CMAKE_EMBEDDED_SKIP_FIRMWARE_BUILDS=1 npm test`; validate generated MCU build failure clearly identifies missing GNU ARM tools, not a successful firmware build.
- Package with dependencies using `npx --yes @vscode/vsce package`; inspect archive for runner, adapter, manifest command and sidebar assets.
- Update owning contracts/architecture only for stable build boundary changes. Set Current Batch to idle without history text.
- Review diff, preserve `.vscode/launch.json` and `flash.py`, stage explicit batch files and create one `change:` commit on the feature branch.
