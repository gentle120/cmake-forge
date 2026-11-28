# CMake Forge

在 VS Code 里生成**可直接构建**的 CMake 工程：ARM Cortex-M 固件、Linux/SoC 交叉编译、桌面 C/C++。芯片数据来自 CMSIS Pack，生成后交给 CMake Tools 与 Cortex-Debug 构建、调试，烧录在侧栏一键完成。

## 功能

- **向导式 MCU 工程**：侧栏按 厂商 → 系列 → Pack → 版本 → 型号 选择，生成 `CMakeLists.txt`、`CMakePresets.json`、工具链文件、链接脚本/分散加载、启动文件与 `syscalls`；CMSIS 头按内核裁剪后复制进工程。
- **芯片数据来自 Pack**：支持本地 `.pack`、Keil 安装目录与 CMSIS 在线索引；未收录厂商导入后自动注册，无需手写芯片档案。
- **一键烧录**：检测探针读取 CPUID 与 DBGMCU ID，自动匹配内核、系列与烧录 target；OpenOCD 后端直接调用 `openocd`，J-Link/pyOCD 后端使用生成的 `flash.py`，带阶段进度、输出与失败诊断。
- **Cortex-Debug 配置**：生成 launch/attach 两条配置，可带 SVD、`preLaunchTask` 与工具链前缀。
- **装完即可用**：编译链只保留 GNU Arm GCC；缺 ARM GCC 或 OpenOCD 时，通知栏一次列出并一键下载（可取消、带进度），装完自动写设置；CMake 与 Ninja 需自行安装。pyOCD 通过 pip 安装，J-Link 跳转 SEGGER 下载页。
- **三种目标**：MCU 固件、Linux/SoC（loongarch64、aarch64、armv7hf、riscv64）、桌面 C/C++（编译器由 CMake Tools Kit 选择）。

## 安装

扩展市场搜索 **CMake Forge**，或安装 `cmake-forge-1.0.2.vsix`：

```powershell
code --install-extension cmake-forge-1.0.2.vsix
```

扩展把 `ms-vscode.cmake-tools` 与 `marus25.cortex-debug` 声明为扩展依赖，VS Code 会一并安装；离线环境需手动补装这两个 VSIX。

## 快速开始（MCU）

1. 活动栏打开 **CMake Forge**，选择厂商、系列、Pack、版本与型号。
2. 点「生成工程」，选择工程根目录。
3. 命令行构建：

```powershell
cmake --preset debug
cmake --build --preset debug
```

4. 侧栏点「检测探针」→「烧录」；需要调试时点「仅 Debug」生成 Cortex-Debug 配置后按 F5。

## 环境要求

- VS Code 1.85+
- CMake ≥ 3.22、Ninja、GNU Arm GCC（`arm-none-eabi-*`）
- CMake Tools、Cortex-Debug（扩展依赖，自动安装）
- 首次运行可在侧栏一键下载 ARM GNU 工具链与 OpenOCD（仅 Windows，安装到用户数据目录）
- 调试需要 `arm-none-eabi-gdb`；Linux 方向需要对应前缀的 `gcc`/`g++`
- 烧录需要 OpenOCD、J-Link 或 pyOCD 之一，以及对应探针驱动

工具缺失时通知栏会给出下载入口，也支持在设置里填写自定义路径。

导入的 Pack 与下载的工具存放在用户数据目录（Windows `%APPDATA%\cmake-forge`，其他平台 `$XDG_DATA_HOME/cmake-forge`）。旧版本放在扩展全局存储里的内容会在首次启动时自动迁移。

**F5 立即退出**：确认已安装 Cortex-Debug、`arm-none-eabi-gdb` 在 `PATH`、已构建 `debug` 预设，并在调试下拉中选择 `CMake Forge OpenOCD`。

## 设置

| 设置 | 说明 |
| --- | --- |
| `cmakeForge.armGccPath` | GNU Arm GCC 的 `bin` 目录或 `gcc` 路径；空值使用 `PATH` |
| `cmakeForge.openocdPath` | `openocd` 可执行文件路径；空值使用 `PATH` |
| `cmakeForge.jlinkPath` | `JLink.exe` 路径；空值使用 `PATH` |
| `cmakeForge.pyocdPath` | `pyocd` 可执行文件路径；空值使用 `PATH` |
| `cmakeForge.pythonPath` | 安装 pyOCD 使用的 Python；空值 `python`（Windows）/`python3` |
| `cmakeForge.debugPreLaunchTask` | 生成调试配置时的 `preLaunchTask`，默认 `CMake: build`，空串不写 |
| `cmakeForge.packMirror` | Pack 下载镜像的扁平目录地址，如 `https://example.com/packs/` |

路径设置允许首尾空白、资源管理器「复制为路径」带出的引号、`%VAR%` 与开头的 `~`。

## 命令

`CMake Forge: Generate MCU Project`、`Generate Linux Project`、`Generate C++ Project`、`Generate OpenOCD Flash Script`、`Generate Cortex-Debug Configuration`、`Import CMSIS Pack`、`Install Pack Online`、`Remove Imported CMSIS Pack`、`Install ARM CMSIS Core Pack`。

## 开发

```powershell
npm install
npm run compile   # 清空 out 并编译
npm test          # node --test，需 Node.js 22+
npm run vsix      # 打包扩展
```

`fast-xml-parser` 是运行时依赖，打包时不要加 `--no-dependencies`。修改后先 `npm run compile` 再按 F5 调试扩展。

## 文档

[架构](docs/architecture.md) · [契约](docs/contracts.md) · [路线图](docs/roadmap.md) · [变更记录](CHANGELOG.md) · [设计备注](docs/design-notes.md)

## 许可证

[MIT](LICENSE)
