# Architecture

## Purpose

VS Code 扩展：为桌面 C/C++、MCU 固件、Linux/SoC 交叉编译生成可直接构建的 CMake 工程。芯片知识全部来自 CMSIS Pack，生成器由档案（`DeviceProfile`）驱动。

## System Context

- 用户在侧栏或命令面板选择方向与芯片；扩展读写工作区文件并生成 `.vscode/` 配置。
- 配置与编译由 CMake Tools 负责，调试由 Cortex-Debug 负责，两者是扩展依赖；烧录依赖 `PATH` 或设置里的 OpenOCD、J-Link、pyOCD。
- 信任边界：生成文件落盘前有覆盖确认；烧录只在用户显式操作时执行（OpenOCD 直接 spawn，J-Link/pyOCD 走生成的 `flash.py`）；Pack 导入只读 zip 内容并复制到用户数据目录（`%APPDATA%\cmake-forge`，首次启动从 `globalStorage` 迁移）。

## Components

| 目录 | 职责 | 不得拥有 |
| --- | --- | --- |
| `src/devices/` | DeviceProfile 注册表、厂商元数据、校验、导入记录持久化 | UI、烧录细节 |
| `src/packs/` | zip 读取、PDSC/SVD 解析、Pack 身份、在线索引、下载 | 档案注册 |
| `src/env/` | Keil 目录发现、工具链与烧录工具扫描（只读 PATH，不执行进程）、GNU Arm GCC 与 OpenOCD 下载/解压/校验 | 设置写入策略、身份解析 |
| `src/generator/` | 纯字符串生成：CMake、工具链、链接脚本、启动文件、`flash.py`、调试配置 | 文件系统、UI |
| `src/generation/` | 生成工作流编排、覆盖确认、旧文件清理 | 芯片数据、编译/烧录执行 |
| `src/integration/` | 宿主接线：IntelliSense 配置、工作区设置写入 | 生成逻辑、芯片数据 |
| `src/flash/` | 探针与 target 注册表、固件发现、OpenOCD 直连参数与芯片标识解析、失败诊断 | 编译执行、芯片数据 |
| `src/scanner/` | 工作区源码/头文件/宏扫描 | — |
| `src/sidebar/` + `src/extension.ts` | 命令、QuickPick、Webview 交互与状态持久化 | 生成逻辑 |
| `src/linux/`、`src/native/` | Linux 交叉与桌面方向；桌面编译器交给 CMake Tools | MCU 芯片数据 |

## Dependency Direction

`sidebar/extension → generation → generator/scanner/integration → devices/flash/packs/env → shared`。插件没有构建路径：生成结束后由 CMake Tools 读取 `CMakeLists.txt`、预设与工具链文件完成配置与编译。生成器与解析器不依赖 `vscode`，宿主交互集中在 `sidebar/` 与 `extension.ts`。

## Data And Control Flow

**MCU 生成**：目录加载（vendor → series → pack → version）→ 激活版本并按所有权取档案 → `getDeviceProfileForPack` → `generateMcuWorkflow` 写 CMakeLists、工具链、链接脚本、启动文件、预设、`flash.py` 与调试配置 → 覆盖确认 → 写盘 → 复制 CMSIS/器件头 → 删除本次未产出的旧文件 → 失效旧构建缓存。

**Pack 导入**：zip 或目录 → PDSC/SVD → DeviceProfile 合成 → 快照器件支持文件 → 用户数据目录持久化 → 注入注册表。注册表无内置数据，档案全部由 Pack 注入。

**烧录**：侧栏只读扫描 `build/debug`、`build/release` 的 ELF，无产物时回退工作区最新 ELF（或手选）→「检测探针」用当前 target cfg 依次试探针，`init` 后读 CPUID 与两个 DBGMCU IDCODE 窗口 → 解析「Cortex-Mx · STM32Fxx · DEV_ID」，把探测成功的接口写成当前探针、按 DEV_ID 表推导 target，并把芯片信息写进「烧录输出」→「烧录」→ OpenOCD 后端拼 `program … verify reset exit` 并 spawn `openocd`，J-Link/pyOCD 拼 `flash.py` 参数 → 解析阶段行回灌进度，失败经 `flashDiagnostics` 映射为提示。

**工具链**：MCU 只提供 GNU Arm GCC。`armGccPath` 为空时生成文件写 `arm-none-eabi-*` 命令名；设置为 bin 目录时合成已检测条目并写绝对路径。缺失时 `toolDownloads` 取官方 zip（GCC 15.2.1、OpenOCD 0.12.0-7），解压到用户数据目录 `tools/<tool>-<version>/`，校验可执行文件后写设置并失效缓存。

## Constraints

- 错误显式：未知 part/target/probe/backend 抛 `Unsupported …`，不静默回退。
- 兼容：`architecture` 仅 `'arm'`；生成文件名全部来自档案字段。
- 性能：注册表启动期构建并校验；Pack 在导入时解析一次并持久化。
- 信息卫生：生成内容不含会话性文字，路径使用工程内相对路径或可移植命令名。

## Verification

- 自动回归：`npm test`（`node --test`；真实固件编译用例由 `CMAKE_EMBEDDED_SKIP_FIRMWARE_BUILDS=1` 门控，CI 置位）。
- 操作面：扩展宿主侧栏生成流、生成产物的 cmake + ninja 真实构建、`flash.py` 语法检查、真实探针上的检测与烧录。
