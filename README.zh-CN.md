[中文主文档](README.md)

# CMake Embedded

默认中文文档在 [README.md](README.md)，此文件只保留一份简短索引，避免两份文档
内容逐渐不一致。

## 功能概览

- **MCU 固件**：裸机 STM32 / GD32 等 ARM Cortex-M 工程，生成 CMake、链接脚本、
  GNU 启动文件与 ARM GNU 工具链文件；芯片数据全部来自 CMSIS Pack（本地归档、
  Keil 已安装 Pack 或在线索引）。
- **Linux / SoC 应用**：面向龙芯 (loongarch64)、ARM (aarch64)、32 位 ARM (armv7hf)
  与 RISC-V (riscv64) 的交叉编译工程。
- **桌面 C/C++**：使用本机编译器生成可执行文件、静态库或动态库。

侧栏按 **厂商 → 系列 → 芯片支持包 (Pack) → 版本 → 型号** 选择；烧录脚本、
Cortex-Debug 配置各自独立生成。插件只生成工程文件，配置与编译交给 CMake Tools。

## 从哪里开始

- 安装与使用步骤、命令列表、生成的目录结构：[README.md](README.md)
- 架构、模块边界与依赖方向：[docs/architecture.md](docs/architecture.md)
- 稳定契约（数据格式、持久化、失败行为）：[docs/contracts.md](docs/contracts.md)
- 当前方向与批次：[docs/roadmap.md](docs/roadmap.md)

## 开发

```powershell
npm install
npm test
```

需要 Node.js 22 及以上（测试使用 Node 内置测试运行器）。
