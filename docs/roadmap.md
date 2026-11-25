# Roadmap

只记录方向、当前批次与下一批次；细节在 [架构](architecture.md) 与 [契约](contracts.md)，历史在 Git。

## Direction

- 目标：覆盖常见 32 位 ARM MCU——芯片数据全部来自 CMSIS Pack（本地、Keil 目录、在线索引），生成 GNU Arm GCC 工程；烧录与调试在侧栏完成检测、一键烧录与 Cortex-Debug 配置，缺失工具由扩展引导安装。
- 非目标：RISC-V 构建；自研调试适配器、RTT/live watch、Agent/MCP；PyOCD/ST-Link 私有协议；手写内置芯片档案。

## Current Batch

- Status: `idle`

## Next Batch

- Objective: 用真实 DFP 与硬件验证既有链路——精选厂商补漏、真实探针上的检测/烧录、J-Link 与 pyOCD 后端实机回归。
- Status: `ready`

## Maintenance

- 完成一个批次后清空 Current Batch，把下一批次提升为 `ready`。
- 稳定的结构变化写进 `architecture.md`，稳定的行为不变量写进 `contracts.md`。
