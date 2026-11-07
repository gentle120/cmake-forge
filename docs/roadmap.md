# CMake-Embedded Roadmap

This file is a compact relay ledger, not a history log. Stable facts belong in `architecture.md` or `contracts.md`; completed history belongs in Git.

## Current Direction

- Target state: 支持任意 32 位 ARM MCU——厂商/系列注册表动态化，芯片数据全部来自 CMSIS Pack 解析（本地/Keil 库/在线索引）并适配 GCC 生成；OpenOCD 之外增加 J-Link 与 ST-Link/DAPLink(pyOCD) 烧录调试后端。
- Explicit non-goals: RISC-V 构建支持；执行外部烧录器进程；PyOCD/ST-Link 私有烧录协议实现；手写内置芯片档案（一律 Pack 导入）。

## Current Batch

- Objective: None scheduled.
- Status: `idle`

## Next Batch

- Objective: None scheduled.
