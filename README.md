# CMake-Embedded

一款用于 VS Code 的 CMake 工程生成插件，支持三个**互相独立**的方向：

- **MCU 固件**：裸机 STM32 / GD32 工程，生成链接脚本、GNU 启动文件、工具链和 CMake。
- **Linux / SoC 应用**：交叉编译工程，目标为龙芯 (loongarch64)、ARM (aarch64)、
  32 位 ARM (armv7 hard-float) 或 RISC-V (riscv64)。
- **桌面 C/C++**：使用本机编译器生成普通可执行文件、静态库或动态库。

三个方向都会扫描当前打开的工程目录，收集 C/C++ 源文件、头文件目录和宏，
然后生成可直接构建的 CMake 工程。

## 侧栏快速生成

安装插件后，VS Code 左侧活动栏会显示 **CMake-Embedded** 图标。打开工程目录，
点击该图标即可在侧栏中切换 **MCU 固件**、**Linux / SoC** 和
**桌面 C/C++**，选择目标后点击“生成工程”。

- 选择结果按工作区保存，下次打开自动恢复。
- 一个工作区包含多个工程时，“目标工程”会列出各工程目录；扫描与生成只处理当前选中的工程。
- 空目录仍可扫描，并提示没有 C/C++ 或汇编源文件；无工程标记但含源码的目录会自动作为目标工程。
- 工作区发现或源文件扫描较慢时，可点击“取消扫描”中止当前扫描。
- MCU 页面可单独生成 `flash.py` 或 Cortex-Debug 配置；「生成工程」只生成工程文件。
- 插件只生成 CMake 工程与配置，配置和编译由 CMake Tools 负责。
- 桌面 C/C++ 页面可选择可执行文件、静态库或动态库以及语言标准。
- 扫描工作区后可查看源文件、头文件目录和宏的数量。
- 原有命令面板入口全部保留，可继续单独生成烧录脚本或调试配置。

## 命令

| 命令 | 方向 | 说明 |
| --- | --- | --- |
| `CMake-Embedded: Generate MCU Project` | MCU | 按命令面板流程选择厂商、系列、Pack 与型号，再生成裸机工程 |
| `CMake-Embedded: Generate Linux Project` | Linux | 选择交叉工具链，再生成交叉编译工程 |
| `CMake-Embedded: Generate C/C++ Project` | 桌面 | 选择目标类型和语言标准，生成普通 CMake 工程 |
| `CMake-Embedded: Generate OpenOCD Flash Script` | MCU | 仅生成 `flash.py` |
| `CMake-Embedded: Generate Cortex-Debug Configuration` | MCU | 仅生成 `.vscode/launch.json` 调试配置 |
| `CMake-Embedded: Import CMSIS Pack` | MCU | 从本地归档、Keil 已安装目录或在线索引导入芯片 |
| `CMake-Embedded: Install Pack Online` | MCU | 按已选系列从 CMSIS 公开索引下载器件包并直接导入 |
| `CMake-Embedded: Remove Imported CMSIS Pack` | MCU | 删除已导入的 Pack 并立即刷新设备列表 |

## 配置与编译

插件只负责生成工程文件。配置、编译、烧录与调试分别交给 CMake Tools、Cortex-Debug
和 `flash.py`，插件自身不执行编译器或烧录器进程。

生成后使用 CMake Tools 选择生成的 `debug` 或 `release` 预设：

```powershell
cmake --preset debug      # 或 cmake --preset release
cmake --build --preset debug
```

需要安装 CMake 和 Ninja，并让它们可从 `PATH` 查找；CMake 的路径也可以通过
`cmake.cmakePath` 设置。MCU 工程还需要 **Arm GNU Toolchain**，其中包含
`arm-none-eabi-gcc`、`arm-none-eabi-g++`、`arm-none-eabi-objcopy` 和
`arm-none-eabi-size`。插件不保存工具链路径：生成的工具链文件只写这些
**可移植的命令名**，请把工具链 `bin` 目录加入 `PATH`，或在 CMake Tools 中
配置 kit。Keil 的 `armclang` 不能替代此 GNU 工具链。

生成的 Cortex-Debug 与 C/C++ IntelliSense 配置同样只使用 `arm-none-eabi`
前缀和编译数据库，不写入任何机器绝对路径。

