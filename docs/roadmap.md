# CMake Forge Roadmap

This file is a compact relay ledger, not a history log. Stable facts belong in `architecture.md` or `contracts.md`; completed history belongs in Git.

## Current Direction

- Target state: 支持任意 32 位 ARM MCU——厂商/系列注册表动态化，芯片数据全部来自 CMSIS Pack 解析（本地/Keil 库/在线索引）并适配 GCC 生成；OpenOCD 之外增加 J-Link 与 ST-Link/DAPLink(pyOCD) 烧录调试后端。
- Explicit non-goals: RISC-V 构建支持；自研调试适配器（自己托管 GDB/OpenOCD）、RTT/live watch、Agent/MCP 类功能；PyOCD/ST-Link 私有烧录协议实现；手写内置芯片档案（一律 Pack 导入）。

## Current Batch

- Objective: 让烧录与调试对齐参考工程的操作面——探针检测 MCU 型号（CPUID + DBGMCU IDCODE）、可手选工作区 ELF、OpenOCD 后端直连烧录不再经过 `flash.py`，检测/烧录都带阶段进度与失败诊断。
- Follow-up（2026-11-24）: 去掉「后端细节」面板；检测成功把芯片/目标/探针写进「烧录输出」；target 由 DEV_ID 推导（`src/flash/chipTargets.ts`）；构建目录为空时回退到工作区最新 ELF。`npm test` 510 项（501 通过 / 9 个固件用例跳过）。
- Status: `done` — `src/flash/openocdDirect.ts`（OpenOCD 参数构造、CPUID/DBGMCU 标识解析、逐探针探测）+ `flashRunner.runTool`（通用子进程与阶段解析）+ 侧栏「检测探针 / 选择… / 烧录」接线 + 契约 L72 修订；`npm test` 504/504 通过，真实进程用 stub 验证（真实探针与 OpenOCD 未在本机安装，待用户侧验收）。

## Next Batch

- Objective: 按需补充精选厂商/系列，并用真实 DFP 验证生成工程编译（大 Pack 走镜像或本地导入）。
- Status: `ready`
