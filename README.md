# CMake Forge

VS Code 插件：为 **MCU 固件**、**Linux / SoC 交叉编译**、**桌面 C/C++** 生成可直接构建的
CMake 工程。插件生成文件，构建与调试交给 CMake Tools、Cortex-Debug；烧录在侧栏一键完成：
OpenOCD 后端直接调用 `openocd`（不经过 `flash.py`），J-Link / pyOCD 后端使用生成的
`flash.py`。

## 快速开始

活动栏打开 **CMake Forge** → 侧栏选择方向与目标 → 「生成工程」：

```powershell
cmake --preset debug
cmake --build --preset debug
```

## MCU 固件

- 芯片数据全部来自 CMSIS Pack：内置 STM32、GD32、NXP、nRF、Microchip 系列，其它厂商
  可导入本地 `.pack`、Keil 已安装目录或在线安装；缺少 `core_cm*.h` 时安装 `ARM.CMSIS`。
- 生成时按内核裁剪 CMSIS 头，只复制器件头、`system_*.c` 与必需寄存器头。
- 编译链固定三种，扫描只决定默认项和“已检测/未检测”提示，未检测到也可选择：
  - **armgcc**：GNU 工具链 + `.ld` + GNU 启动文件；
  - **armclang**（Keil / Arm Compiler 6）：armclang + `.sct` + fromelf；
  - **clang**：按可用性优先选择 **Arm Toolchain for Embedded (ATfE)**（ARM 官方
    通用嵌入式 LLVM，带 picolibc）→ **STARM clang**（STM32CubeIDE/CubeMX，
    `starm-clang.cmake`）→ 独立 LLVM clang（LLD + `-nostdlib`）。
- ATfE/STARM 自带 picolibc；独立 LLVM clang 需要 `lld` 且不提供标准 C 运行时。
  armclang 使用 Arm C 库，`printf` 等函数需自行 retarget。
- 侧栏烧录区：「检测探针」读 CPUID 与 DBGMCU IDCODE，显示内核/系列/DEV_ID，自动选中
  探测成功的探针接口，并按 DEV_ID 把 target 切到对应系列（未收录的芯片保留当前目标）；
  检测结果会写进「烧录输出」。固件默认取 `build/debug`、`build/release` 下最新的 ELF，
  构建目录为空时回退到工作区最新的 ELF，也可手动选择；一键烧录带阶段进度、输出与失败诊断。
- 可选 `flash.py`（J-Link / pyOCD 后端）与 Cortex-Debug 配置（可带 SVD 与 `preLaunchTask`，
  launch/attach 两条配置）。

## Linux / SoC

`loongarch64`、`aarch64`、`armv7hf`、`riscv64` 四种前缀，按
`CROSS_COMPILE` → `CC`/`CXX` → `PATH` 查找，只写命令名；可选 `CMAKE_SYSROOT`。

## 桌面 C/C++

不提供编译链选择，由 CMake Tools 的 Kit 选择/切换编译器；CMakeLists 不写
`CMAKE_C_COMPILER`，工程不绑定机器路径。CMake Tools 使用 Kit 模式，生成的
`CMakePresets.json` 仅用于命令行构建。

## 环境要求

- VS Code 1.85+、CMake Tools、CMake ≥ 3.22、Ninja。
- C/C++ 扩展推荐安装；不装也能生成工程，只是没有 IntelliSense 集成。
- MCU 需要 Cortex-Debug 与 `arm-none-eabi-gdb`，以及三种编译链之一。
- Linux 需要对应前缀的 `gcc`/`g++`。

**F5 立刻退出**：确认已装 Cortex-Debug、`arm-none-eabi-gdb` 在 `PATH`、先构建过
`debug` 预设，并在调试下拉选中 `CMake Forge OpenOCD`。

## 命令与设置

命令：`Generate MCU / Linux / C++ Project`、`Generate OpenOCD Flash Script`、
`Generate Cortex-Debug Configuration`、`Import CMSIS Pack`、`Install Pack Online`、
`Remove Imported CMSIS Pack`、`Install ARM CMSIS Core Pack`。

设置：`cmakeForge.openocdPath`、`jlinkPath`、`pyocdPath`、`packMirror`。

## 开发

```powershell
npm install
npm test          # Node.js 22+
npm run vsix      # 打包扩展
```

修改后先 `npm run compile` 再按 F5。`fast-xml-parser` 是运行时依赖，打包时不要加
`--no-dependencies`。

更多：[架构](docs/architecture.md) · [契约](docs/contracts.md) · [路线图](docs/roadmap.md)
