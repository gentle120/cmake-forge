# CMake-Embedded Roadmap

This file is a compact relay ledger, not a history log. Stable facts belong in `architecture.md` or `contracts.md`; completed history belongs in Git.

## Current Direction

- Target state: 支持任意 32 位 ARM MCU——厂商/系列注册表动态化，芯片数据全部来自 CMSIS Pack 解析（本地/Keil 库/在线索引）并适配 GCC 生成；OpenOCD 之外增加 J-Link 与 ST-Link/DAPLink(pyOCD) 烧录调试后端。
- Explicit non-goals: RISC-V 构建支持；执行外部烧录器进程；PyOCD/ST-Link 私有烧录协议实现；手写内置芯片档案（一律 Pack 导入）。

## Current Batch

- Objective: 无正在执行的批次。
- Status: `idle`

## Next Batch

- Objective: None scheduled.

## Maintenance Rules

- Keep only these four sections.
- Use only `idle`, `ready`, `in progress`, or `blocked` for Current Batch status.
- At the start of every implementation batch, rewrite Current Batch before editing code: set the actual objective, bounded scope, observable acceptance criteria, and status to `in progress`.
- Before every closeout and commit, reconcile this file again. Remove completed work, promote the known Next Batch into Current Batch with status `ready`, or mark Current Batch as `idle` when nothing else is scheduled. Clear or replace Next Batch from established direction.
- Populate Next Batch only from established project direction or an explicit request. Write `None scheduled` instead of inventing work.
- If a required gate is blocked, keep the attempted work in Current Batch, set status to `blocked`, and name the unmet acceptance condition concisely.
- Roadmap reconciliation is required for every implementation batch even when architecture and contracts do not change. A stale roadmap blocks commit.
- Replace stale current-batch text; do not append a timeline or retain completed work.
- Do not paste command output, test logs, commit lists, or file inventories.
- Keep this file under 100 lines.
