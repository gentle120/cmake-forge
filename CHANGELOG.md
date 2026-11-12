# Changelog

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
- 桌面方向移除编译链选择：编译器由 CMake Tools / CMake 自动检测，生成的
  CMakeLists 不写 `CMAKE_C_COMPILER`/`CMAKE_CXX_COMPILER`，工程不绑定机器路径。
- 编译链选择：MCU 提供 Arm GNU Toolchain (armgcc) 与 Arm Compiler 6
  (armclang) 两种，扫描 PATH/Keil/STM32CubeCLT/Program Files，未安装的家族不
  显示；armclang 生成 `.sct` 分散加载文件、armclang 启动文件与 fromelf 转换，
  armgcc 保持 GNU 工具链与 `.ld` 链接脚本。选择按工作区保存。
- Pack 解析支持 Zip64、`<variant>` 型号、`name=` 内存区、启动向量注释、
  器件头选择宏推导、非整 KiB 链接区大小等厂商差异。
