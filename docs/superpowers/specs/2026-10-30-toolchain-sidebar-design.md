# ARM GNU Toolchain and MCU Sidebar

## Toolchain configuration

The MCU sidebar exposes the existing `cmakeEmbedded.armToolchainPath` setting as an always-visible ARM GNU GCC bin-directory input, Browse action, status and environment scan. Typed directories and GCC executable paths normalize to a bin directory. Validation checks GCC, G++, objcopy and size files; it does not claim successful compilation or hardware readiness. Empty input uses PATH.

Settings updates respect an existing workspace-folder or workspace override, otherwise use the user scope. Build and Cortex-Debug read the same effective value. Generated CMake toolchain files retain portable compiler command names.

## Layout direction

Use the incumbent VS Code theme tokens, fonts, native form controls and inline-mask icons, without dependencies or a new visual identity.

MCU content order:

1. ARM GNU GCC setup, Browse, file-status text and environment scan.
2. Vendor, series and device selection, with Pack import attached to this section.
3. Flash/debug output options, backend and compatible probe selection, followed by backend-specific details.
4. Workspace scan and summary.
5. Generate Project as the primary action, Build as a separate secondary action with the host Debug/Release chooser.

OpenOCD alone shows target cfg and its executable path. J-Link and pyOCD use their existing extension settings. Build never generates first or runs a flasher.

## Interaction

Path input submits once on Enter or changed-field blur. Browse does not commit a stale draft. Authoritative state refreshes preserve an unsaved draft, caret and disclosure state. Settings, scans, Pack imports and builds share the operation lifecycle; rejection, cancellation and exceptions release the busy state. Cancelled operations are neutral, not failures. Focus returns to the initiating control without interrupting a host chooser.

## Render constraints

At 240, 280, 320 and 420 px sidebar widths, essential controls and status text remain visible with no horizontal page overflow. Use shrinkable grid tracks and `min-width: 0` through layout ancestors; wrap descriptions and errors rather than hiding overflow or shrinking text. Narrow action groups stack, while wider layouts pair Generate/Build. Native text inputs scroll their own values. Retain visible keyboard focus and static busy feedback under reduced motion.
