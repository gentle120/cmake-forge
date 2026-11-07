# CMake-Embedded Roadmap

This file is a compact relay ledger, not a history log. Stable facts belong in `architecture.md` or `contracts.md`; completed history belongs in Git.

## Current Direction

- Target state: 支持任意 32 位 ARM MCU——厂商/系列注册表动态化，芯片数据全部来自 CMSIS Pack 解析（本地/Keil 库/在线索引）并适配 GCC 生成；OpenOCD 之外增加 J-Link 与 ST-Link/DAPLink(pyOCD) 烧录调试后端。
- Explicit non-goals: RISC-V 构建支持；执行外部烧录器进程；PyOCD/ST-Link 私有烧录协议实现；手写内置芯片档案（一律 Pack 导入）。

## Current Batch

- Objective: 让「芯片支持包 / Pack」只列出服务于所选系列的 Pack；没有可用 Pack 时 MCU 无法生成，需明确提示缺少哪个器件包。
- Scope: `src/sidebar/{state.ts,provider.ts,webview/main.js}`、`src/test/**`、`docs/contracts.md`、`README.md`、`CHANGELOG.md`。
- Acceptance criteria: 系列切换后 Pack 下拉只含服务该系列的 Pack（imported 按档案型号前缀判定，installed/downloadable 按目录 DFP 名判定）；不服务的 Pack 不再被选中或出现在列表中；没有可用 Pack 时「生成工程」「仅 flash.py」「仅 Debug」禁用，侧栏提示需要哪个 DFP；命令面板与侧栏生成路径都给出同一提示而不是泛化错误；`tsc --noUnusedLocals --noUnusedParameters` 无告警；`npm test` 全绿。
- Status: `idle`

## Next Batch

- Objective: None scheduled.
