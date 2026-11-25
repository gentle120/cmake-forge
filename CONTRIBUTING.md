# Contributing

## 开发环境

- Node.js 22+、CMake ≥ 3.22、Ninja；MCU 相关用例需要 `arm-none-eabi-gcc`。
- 安装依赖与编译：

```powershell
npm install
npm run compile     # 清空 out → tsc → 复制 webview 资源
npm test            # node --test out/test/*.test.js
npm run vsix        # 打包扩展
```

按 F5 启动扩展宿主调试。`fast-xml-parser` 是运行时依赖，打包时不要加 `--no-dependencies`。

## 代码约定

- TypeScript `strict`；生成器（`src/generator/`）与解析器（`src/packs/`、`src/devices/`）不得依赖 `vscode`，宿主交互放在 `src/sidebar/` 与 `src/extension.ts`。
- 遵循 [架构](docs/architecture.md) 的依赖方向与模块边界；新增行为先写进 [契约](docs/contracts.md) 只有当它是稳定的外部不变量。
- 错误显式抛出，不静默回退到其它档案或后端。
- 注释解释意图，不保留失败方案、临时调试输出或与任务无关的重构。

## 测试

- 行为变化必须带测试；`npm test` 是合并前的回归门槛。
- 真实固件编译用例由 `CMAKE_EMBEDDED_SKIP_FIRMWARE_BUILDS=1` 跳过，CI 默认置位；本地可去掉该变量跑完整链路。
- 涉及 UI 的改动需要在扩展宿主里实际点过；烧录/检测涉及硬件的部分在 PR 中标注 `verified` / `unverified`。

## 文档边界

- `docs/architecture.md`：稳定的模块职责与依赖方向。
- `docs/contracts.md`：稳定的外部可观察或跨模块不变量；不放当前工作、实现状态、缺陷叙述或测试结果。
- `docs/roadmap.md`：方向、当前批次、下一批次；历史留在 Git。
- `docs/design-notes.md`：影响架构的历史决策与落点，不写实现细节。

## 提交

- 一个批次一个提交，标题用 `change: <简短说明>`；不要宽泛 `git add .`，不夹带无关改动。
- 提交前确认：`npm test` 通过、`docs/roadmap.md` 已对账、最终 diff 没有调试残留。
- PR 描述写最终行为与必要的取舍，不写过程叙述。

## 反馈

问题与建议走 GitHub Issues：<https://github.com/gentle120/cmake-forge/issues>。