Debug 和 Release 分别输出到 `build/debug` 和 `build/release`。
MCU 工程构建后生成 `.elf`、`.hex`、`.bin` 和 `.map`；只有烧录脚本或调试配置，
没有 `CMakeLists.txt` 和 `CMakePresets.json` 时，需要先生成完整工程。

Windows 下应避免过深的工程目录。若 CMake 同时提示 `CMAKE_OBJECT_PATH_MAX` 和
无法写入 `.su` 文件，说明 GNU 工具链输出路径超过了 Windows 路径限制；请缩短
工程目录路径后重新配置，或改用支持长路径的工具链（例如 STM32CubeCLT）。
重新安装同一工具链不能解决此类路径错误。

---

## 桌面 C/C++ 方向

### 功能

- 使用本机 GCC、Clang 或 MSVC 工具链，不生成交叉工具链文件。
- 自动扫描 C/C++/汇编源文件、头文件目录和宏。
- 支持可执行文件、静态库和动态库。
- 支持 C11/C17/C23 与 C++14/C++17/C++20/C++23。
- 生成 Debug、Release 的 Ninja 预设和编译数据库。
- 配置 CMake Tools 与 C/C++ IntelliSense。
- 保留 `CMAKE-EMBEDDED USER CODE` 区域，可自行添加依赖库。

### 使用

1. 打开普通 C/C++ 工程目录。
2. 在侧栏切换到 **桌面 C/C++**。
3. 选择目标类型和语言标准，点击“生成工程”。
4. 使用生成的预设配置并构建：

   ```powershell
   cmake --preset debug
   cmake --build --preset debug
   ```

### 生成后的目录结构

```text
<project>/
├── CMakeLists.txt
├── CMakePresets.json
├── .native-cmake.json
└── .vscode/
    ├── settings.json
    └── c_cpp_properties.json
```

---

## MCU 方向

### 功能

- 根据当前工程目录生成 `CMakeLists.txt`
- 生成 MCU 链接脚本和 GNU 汇编启动文件
- 在 `system/` 目录生成 C 运行时支持文件
- 生成适用于 Ninja 的 Debug 和 Release 配置及构建预设
- 配置 CMake Tools 使用生成的工程预设
- 使用 CMake 编译数据库配置 C/C++ 插件 IntelliSense
- 可选生成独立于 CMake 的 OpenOCD `flash.py` 烧录脚本
- 生成 Cortex-Debug 的 OpenOCD 调试配置
- 生成可执行、静态库或动态库目标后，`.elf`、`.hex`、`.bin` 与 `.map` 由 CMake Tools 编译产出
- 覆盖已有生成文件前进行确认

烧录脚本支持 J-Link OB、J-Link、ST-Link 和 DapLink。生成的芯片和
OpenOCD 烧录 target 独立选择，因此也可以给已有自定义 CMake 工程单独生成
烧录脚本。GD32 F1/F4 target 使用兼容的 STM32 F1/F4 OpenOCD target。

侧栏按 **厂商 → 系列 → 芯片支持包（Pack）→ 版本 → 型号** 的顺序选择。
系列用精选目录里的短名（STM32F1、STM32F4…），器件包自己的 `Dfamily` 文本
（`STM32F1 Series`）与之等价；切换系列不会被 Pack 改回去。
厂商列表内置 5 家最常用的 ARM Cortex-M 厂商/家族：STM32、GD32、NXP、nRF
（Nordic）、Microchip，已在本地安装/导入器件包的厂商排在前面。每个厂商都带
精选系列目录，例如 STM32 的 F0/F1/F2/F3/F4/F7/G0/G4/H7/L0/L1/L4/L5/U5/WB/WL/
C0/H5/U0/WBA，GD32 的 F1/F3/F4/E10/E23/E50/L23/W51，NXP 的
LPC55/LPC54/LPC17/LPC11/LPC8/i.MX RT/MCX/Kinetis，nRF51/52/53/54/91，
Microchip 的 SAM D21/D51/E70/C21/PIC32。其它厂商（TI、Renesas、Infineon、
WCH、MM32 等）不占用下拉列表，导入对应 `.pack` 后会按 PDSC 自动出现。
插件不内置芯片数据：所有芯片档案都来自 CMSIS Pack 解析；装好对应 Pack 后，
系列会按真实器件型号前缀（如 `STM32F1`、`GD32F1`、`LPC55`、`nRF52`、`ATSAMD21`）
把型号列出来，所以「系列 + Pack + 型号」始终自洽。
Pack 下拉只列出服务所选系列的器件包，所以「系列 + Pack + 型号」三格始终自洽：
选中的 Pack 一定列得出该系列型号。没有对应器件包时面板会禁用生成按钮并提示
缺哪个 DFP，装好 Pack 前不会生成必然失败的工程。

