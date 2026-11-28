# CMake Forge

在 VS Code 里生成可直接构建的 CMake 工程，覆盖 ARM Cortex-M 固件、Linux/SoC 交叉编译与桌面 C/C++。芯片数据来自 CMSIS Pack，构建交给 CMake Tools，调试交给 Cortex-Debug，烧录在侧栏完成。

## 功能

- **MCU 工程生成**：按 厂商 → 系列 → Pack → 版本 → 型号 选择，生成 CMakeLists、CMakePresets、工具链文件、链接脚本、启动文件与 syscalls，并按内核裁剪 CMSIS 头。
- **芯片数据来自 Pack**：支持本地 `.pack`、Keil 安装目录与在线索引；未收录厂商导入后自动注册。
- **探针检测与烧录**：读取 CPUID / DBGMCU ID 自动匹配内核、系列与烧录目标；OpenOCD 直连，J-Link / pyOCD 走 `flash.py`，带阶段进度、输出与失败诊断。
- **调试配置**：生成 launch / attach 两条 Cortex-Debug 配置，可选 SVD 与 `preLaunchTask`。
- **环境自检**：编译链只保留 GNU Arm GCC；缺 ARM GCC 或 OpenOCD 时通知栏一键下载（可取消、带进度）。CMake 与 Ninja 需自行安装。

## 安装

扩展市场搜索 **CMake Forge**，或：

```powershell
code --install-extension cmake-forge-1.0.3.vsix
```

`ms-vscode.cmake-tools` 与 `marus25.cortex-debug` 是扩展依赖，随扩展自动安装；离线环境需手动补装。

## 快速开始

1. 活动栏打开 **CMake Forge**，选择厂商、系列、Pack、版本与型号，点「生成工程」。
2. 构建：

```powershell
cmake --preset debug
cmake --build --preset debug
```

3. 侧栏点「检测探针」，再点「烧录」；调试则点「仅 Debug」生成配置后按 F5。

## 环境要求

- VS Code 1.85+，CMake ≥ 3.22 与 Ninja，GNU Arm GCC（`arm-none-eabi-*`）
- 烧录需要 OpenOCD、J-Link 或 pyOCD 之一及对应探针驱动；调试需要 `arm-none-eabi-gdb`
- Linux 方向需要对应前缀的 `gcc` / `g++`
- 首次运行可在侧栏下载 ARM GNU 工具链与 OpenOCD（仅 Windows）

导入的 Pack 与下载的工具存放在用户数据目录（Windows `%APPDATA%\cmake-forge`，其他平台 `$XDG_DATA_HOME/cmake-forge`），旧版本内容会在首次启动时迁移。

## 设置

| 设置 | 说明 |
| --- | --- |
| `cmakeForge.armGccPath` | GNU Arm GCC 的 `bin` 目录或 `gcc` 路径；空值使用 `PATH` |
| `cmakeForge.openocdPath` | `openocd` 可执行文件路径；空值使用 `PATH` |
| `cmakeForge.jlinkPath` | `JLink.exe` 路径；空值使用 `PATH` |
| `cmakeForge.pyocdPath` | `pyocd` 可执行文件路径；空值使用 `PATH` |
| `cmakeForge.pythonPath` | 安装 pyOCD 使用的 Python；空值 `python`（Windows）/ `python3` |
| `cmakeForge.debugPreLaunchTask` | 生成调试配置时的 `preLaunchTask`，默认 `CMake: build`，空串不写 |
| `cmakeForge.packMirror` | Pack 下载镜像的扁平目录地址 |

路径设置允许首尾空白、资源管理器「复制为路径」带出的引号、`%VAR%` 与开头的 `~`。

## 开发

```powershell
npm install
npm run compile   # 清空 out 并编译
npm test          # Node.js 22+
npm run vsix      # 打包扩展
```

`fast-xml-parser` 是运行时依赖，打包时不要加 `--no-dependencies`。

## 文档

[架构](docs/architecture.md) · [契约](docs/contracts.md) · [路线图](docs/roadmap.md) · [变更记录](CHANGELOG.md) · [设计备注](docs/design-notes.md)

## 许可证

[MIT](LICENSE)
