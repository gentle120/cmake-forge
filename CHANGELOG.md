# Changelog

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