先选厂商与芯片系列，插件据此确定对应的器件包——本地已有则自动激活；
没有则提示获取途径：Keil Pack Installer、「导入 Pack 包…」（本地 `.pack`）
或「在线安装 Pack…」（CMSIS 公开在线索引，按已选系列的器件包/厂商过滤，
选定版本后插件内直接下载、导入并激活）。不含设备的组件包不会出现在列表中。

器件 Pack 只带厂商自己的器件头文件，而它们都会 `#include "core_cm*.h"` —— 这些
文件在 ARM 的 CMSIS 内核包里，不在 DFP 中。侧栏的「安装内核包…」或命令
`CMake-Embedded: Install ARM CMSIS Core Pack` 会从同一索引下载 `ARM.CMSIS`
（也可选本地 .pack），只解出 `CMSIS/Core/Include` 存入扩展存储。

生成 MCU 工程时**不再整包复制**，而是按所选器件的内核裁剪：

- `CMSIS/Include` 只放这个内核真正用到的头文件 —— Cortex-M4 就是 `core_cm4.h`、
  `cmsis_compiler.h`、`cmsis_gcc.h`、`cmsis_version.h` 和它 `#include` 到的
  `m-profile/*`，约 6 个文件；其它内核（`core_cm0.h`、`core_cm33.h`…）和
  armclang/clang/IAR 的编译器头都不会出现（工程固定用 arm-none-eabi-gcc）。
  CMSIS 4/5 的 `core_cmFunc.h`、`mpu_armv7.h` 等也按同样的 include 关系带进来。
- `CMSIS/Device/Include` 放所选系列自己的器件头文件和 `system_<stem>.h`
  （例如 `gd32f10x.h`、`system_gd32f10x.h`）；`CMSIS/Device/Source` 放对应的
  `system_<stem>.c`（提供 `SystemInit` 与时钟初始化）。这些文件在导入 Pack 时
  从 `Device/Include`、`Device/Source`（或 `devices/`、`Include/` 布局）快照，
  切换系列/换 Pack 重新生成时会自动替换旧文件。
  器件头强制 `#include` 的厂商 umbrella 头（如 `gd32f10x_libopt.h`）会一起复制，
  但 umbrella 列出的一整棵外设驱动库不进工程：只额外复制 `system_*.c` 真正用到
  的寄存器头（GD32 的 `gd32f10x_rcu.h`）。GD32 的 umbrella 还无条件
  `#include "RTE_Components.h"`，该文件由 Keil 的 RTE 生成、Pack 里没有，因此会
  生成一个空的 `RTE_Components.h`（只启用 RCU 组件）；要用外设驱动时把自己的驱动
  目录加进工程、在其中定义 `RTE_DEVICE_STDPERIPHERALS_*` 宏即可。
- `target_include_directories` 只写工程内相对路径，工程不指向扩展存储或原始
  Pack 安装目录，换台机器也能直接构建。

该行为由侧栏「生成内核包 include」开关控制（默认开，随选择持久化）：关掉后不复制
内核头、不写 include，适合自己提供 core 头文件的工程（器件头与 `system_*.c`
仍按所选 Pack 复制）。装了多个内核包版本时，目标配置面板会出现「CMSIS 内核包」
下拉，默认使用最新已安装版本。没装内核包时工程照常生成，但会提示缺失 —— 否则
编译必然在 `core_cm*.h` 处失败；启动文件里的 weak `SystemInit` 保证没带
`system_*.c` 时也能链接。

「在线安装 Pack…」对 STM32 与 GD32 都是插件内一步完成：STM32 系列下载
Keil 发布的 `STM32F1xx_DFP` 等器件包，GD32 系列下载 GigaDevice 自托管的
`GD32F10x_DFP`/`GD32F30x_DFP`/`GD32F4xx_DFP`。索引没有覆盖的厂商（如 CH32）
回退为在浏览器打开官方下载页，再点「导入 Pack 包…」。

