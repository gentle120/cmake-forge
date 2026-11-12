# Changelog

## 1.0.0

首个公开版本。三个方向（MCU 固件 / Linux·SoC 交叉编译 / 桌面 C/C++）均可生成
可直接用 CMake Tools 构建的工程，芯片数据全部来自 CMSIS Pack。

- MCU：精选 5 家厂商（STM32、GD32、NXP、nRF、Microchip）与系列目录，其它厂商
  导入 `.pack` 后自动注册；CMSIS 内核头按所选内核裁剪；器件头、`system_<stem>.h/.c`
  与必需寄存器头按导入的 Pack 复制；生成可直接 F5 的 Cortex-Debug 配置与
  `flash.py` 烧录脚本；支持 J-Link / ST-Link / DapLink 探针。
- Linux：loongarch64 / aarch64 / armv7hf / riscv64 交叉工具链，可选 `CMAKE_SYSROOT`。
- 桌面：本机工具链，可执行文件 / 静态库 / 动态库。
- 侧栏按厂商→系列→Pack→版本→型号向导式生成，生成文件以树形展示。
- 桌面编译链下拉按 CMake Kit 风格显示编译器类型、版本与目标三元组
  （`GCC 16.1.0 (x86_64-w64-mingw32)`、`Clang 22`），版本从安装目录读取。
- 编译链选择：MCU 提供 Arm GNU Toolchain (armgcc) 与 Arm Compiler 6
  (armclang) 两种，扫描 PATH/Keil/STM32CubeCLT/Program Files，未安装的家族不
  显示；armclang 生成 `.sct` 分散加载文件、armclang 启动文件与 fromelf 转换，
  armgcc 保持 GNU 工具链与 `.ld` 链接脚本。桌面方向列出 PATH 中的
  gcc/clang/MinGW。选择按工作区保存。
- Pack 解析支持 Zip64、`<variant>` 型号、`name=` 内存区、启动向量注释、
  器件头选择宏推导、非整 KiB 链接区大小等厂商差异。
