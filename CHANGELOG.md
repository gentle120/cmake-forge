# Changelog

## 1.0.1

- MCU 编译链固定提供 armgcc / armclang / LLVM clang 三种：扫描只决定默认项与
  “已检测/未检测”提示，未检测到的家族仍可选择。
- 新增 LLVM clang（`--target=arm-none-eabi`、LLD、`-nostdlib`）支持，并生成
  `system/clang_runtime.c` 让 C++ 静态构造函数可运行；C++ 编译去掉
  `-ffreestanding` 避免 `main` 被改名。
- 修复含空格路径、armclang/LLVM C++、fromelf 缺失、跨家族 runtime 等构建问题。
- 桌面方向改用 CMake Tools Kit 选择编译器，并用 CMake Tools 的 IntelliSense
  配置提供器；C/C++ 扩展改为推荐安装，VS Code 1.85（Node 18）兼容。
- 测试 447 项通过。

## 1.0.0

### 稳定性与安全修复

- 修复 `.pack` 设备文件快照的路径穿越（Zip Slip）：含 `..`、绝对路径或盘符的
  归档条目不再写进扩展存储；内核包/设备快照先写临时目录再替换，失败不破坏旧副本。
- ZIP 读取限制条目数量与单条目解压大小，并校验 Zip64 声明的大小，避免压缩炸弹
  或损坏包耗尽扩展宿主内存。
- 含空格的工程路径、编译器路径与链接脚本/分散加载文件现在会被正确引用；
  链接选项改由 `target_link_options` 交给 CMake 加引号。
- armclang 工具链补上 `CMAKE_CXX_COMPILER_TARGET`；SC000/SC300 器件使用等价的
  Cortex-M0/M3 `-mcpu`，不再生成无法编译的工程。
- 生成流程先写新文件再删除旧文件；设备/编译链切换会清理旧的启动文件、链接脚本
  与工具链文件，同时保留设备无关的 newlib stubs。
- 修复侧栏「扫描工作区」在未选工程时进入永久 busy 的问题、目录重载失败清空
  可用 Pack、OpenOCD 设置修改后不生效、多根工作区设置写错目标、多工程时下拉
  显示与生成目标不一致，以及 J-Link `flash.py` 忽略 device/speed 参数与固件
  路径未加引号的问题。


首个公开版本。三个方向（MCU 固件 / Linux·SoC 交叉编译 / 桌面 C/C++）均可生成
可直接用 CMake Tools 构建的工程，芯片数据全部来自 CMSIS Pack。

- MCU：精选 5 家厂商（STM32、GD32、NXP、nRF、Microchip）与系列目录，其它厂商
  导入 `.pack` 后自动注册；CMSIS 内核头按所选内核裁剪；器件头、`system_<stem>.h/.c`
  与必需寄存器头按导入的 Pack 复制；生成可直接 F5 的 Cortex-Debug 配置与
  `flash.py` 烧录脚本；支持 J-Link / ST-Link / DapLink 探针。
- Linux：loongarch64 / aarch64 / armv7hf / riscv64 交叉工具链，可选 `CMAKE_SYSROOT`。
- 桌面：本机工具链，可执行文件 / 静态库 / 动态库。
- 侧栏按厂商→系列→Pack→版本→型号向导式生成，生成文件以树形展示。
- 桌面方向移除编译链选择：编译器由 CMake Tools 的 Kit 选择，CMakeLists 不写
  `CMAKE_C_COMPILER`/`CMAKE_CXX_COMPILER`；桌面 `.vscode/settings.json` 设置
  `cmake.useCMakePresets: never`，避免 CMake Tools 锁定预设而无法切换 Kit。
- 不再把 C/C++ 扩展列为硬依赖：只保留 CMake Tools；没有 C/C++ 扩展时插件仍可
  正常打开和生成工程（只是没有 IntelliSense 集成）。
- LLVM clang 工程生成极简 `system/clang_runtime.c`（`__libc_init_array`）并在启动
  文件调用，C++ 静态构造函数可运行；C++ 编译去掉 `-ffreestanding`，避免 clang
  把 `main` 改名导致链接失败；armclang 未检测到 `fromelf` 时不再生成无效的
  fromelf 转换命令。
- 编译链选择：MCU 固定提供 Arm GNU Toolchain (armgcc)、Arm Compiler 6
  (armclang/Keil) 与 LLVM clang (arm-none-eabi) 三种；扫描 PATH/Keil/
  STM32CubeCLT/Program Files/LLVM 目录后只决定默认项与“已检测/未检测”提示，
  未检测到的家族仍可选择；armclang 生成 `.sct`/fromelf 转换，armgcc 生成
  `.ld`/GNU 启动，LLVM clang 生成 `.ld`/`-nostdlib -fuse-ld=lld` 启动变体。
  选择按工作区保存。
- Pack 解析支持 Zip64、`<variant>` 型号、`name=` 内存区、启动向量注释、
  器件头选择宏推导、非整 KiB 链接区大小等厂商差异。
