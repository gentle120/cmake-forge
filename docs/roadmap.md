# CMake-Embedded Roadmap

This file is a compact relay ledger, not a history log. Stable facts belong in `architecture.md` or `contracts.md`; completed history belongs in Git.

## Current Direction

- Target state: 支持任意 32 位 ARM MCU——厂商/系列注册表动态化，芯片数据全部来自 CMSIS Pack 解析（本地/Keil 库/在线索引）并适配 GCC 生成；OpenOCD 之外增加 J-Link 与 ST-Link/DAPLink(pyOCD) 烧录调试后端。
- Explicit non-goals: RISC-V 构建支持；执行外部烧录器进程；PyOCD/ST-Link 私有烧录协议实现；手写内置芯片档案（一律 Pack 导入）。

## Current Batch

- Objective: 修复侧栏「系列」被卡死（PDSC 的 Dfamily 与精选系列 id 是两套命名，选中后回弹），并新增「生成内核包 include」开关。
- Scope: `src/devices/seriesCatalog.ts`、`src/sidebar/{state.ts,provider.ts,html.ts,webview/main.js}`、`src/extension.ts`、`src/test/**`、`docs/contracts.md`。
- Acceptance criteria: 激活 Pack 后仍能用精选系列 id 切换（F1x/F4x…）且不回弹；未匹配到 Pack 的系列保留选择并给出安装提示；侧栏新增「生成内核包 include」开关，关闭后生成的 CMakeLists.txt 不含内核包目录、不再提示缺失；开关随选择持久化；`tsc --noUnusedLocals --noUnusedParameters` 无告警；`npm test` 全绿。
- Status: `idle`

## Next Batch

- Objective: None scheduled.
