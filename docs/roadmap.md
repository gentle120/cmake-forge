# CMake Forge Roadmap

This file is a compact relay ledger, not a history log. Stable facts belong in `architecture.md` or `contracts.md`; completed history belongs in Git.

## Current Direction

- Target state: 支持任意 32 位 ARM MCU——厂商/系列注册表动态化，芯片数据全部来自 CMSIS Pack 解析（本地/Keil 库/在线索引）并适配 GCC 生成；OpenOCD 之外增加 J-Link 与 ST-Link/DAPLink(pyOCD) 烧录调试后端。
- Explicit non-goals: RISC-V 构建支持；自研调试适配器（自己托管 GDB/OpenOCD）、RTT/live watch、Agent/MCP 类功能；PyOCD/ST-Link 私有烧录协议实现；手写内置芯片档案（一律 Pack 导入）。

## Current Batch

- Objective: 让新机器第一次打开就能编译、烧录——编译链只保留 GNU Arm GCC，侧栏检测不到 ARM GNU 工具链或 OpenOCD 时直接给「下载」，扩展自行下载官方发布包、解压到全局存储并把路径写回设置，全过程显示进度。
- Follow-up（2026-11-24）: 去掉「后端细节」面板；检测成功把芯片/目标/探针写进「烧录输出」；target 由 DEV_ID 推导（`src/flash/chipTargets.ts`）；构建目录为空时回退到工作区最新 ELF。检测结果按工程失效：换工程后目标行回到「自动」，检测成功前 OpenOCD 烧录与配置生成提示先检测，不再沿用上一份 target。`npm test` 510 项（501 通过 / 9 个固件用例跳过）。
- Previous batch (done): 探针检测 CPUID/DBGMCU → 目标由 DEV_ID 推导 → OpenOCD 直连烧录（`src/flash/openocdDirect.ts`、`flashRunner.runTool`、`chipTargets.ts`），侧栏无「后端细节」面板。
- Follow-up（2026-11-25）: `marus25.cortex-debug` 写进 `extensionDependencies`，由 VS Code 随扩展安装；生成调试配置前仍保留运行时检查（被禁用/被卸载/离线手装 VSIX）。
- Status: `in progress` — `src/env/toolDownloads.ts`（下载/解压/校验）+ 侧栏「编译与烧录工具」卡片 + provider `installTool`；`npm test` 526 项（517 通过 / 9 个固件用例跳过）；下载走 GitHub 代理、分片并发，解压缺失 `tar` 时回退 PowerShell；工具路径先做引号/变量展开再判存在。

## Next Batch

- Objective: 按需补充精选厂商/系列，并用真实 DFP 验证生成工程编译（大 Pack 走镜像或本地导入）。
- Status: `ready`
- Follow-up：环境卡片的工具链/烧录后端下拉在缺工具时直接给出下载项（本次已随卡片改造落地）。
