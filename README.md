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

MCU 与桌面方向在侧栏都有「编译链」下拉，选项来自 `PATH` 扫描（不执行编译器进程）：

- MCU：识别 `arm-none-eabi-gcc`、`arm-zephyr-eabi-gcc` 等裸机 ARM GCC；选中后
  编译器前缀写入工具链文件、C/C++ IntelliSense 与调试配置。
- 桌面：识别 `gcc`、`clang` 与 Windows MinGW 前缀；选中后写入 CMakeLists 的
  `CMAKE_C_COMPILER` / `CMAKE_CXX_COMPILER`。
- 默认「自动」保持原行为：MCU 用器件档案的默认前缀，桌面交给 CMake 检测。
  选择按工作区保存，生成工程时复用。

## MCU 固件

- 芯片数据**全部来自 CMSIS Pack**，插件不内置芯片档案：
  内置 STM32、GD32、NXP、nRF、Microchip 五家精选系列，其它厂商
  「导入 Pack 包…」后自动出现在列表里。
- Pack 来源：本地 `.pack`、Keil 已安装目录、CMSIS 在线索引（「在线安装 Pack…」）；
  缺 `core_cm*.h` 时用「安装内核包…」装 `ARM.CMSIS`。
- 按所选内核裁剪 CMSIS 头，只复制器件头、`system_<stem>.h/.c` 与必需寄存器头，
  不整包复制外设驱动库（驱动由工程自己加）。
- 附带链接脚本、GNU 启动文件、工具链文件、可选 `flash.py`（J-Link / ST-Link /
  DapLink）与可直接 F5 的 Cortex-Debug 配置。

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
MCU 另需 Cortex-Debug、OpenOCD 与 Arm GNU Toolchain（`arm-none-eabi-gcc` 等）；
Linux 另需对应前缀的 `gcc`/`g++`。

## 开发

```powershell
npm install
npm test          # Node.js 22+
npm run vsix      # 打包扩展
```

修改后先 `npm run compile` 再按 F5。`fast-xml-parser` 是运行时依赖，打包时不要加
`--no-dependencies`，否则扩展能装但激活失败。

更多：[架构](docs/architecture.md) · [契约](docs/contracts.md) · [路线图](docs/roadmap.md)
