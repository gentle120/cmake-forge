# CMake-Embedded

用于 VS Code 的 CMake 工程生成插件，支持三个互相独立的方向：

- **MCU 固件**：ARM Cortex-M 裸机工程，芯片数据全部来自 CMSIS Pack，生成
  CMake、链接脚本、GNU 启动文件、工具链文件与 Debug 配置。
- **Linux / SoC**：面向 loongarch64、aarch64、armv7 hard-float、riscv64 的
  交叉编译工程，可选 `CMAKE_SYSROOT`。
- **桌面 C/C++**：用本机编译器生成可执行文件、静态库或动态库。

插件只生成工程文件；配置、编译、烧录与调试分别交给 CMake Tools、Cortex-Debug
和生成的 `flash.py`，插件自身不执行编译器或烧录器进程。

## 快速开始

安装后在活动栏点击 **CMake-Embedded** 图标，在侧栏选择方向与目标，点击「生成工程」。

- 侧栏依次选择：**厂商 → 系列 → 芯片支持包 (Pack) → 版本 → 型号**；选择结果按工作区保存。
- MCU 页面可单独生成 `flash.py` 或 Cortex-Debug 配置；命令面板入口全部保留。
- 生成后使用 CMake Tools 的 `debug` / `release` 预设：

  ```powershell
  cmake --preset debug      # 或 cmake --preset release
  cmake --build --preset debug
  ```

**环境要求**：VS Code 1.85+、CMake Tools、C/C++ 插件、CMake ≥ 3.22、Ninja。
MCU 额外需要 Cortex-Debug、OpenOCD，以及 Arm GNU Toolchain
（`arm-none-eabi-gcc/g++/objcopy/size` 在 `PATH` 中）；Linux 需要对应前缀的
`gcc`/`g++`。

## MCU 固件

- 内置 5 家常用厂商：STM32、GD32、NXP、nRF、Microchip，每家带精选系列；
  其它厂商导入 `.pack` 后按 PDSC 自动出现。
- Pack 来源：本地归档、Keil 已安装目录、CMSIS 在线索引，或侧栏「在线安装 Pack…」；
  缺少 `core_cm*.h` 时用「安装内核包…」安装 `ARM.CMSIS`。
- 生成工程按所选内核裁剪 CMSIS 头，只复制器件头、`system_<stem>.h/.c` 和必需的
  厂商 umbrella/寄存器头，不整包复制外设驱动库。
- 烧录脚本支持 J-Link、ST-Link、DapLink；OpenOCD target 覆盖 STM32 与 GD32，
  其它厂商生成时会提示手动修改 `configFiles`。

**F5 立刻退出** 通常是调试器进程没启动，按顺序检查：Cortex-Debug 是否安装、
`cmakeEmbedded.openocdPath` 是否可执行、是否先构建过 `debug` 预设、
`arm-none-eabi-gdb` 是否在 `PATH`、调试下拉是否选中 `CMake-Embedded OpenOCD`。
具体原因看「调试控制台」和「终端 → gdb-server」。

生成的 MCU 工程目录：

```text
<project>/
├── CMakeLists.txt
├── CMakePresets.json
├── .mcu-cmake.json
├── <mcu>.ld
├── startup_<device>.S
├── CMSIS/
│   ├── Include/          # 所选内核用到的 core 头
│   └── Device/
│       ├── Include/      # 器件头 + system_<stem>.h
│       └── Source/       # system_<stem>.c
├── cmake/<device>-toolchain.cmake
├── system/{syscalls.c,sysmem.c}
├── .vscode/{settings.json,c_cpp_properties.json,launch.json}
└── flash.py              # 可选
```

构建输出在 `build/debug` 与 `build/release`（`.elf`、`.hex`、`.bin`、`.map`）。

## Linux / SoC

| 目标 | 工具链前缀 |
| --- | --- |
| 龙芯 loongarch64 | `loongarch64-linux-gnu-` |
| ARM aarch64 | `aarch64-linux-gnu-` |
| ARM 32 位 armv7hf | `arm-linux-gnueabihf-` |
| RISC-V riscv64 | `riscv64-linux-gnu-` |

工具链按 `CROSS_COMPILE`、`CC`/`CXX`、`PATH` 顺序查找，只写命令名不写绝对路径。
目标 sysroot 可选，填写后会写入工具链文件的 `CMAKE_SYSROOT` 与
`CMAKE_FIND_ROOT_PATH*`，并记录在 `.linux-cmake.json` 中。

## 命令

| 命令 | 说明 |
| --- | --- |
| `Generate MCU Project` | 生成 MCU 裸机工程 |
| `Generate Linux Project` | 生成 Linux 交叉编译工程 |
| `Generate C/C++ Project` | 生成桌面 C/C++ 工程 |
| `Generate OpenOCD Flash Script` | 只生成 `flash.py` |
| `Generate Cortex-Debug Configuration` | 只生成 `.vscode/launch.json` |
| `Import CMSIS Pack` | 导入本地 Pack（归档或已安装目录） |
| `Install Pack Online` | 按所选系列在线下载并导入 Pack |
| `Remove Imported CMSIS Pack` | 删除已导入的 Pack |
| `Install ARM CMSIS Core Pack` | 安装 `ARM.CMSIS` 内核头 |

## 设置

| 设置 | 说明 |
| --- | --- |
| `cmakeEmbedded.openocdPath` | OpenOCD 可执行文件路径（默认 `openocd`） |
| `cmakeEmbedded.jlinkPath` | J-Link 可执行文件路径 |
| `cmakeEmbedded.pyocdPath` | pyOCD 可执行文件路径 |
| `cmakeEmbedded.packMirror` | Pack 镜像目录，按 `<vendor>.<name>.<version>.pack` 提供 |

## 开发

```powershell
npm install
npm test
```

需要 Node.js 22+。修改代码后先 `npm run compile`（或 `npm test`）再按 `F5`；
启动配置不带 `preLaunchTask`，以免共享终端卡住让 F5 看起来没反应。

更多文档：[架构](docs/architecture.md) ·
[契约](docs/contracts.md) · [路线图](docs/roadmap.md)
