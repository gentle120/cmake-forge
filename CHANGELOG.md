# Changelog

## 2.1.3

- Expose the ARM GNU GCC bin directory in the MCU sidebar with manual entry,
  folder browsing, validation, and shared build / Cortex-Debug / IntelliSense use.
- Discover EIDE, standalone Arm GNU, and CubeCLT installations on mounted drives;
  offer a choice when several GNU ARM toolchains are installed.
- Explain Windows stack-usage path failures with an actionable message, and
  report cancellation separately from build failure.
- Reorganize the MCU sidebar around toolchain, target, flash/debug, workspace,
  and distinct generate/build actions; add missing icons and narrow-width layout.

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