下载过程中通知与侧栏状态都会显示进度（已下载/总大小与百分比）。下载通道
针对国内网络做了两处调整：

- Keil 托管的器件包不再经过 `www.keil.com` 的前置跳转，直接请求它 302 指向的
  CDN（`keilpack.azureedge.net`）；直连失败时自动退回索引里发布的原始地址。
  实测同一 48 MB 器件包，单连接几乎跑不完，改用 8 路分段下载后约 0.6–0.9 MB/s。
- 大包按范围分段并发下载，单段失败只重试该段；小包仍是一次请求。

如果本机有更快的镜像，可在设置里填 `CMake-Embedded: Pack Mirror`
（`cmakeEmbedded.packMirror`）指向一个扁平目录（按
`<vendor>.<name>.<version>.pack` 提供文件）。配置后镜像优先，失败再回退到
CDN 与索引地址。

选择已安装的 Pack 会就地解析并导入它的设备；选择可下载版本会下载、解析、
导入并切换到该版本。下载或解析失败不会改变当前有效的选择。Keil 安装
目录中的 Pack 身份以 PDSC 的厂商与包名为准，目录名不是最终身份。

也可以继续用 `Import CMSIS Pack` 显式导入本地 `.pack` 或删除已导入的 Pack；
删除后对应型号立即从侧栏移除，无需重启扩展。pyOCD 需要真实的 `.pack`
文件：普通归档导入会保存归档副本；解压目录若旁边没有 `.pack` 文件，
pyOCD 配置不会附带虚拟路径。

### 使用方法

1. 使用 VS Code 打开 MCU 工程目录。
2. 点击活动栏中的 **CMake-Embedded**，进入“生成配置”。
3. 依次选择厂商、Pack、版本、系列和型号，按需勾选烧录脚本或调试配置，然后点击“生成工程”。
5. 使用生成的预设配置并构建工程：

   ```powershell
   cmake --preset debug      # 或 cmake --preset release
   cmake --build --preset debug
   ```

选择后端与探针后，可单独点「生成 flash.py」或「生成 Debug 配置」。
烧录 target 覆盖 STM32
F0/F1/F2/F3/F4/F7/G0/G4/H7/L0/L1/L4/L5/U5/WB/WL 和 GD32
E23x/F1/F4/VF103 系列；其它厂商暂无内置 OpenOCD target 映射，生成时会提示，
需要按实际芯片修改 `launch.json` 的 `configFiles` / `flash.py` 的 target。
如果 OpenOCD 不在系统 `PATH` 中，可在 VS Code 设置里配置
`CMake-Embedded: Openocd Path`（`cmakeEmbedded.openocdPath`）。
生成的脚本会以该路径为默认值，也支持运行时覆盖：

```powershell
python flash.py
python flash.py --firmware build/my-project.elf
python flash.py --probe stlink
python flash.py --openocd D:\Tools\OpenOCD\bin\openocd.exe
python flash.py --dry-run
```

如果 Cortex-Debug 找不到 ARM GNU 工具链，请把工具链 `bin` 目录加入
`PATH`；生成的调试配置只写 `arm-none-eabi` 前缀，不保存机器路径。

点击「生成 Debug 配置」或同名命令后，插件会向
`.vscode/launch.json` 添加标准 OpenOCD 调试配置。已有其他配置会保留。
生成后按 `F5` 即可启动 Cortex-Debug。

### F5 启动后立刻退出怎么办

调试会话一秒内结束，几乎都是**调试器进程没能启动**，而不是程序跑飞。依次检查：

1. **Cortex-Debug 是否安装**：调试类型 `cortex-debug` 不存在时，VS Code 不会给出完整会话。
   生成调试配置时插件会检测并提示安装；也可以直接在扩展面板搜索 Cortex-Debug 安装。
2. **OpenOCD 是否可执行**：`cmakeEmbedded.openocdPath` 默认是 `openocd`，需要它在 `PATH`
   里；否则在设置里改成 `openocd.exe` 的完整路径。生成 Debug 配置时如果找不到，
   侧栏会直接给出这条警告。
