# Design Notes

影响架构的历史决策，按主题记录「问题 → 决策 → 落点」。实现细节看代码，稳定不变量看 [契约](contracts.md)。

## 2026-09 — 芯片数据全部来自 CMSIS Pack

问题：手写内置芯片档案会迅速过时，且无法覆盖长尾型号。
决策：只保留运行时注册表，DeviceProfile 由 PDSC 解析注入；导入记录持久化到扩展 `globalStorage`，Keil 已安装目录以引用方式导入。
落点：`src/packs/packParser.ts`、`src/devices/deviceProfiles.ts`、`src/devices/importedProfiles.ts`。

## 2026-09 — 精选厂商与系列目录

问题：在线索引里有数百个 Pack，直接铺开无法导航。
决策：内置五家主流厂商（STM32、GD32、NXP、nRF、Microchip）与系列前缀目录，作为**导航数据**而非芯片数据；导入 Pack 后仍自动注册其它厂商。
落点：`src/devices/curatedVendors.ts`、`src/devices/seriesCatalog.ts`。

## 2026-10 — 侧栏生成流

问题：命令面板逐项选择步骤多，芯片与 Pack 关系不直观。
决策：侧栏 Webview 按 vendor → series → pack → version → part 五级选择，生成结果以树形展示；命令面板保留为等价入口。
落点：`src/sidebar/{provider,state,messages}.ts`、`src/sidebar/webview/`。

## 2026-10 — CMakePresets 与构建入口

问题：不同机器的手写构建命令不一致。
决策：生成 `CMakePresets.json` 的 `debug`/`release` 预设，命令行与 CMake Tools 共用；插件不启动编译器，构建归 CMake Tools。
落点：`src/generator/presetGenerator.ts`、`shared/cmakePresets.ts`。

## 2026-11 — Pack 选择与依赖重构

问题：系列与 Pack 相互依赖，跨厂商残留与「选中必然列不出型号的 Pack」频发。
决策：系列先于 Pack 选择，Pack 下拉按系列过滤；目录条目标识 `installed|imported|downloadable`，导入档案所有权固定为扩展存储相对路径，`packFile` 只表示安装位置。
落点：`src/devices/installedPacks.ts`、`src/sidebar/state.ts`。

## 2026-11 — 烧录与调试一键化

问题：用户需要手写烧录参数、手改 launch.json，目标与芯片经常对不上。
决策：探针检测读 CPUID/DBGMCU ID 得到芯片，target 由 DEV_ID 推导；OpenOCD 后端直接 spawn（不再经过 `flash.py`），J-Link/pyOCD 保留脚本；缺失工具由扩展引导安装。
落点：`src/flash/{openocdDirect,chipTargets,firmwareDiscovery,flashRunner,flashDiagnostics}.ts`、`src/env/toolDownloads.ts`。

## 2026-11 — 文档收敛

问题：历史计划与设计文档累积到 1700+ 行，与实际行为漂移。
决策：保留架构、契约、路线图、变更记录四份，历史决策合并成本文件；术语按开源产品文档书写，不使用教程口吻。
