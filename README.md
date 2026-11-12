# CMake Forge

VS Code 插件：为 **MCU 固件**、**Linux / SoC 交叉编译**、**桌面 C/C++** 三个方向
生成可直接构建的 CMake 工程。插件只生成文件，编译/烧录/调试交给 CMake Tools、
Cortex-Debug 与生成的 `flash.py`。

## 快速开始

活动栏点击 **CMake Forge** → 侧栏选方向与目标 → 「生成工程」，然后：

```powershell
cmake --preset debug            # 或 release
cmake --build --preset debug
```

## 编译链选择

侧栏的「编译链」下拉固定提供三种 MCU 编译链，扫描只用于默认值和状态提示
（不执行编译器进程）：

- **Arm GNU Toolchain (armgcc)**：生成 GNU 工具链、`.ld` 链接脚本、GNU 启动文件；
- **Arm Compiler 6 (armclang / Keil)**：生成 armclang 工具链、`.sct` 分散加载文件、
  armclang 启动文件与 `fromelf` 产物转换；
- **LLVM clang (arm-none-eabi)**：生成 clang 工具链、`.ld` 链接脚本，使用 LLD 和
  `-nostdlib`（裸机无 C 运行时），启动文件为不调用 newlib 的 GNU 变体。

扫描 `PATH`、Keil、STM32CubeCLT、Program Files、LLVM 目录及工具链环境变量后，
已检测到的家族显示真实路径并作为默认；未检测到的家族仍可选择，生成结果只写
命令名（如 `armclang`/`clang`），之后把编译器加入 `PATH` 即可构建。
- 桌面：**不提供编译链选择**，编译器完全交给 CMake Tools 的 Kit（或 CMake 自身）
  环境扫描决定；生成的 CMakeLists 不写 `CMAKE_C_COMPILER` /
  `CMAKE_CXX_COMPILER`，并关闭 CMake Tools 的预设模式（`useCMakePresets: never`），
  这样状态栏可以选择/切换编译器 Kit。工程不绑定任何机器路径，拷到别的电脑也能构建。
- 选择按工作区保存，生成工程时复用。armclang 工程的调试仍由 Cortex-Debug
  调用 `arm-none-eabi-gdb`，需要本机同时有 Arm GNU Toolchain 的 gdb。

**兼容性说明**

- 检测位置：`PATH`；Keil MDK 的 `ARM/ARMCLANG/bin`（含 `Keil_v5`、`Keil` 及
  自定义目录）；独立安装的 Arm Compiler；`Program Files` 下的 Arm GNU
  Toolchain 与 LLVM；STM32CubeCLT；PlatformIO/xPack 解压目录；以及**所有
  环境变量**中出现的绝对路径（不限变量名，`PATH` 也在内）。
- 编译器版本：armgcc 使用标准 GNU 工具链；armclang 需要 Arm Compiler 6
  （本仓库用 AC6.24 + CMake 4.2 验证，GCC 用 arm-none-eabi 15.3 验证，LLVM
  用 clang 22 + lld 验证）。LLVM 方案需要 `lld`（`-fuse-ld=lld`）且不链接
  C 运行时；CMake 需 ≥ 3.22。
- armclang 使用 Arm C 库而不是 newlib：不生成 `syscalls.c`/`sysmem.c`；
  使用 `printf`/文件 IO 时需要自行添加 retarget（semihosting 或串口）。
- 分散加载文件只描述主 Flash/主 RAM；`additionalMemory`（CCM、备份 RAM 等）
  不会单独放置，需要时自行补充 `.sct` 区域。
- Windows 下会扫描 C:–Z: 的 Keil/Program Files 常见目录；macOS/Linux 以
  `PATH`、`/opt`、`/usr/local` 为主。

## MCU 固件

- 芯片数据**全部来自 CMSIS Pack**，插件不内置芯片档案：
  内置 STM32、GD32、NXP、nRF、Microchip 五家精选系列，其它厂商
  「导入 Pack 包…」后自动出现在列表里。
- Pack 来源：本地 `.pack`、Keil 已安装目录、CMSIS 在线索引（「在线安装 Pack…」）；
  缺 `core_cm*.h` 时用「安装内核包…」装 `ARM.CMSIS`。
- 按所选内核裁剪 CMSIS 头，只复制器件头、`system_<stem>.h/.c` 与必需寄存器头，
  不整包复制外设驱动库（驱动由工程自己加）。
- 按所选编译链生成对应代码：armgcc 用 `.ld` 链接脚本 + GNU 启动文件；
  armclang 用 `.sct` 分散加载文件 + armclang 启动文件与 `fromelf` 产物转换。
  另附可选 `flash.py`（J-Link / ST-Link / DapLink）与可 F5 的 Cortex-Debug 配置。

**F5 立刻退出** 通常是调试器进程没启动：确认已装 Cortex-Debug、`cmakeForge.openocdPath`
可执行、先构建过 `debug` 预设、`arm-none-eabi-gdb` 在 `PATH` 中，并在调试下拉里
选中 `CMake Forge OpenOCD`。细节看「调试控制台」与「终端 → gdb-server」。

## Linux / SoC

| 目标 | 工具链前缀 |
| --- | --- |
| loongarch64 | `loongarch64-linux-gnu-` |
| aarch64 | `aarch64-linux-gnu-` |
| armv7hf | `arm-linux-gnueabihf-` |
| riscv64 | `riscv64-linux-gnu-` |

工具链按 `CROSS_COMPILE` → `CC`/`CXX` → `PATH` 查找，只写命令名不写绝对路径；
目标 sysroot 可选，填写后写入工具链文件的 `CMAKE_SYSROOT`。

## 命令与设置

命令：`Generate MCU / Linux / C++ Project`、`Generate OpenOCD Flash Script`、
`Generate Cortex-Debug Configuration`、`Import CMSIS Pack`、`Install Pack Online`、
`Remove Imported CMSIS Pack`、`Install ARM CMSIS Core Pack`。

设置：`cmakeForge.openocdPath`、`jlinkPath`、`pyocdPath`、`packMirror`。

## 环境要求

VS Code 1.85+、CMake Tools、C/C++、CMake ≥ 3.22、Ninja。
MCU 另需 Cortex-Debug、OpenOCD，以及 Arm GNU Toolchain（`arm-none-eabi-gcc`）或
Keil MDK 的 Arm Compiler 6（`armclang`）之一；Linux 另需对应前缀的 `gcc`/`g++`。

## 开发

```powershell
npm install
npm test          # Node.js 22+
npm run vsix      # 打包扩展
```

修改后先 `npm run compile` 再按 F5。`fast-xml-parser` 是运行时依赖，打包时不要加
`--no-dependencies`，否则扩展能装但激活失败。

更多：[架构](docs/architecture.md) · [契约](docs/contracts.md) · [路线图](docs/roadmap.md)
