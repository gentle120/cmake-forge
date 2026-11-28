# Changelog

## 1.1.0 (2026-11-28)

- 取消烧录或安装后，若进程不响应 kill 也会在宽限期后结束操作，侧栏不再永久停在忙碌状态；输出只保留末尾若干行。
- 覆盖确认把「重写」与「删除旧生成文件」分开列出，不再把删除计成覆盖。
- 固件路径按 Tcl 规则转义，含 `$`、`[`、`]` 的路径不会被 OpenOCD 当成命令替换。
- OpenOCD 目标配置与芯片不匹配时，按常见 STM32 脚本逐个试探后再判定检测失败。
- 取消或失败的安装不再抑制下一次缺失提示；安装进行中重复触发会被忽略。
- 修复下载超时只在首个数据块生效的问题：传输中途停滞会正确超时，取消也立即生效。
- `.vscode/c_cpp_properties.json` 与 `launch.json` 按 JSONC 解析，带注释或尾逗号不再中断生成。
- 解析 Pack 启动文件时跳过 `__initial_sp`、接受不带冒号的 `__Vectors` 标签，向量表不再整体错位。
- 同一 Pack 内有多个 SVD 时优先选与器件同名的文件，避免拿到别的型号的中断表。
- clang 目标三元组先判断 Armv8-M/Armv8.1-M，`cortex-m33` 不再被 `m3` 误匹配。
- 生成 CMake 工程时排除厂商的 `startup*.c`，避免与生成的启动文件重复定义 `Reset_Handler`。
- Windows 下扫描与工程发现忽略目录改为大小写不敏感（`Build`、`Objects` 等不再被扫描）。
- 切换工程时清空手动选择的固件；`packs.json` 迁移改为最后写标记，迁移失败可重试。
- 侧栏忙碌时仍可选择固件文件；提示 OpenOCD 下载时只在它被选为后端的情况下弹出。
- 修复 CMakeCache 中相对工具链路径按错误目录解析导致的缓存误删。
- 生成 CMake 工具链文件时把编译器/工具路径中的反斜杠归一为 `/` 并加引号，Windows 绝对路径不再让 configure 报 `Invalid character escape '\U'`。
- 工具安装把缺失项合并为一条通知；下载分片改为流式写入并校验字节数，代理中途断开会重试而不是留下损坏的包。

## 1.0.2

- 侧栏一键检测探针：读 CPUID 与 DBGMCU IDCODE，显示内核/系列/DEV_ID，自动选中探针接口并按 DEV_ID 切换烧录 target。
- 一键烧录：OpenOCD 后端直接调用 `openocd`（不经过 `flash.py`），带阶段进度、输出与失败诊断；J-Link/pyOCD 后端继续使用 `flash.py`。
- 固件来源按「手选 > `build/<preset>` 最新 ELF > 工作区最新 ELF」解析；Cortex-Debug 生成 launch/attach 两条配置，可带 SVD 与 `preLaunchTask`。
- MCU 编译链只保留 GNU Arm GCC；缺少工具链、OpenOCD、J-Link 或 pyOCD 时，通知栏提供下载入口、可取消进度与路径写回。
- 工具下载走 GitHub 代理并回退官方地址，支持分段并发与超时兜底；解压在缺少 `tar` 时回退 PowerShell。
- `marus25.cortex-debug` 声明为扩展依赖，随扩展安装。
- 工具路径支持引号、`%VAR%` 与 `~` 展开；Pack 导入、生成、烧录的失败提示统一为可执行建议。

## 1.0.1

- MCU 编译链固定 armgcc / armclang / LLVM clang，扫描只决定默认项与「已检测/未检测」提示。
- clang 目标三元组按内核生成；ATfE 使用 picolibc，STARM 按 CubeMX 风格生成，独立 LLVM 使用 `-nostdlib`。
- 生成时清理与本次编译链不一致的 `CMakeCache.txt` 与 `CMakeFiles`。
- 桌面方向改用 CMake Tools Kit 选择编译器，C/C++ 扩展改为推荐安装。
- 修复含空格路径、armclang/LLVM C++、clang 静态构造函数等构建问题。

## 1.0.0

- 首个公开版本：MCU、Linux/SoC、桌面三个方向均可生成可直接构建的 CMake 工程。
- MCU 数据全部来自 CMSIS Pack，支持导入、Keil 目录与在线索引；内核头按内核裁剪复制。
- 侧栏五级选择（vendor → series → pack → version → part），生成文件以树形展示。
- 修复 Pack 快照路径穿越、ZIP 压缩炸弹、含空格路径引用与切链缓存残留等稳定性问题。