3. **是否先构建过**：调试配置的 `executable` 取自 CMake Tools 的当前启动目标
   （`${command:cmake.launchTargetPath}`），没有构建产物或没有选中 `debug` 预设时会立即退出。
   先执行 `cmake --build --preset debug`，或在 CMake Tools 里选一次生成的预设。
4. **`arm-none-eabi-gdb` 是否可用**：Cortex-Debug 用 `arm-none-eabi-gdb` 连接，和编译用的
   Arm GNU Toolchain 在同一个 `bin` 目录里；若 VS Code 启动早于 `PATH` 修改，重启 VS Code 即可。

5. **是否选对了调试配置**：`launch.json` 里如果还留着其它扩展生成的配置（例如
   `C/C++ Runner: Debug Session`），按 F5 可能启动的是它。请在“运行和调试”下拉框里
   选中 `CMake-Embedded OpenOCD` 再按 F5。

打开「调试控制台（DEBUG CONSOLE）」能看到具体原因（例如 `spawn openocd ENOENT`、
`No launch target`、`can't find interface/stlink.cfg`），比弹窗信息详细。
OpenOCD 的输出在「终端 → gdb-server」标签里：出现
`Error: unable to find a matching CMSIS-DAP device` 说明调试探针选成了 DapLink，
但接的不是 CMSIS-DAP 调试器（或板子没连/没上电）——在侧栏「烧录与调试」里改成实际
的探针（ST-Link 等）后重新生成调试配置。

生成的调试配置使用 `${workspaceFolder}/build/debug/<工程名>.elf` 作为 `executable`
（预设固定把产物放在 `build/debug`），不依赖 CMake Tools 当前选中的启动目标；
侧栏没填 OpenOCD 路径时，会沿用设置里的 `cmakeEmbedded.openocdPath` 并写成
`serverpath`，因此 OpenOCD 不必在 `PATH` 里。

### 生成后的目录结构

```text
<project>/
├── CMakeLists.txt
├── CMakePresets.json
├── .mcu-cmake.json
├── .vscode/
│   ├── settings.json
│   ├── c_cpp_properties.json
│   └── launch.json             （可选 Cortex-Debug 调试配置）
├── <mcu>.ld
├── startup_<device>.S
├── CMSIS/
│   ├── Include/                （所选内核实际用到的 core 头文件）
│   └── Device/
│       ├── Include/            （器件头文件 + system_<stem>.h）
│       └── Source/             （system_<stem>.c）
├── flash.py                    （可选 OpenOCD 烧录脚本）
├── cmake/
│   └── <device>-toolchain.cmake
└── system/
    ├── syscalls.c
    └── sysmem.c
```

构建目录为 `build/debug` 和 `build/release`。固件输出、map 文件和内存使用
报告也会生成在该目录下。

启动文件在 `Reset_Handler` 里调用 `SystemInit`，并内置一个 **weak 默认实现**
（空函数，直接 `bx lr`）。因此即使工程里还没加入厂商的 `system_<device>.c`，
生成的工程也能直接链接通过（芯片运行在默认 HSI 时钟）。把你自己的
`system_stm32f10x.c`（或对应系列）加入工程后，其强定义会自动覆盖这个默认实现。
启动文件的弱默认符号带有 `.type ..., %function`：binutils 2.44 起，汇编里调用
未声明类型的符号会在链接时报
`Unknown destination type (ARM/Thumb)` / `dangerous relocation`，这条规则已经
在生成的文件里处理好了。

---

## Linux 方向

### 功能

- 根据当前工程目录生成 `CMakeLists.txt`
- 生成交叉编译工具链文件 `cmake/linux-toolchain.cmake`
- 生成 Debug 和 Release 两个 Ninja 配置及构建预设
- 可选生成 `CMAKE_SYSROOT`：在侧栏填目标 sysroot 后，工具链文件会写
  `CMAKE_SYSROOT` 与 `CMAKE_FIND_ROOT_PATH*`（留空则使用编译器默认搜索路径）
- 生成 `.linux-cmake.json`，记录所选工具链、sysroot 和工程结构
- 配置 CMake Tools 和 C/C++ IntelliSense
- 覆盖已有生成文件前进行确认

工具链文件只写**编译器命令名**（例如 `loongarch64-linux-gnu-gcc`），
不写绝对路径，因此同一工程可以在不同机器上使用。

