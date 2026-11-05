# Preset Build Entry

## Goal and boundary

Run CMake configure and build from the extension for the generated Debug or Release preset. Use existing generated CMake files and GNU ARM tooling; do not generate application source, execute flash tools, or add Keil armclang support.

## Execution design

A Node-only runner executes argument arrays with `shell: false`. It awaits configure success before starting build, forwards decoded stdout/stderr including final partial lines, reports spawn errors and nonzero exits, and accepts cancellation. The configured ARM GNU bin directory is prepended to the child environment PATH without changing the editor environment or generated portable toolchain file.

A VS Code adapter checks workspace trust and the CMake files, offers Debug/Release, and uses an output channel plus cancellable progress. Concurrent build requests do not spawn duplicate work. The command and sidebar share this adapter. A sidebar build uses the existing busy protocol to disable generation actions until the build ends and forwards the actual outcome.

## Acceptance

- Configure failure, missing executable, or cancellation prevents a subsequent build.
- Output survives chunked UTF-8 and a final line without newline.
- Tool paths containing spaces are passed as data, never shell text.
- A real temporary CMake/Ninja project builds through the runner for both presets.
- The command, sidebar message and packaged assets agree on `cmakeEmbedded.buildProject`.
- Missing ARM GNU tools remain an explicit environmental limitation; no ARM firmware success is inferred from host builds.