### 支持的交叉工具链

| 名称 | 前缀 | `CMAKE_SYSTEM_PROCESSOR` |
| --- | --- | --- |
| 龙芯 (loongarch64) | `loongarch64-linux-gnu-` | `loongarch64` |
| ARM (aarch64) | `aarch64-linux-gnu-` | `aarch64` |
| ARM 32 位 (armv7 hard-float) | `arm-linux-gnueabihf-` | `arm` |
| RISC-V (riscv64) | `riscv64-linux-gnu-` | `riscv64` |

### 工具链查找

插件不保存交叉工具链路径，只从环境变量查找：

1. `CROSS_COMPILE`，例如 `export CROSS_COMPILE=loongarch64-linux-gnu-`
2. `CC` / `CXX`
3. `PATH` 中匹配上述前缀的 `gcc` + `g++`

侧栏始终列出四个工具链系列。已找到的工具链会显示来源和目录；未找到的
工具链也可以生成工程，只需在构建前把对应 `bin` 目录加入 `PATH`。

### 使用方法

1. 使用 VS Code 打开**一个工程根目录**。
2. 在 CMake-Embedded 侧栏切换到 **Linux / SoC**。
3. 选择交叉工具链；如果目标系统的头文件/库不在编译器默认位置，填上
   「目标 sysroot（可选）」（例如 `/opt/loongarch64-sysroot`），留空即可。
4. 点击“生成工程”。sysroot 随选择持久化，也会写入 `.linux-cmake.json`，
   下次重新生成/命令面板都会沿用。
5. 使用生成的预设配置并构建工程：

   ```bash
   cmake --preset debug      # 或 cmake --preset release
   cmake --build --preset debug
   ```

### 生成后的目录结构

```text
<project>/
├── CMakeLists.txt
├── CMakePresets.json
├── .linux-cmake.json
├── .vscode/
│   ├── settings.json
│   └── c_cpp_properties.json
└── cmake/
    └── linux-toolchain.cmake
```

构建目录为 `build/debug` 和 `build/release`。已有 `CMakeLists.txt` 中
`# CMAKE-EMBEDDED USER CODE BEGIN` 和 `END` 之间的内容会在重新生成时保留。

---

## 环境要求

- VS Code 1.85 或更高版本
- CMake Tools 插件
- C/C++ 插件
- Cortex-Debug 插件（调试用；生成调试配置时会检测，未安装会提示安装）
- OpenOCD（调试与 `flash.py` 烧录都需要；需在 `PATH` 中，或在设置里填绝对路径）
- CMake 3.22 或更高版本
- Ninja
- Node.js 22 或更高版本（`npm test` 使用 Node 内置测试运行器）

- **MCU**：Arm GNU Toolchain，并确保 `arm-none-eabi-gcc`、`arm-none-eabi-g++`、
  `arm-none-eabi-objcopy` 和 `arm-none-eabi-size` 位于 `PATH` 中。
- **Linux**：交叉工具链，并确保对应前缀的 `gcc`、`g++` 位于 `PATH` 中。

## 开发

```powershell
npm install
npm test
```

在 VS Code 中按 `F5` 启动扩展开发主机，打开工程后点击活动栏图标，
即可打开侧栏。修改代码后先执行 `npm run compile`（或 `npm test`）再按 `F5`：
启动配置不再带 `preLaunchTask`，避免共享终端停在「终端将被任务重用，按任意键关闭」
而让 F5 看起来毫无反应。

扩展开发主机默认**保留**已安装的其他扩展（只禁用发布版 CMake-Embedded 本身），
因为生成工程后的构建/调试依赖 CMake Tools 与 Cortex-Debug。如果启动参数里加了
`--disable-extensions`，这两者也会被禁用，在那种窗口里对生成工程按 `F5` 会立刻
退出、`${command:cmake.launchTargetPath}` 也取不到目标 —— 要调试固件请用普通
窗口，或去掉该参数。

如果在 WSL 中调试 Linux 方向，先在本插件工程的 WSL 窗口按 `F5`，
这样扩展宿主才能读取 WSL 的 `PATH`。

## 项目状态

当前仓库仍是早期插件原型。芯片配置和代码模板保持较小，后续会逐步增加
更多 MCU 系列支持。
