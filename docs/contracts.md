# CMake-Embedded Contracts

## Source Rules

Record an item here only when it is a stable externally observable or cross-module invariant that future changes must preserve. Code and executable tests remain the final behavioral evidence.

Do not append content merely because a batch changed code. Current or planned work, implementation status, bug narratives, task-specific acceptance notes, command output, test results, and completed history do not belong here. Put current work in `roadmap.md`, executable evidence in tests, stable design shape in `architecture.md`, and completed history in Git.

Prefer precise constraints and links to the owning schema, symbol, test, or runbook over duplicated implementation prose. Remove an entry when the invariant no longer exists; do not retain it as historical context.

Before adding an entry, name the exact invariant future changes must preserve. If no such invariant exists, do not add the entry. Whenever this file is edited, consolidate duplicate statements and remove obsolete or task-specific text in the sections being changed.

## Public Interfaces

- `DeviceProfile`（`src/devices/deviceProfiles.ts`）是生成器的唯一芯片契约；`part` 在注册表内唯一（大写归一化），未知 part 抛 `Unsupported MCU: <part>`。
- `registerDeviceProfiles()` 允许运行时追加档案；`unregisterDeviceProfilesByPack()` 按来源移除并恢复前一个来源或内置档案；`listDeviceProfiles()/getDeviceProfile()` 签名稳定，返回防御性拷贝。
- 厂商必须先在 `vendorRegistry` 注册（id 唯一，`getVendorMetadata` 未知 id 抛错）。
- 命令 ID：`cmakeEmbedded.generateMcu/generateLinux/generateNative/generateFlashScript/generateDebugConfiguration/importPack/removePack`；`package.json` 贡献的命令必须与 `extension.ts` 注册的命令一一对应。
- 工作区可包含多个工程；扫描、生成、烧录与调试都以当前选中的工程根目录为边界，不跨工程合并源文件。目标工程按工作区持久化；发现结果只有一个时自动选择，多个时保留有效选择或等待用户选择。空工作区根目录仍作为可扫描目标保留；扫描返回零个源文件、头文件目录和宏，并明确提示没有 C/C++ 或汇编源文件。
- 插件不提供构建命令、构建执行器或 ARM GNU 路径设置；配置、编译与调试分别由 CMake Tools 与 Cortex-Debug 拥有。生成产物只写可移植命令名 `arm-none-eabi-gcc/g++/objcopy/size`，不含机器绝对路径。
- 生成文件落盘前必须经过覆盖确认（`shared/generatedFiles.ts`）。
- 内核向量表 16 槽 + `interruptHandlers` 按序拼接，槽位 `'0'` 表示保留（`startupGenerator`）。

## Data And Persistence

- Pack 导入持久化在扩展 globalStorage：归档来源保存到 `packs/<vendor>/<file>.pack`，`packs.json`（version 2）记录 `source`、真实 `archiveFile` 和序列化 DeviceProfile；同 part 重复导入覆盖旧版。
- 同一 globalStorage 的 Pack 写入串行执行；`packs.json` 先写临时文件、校验后原子替换，损坏的现有文件报错且不得被静默清空。
- Keil 安装目录中的已解压 Pack 以目录引用方式导入（`packs.json` 记录元数据但不复制目录）；目录旁存在 `.pack` 时记录其绝对路径，删除导入记录不触碰原目录。
- `CMAKE_EMBEDDED_SKIP_FIRMWARE_BUILDS=1` 跳过真实固件编译用例；CI（release.yml）默认置位。
- `.mcu-cmake.json`、`.vscode/launch.json`、`c_cpp_properties.json` 的写入保留用户已有内容（JSONC 解析合并）。

## Compatibility

- `architecture` 字段仅 `'arm'`；非 ARM Dcore 的 Pack 设备跳过并报告，不生成半成品档案。
- PDSC `<processor Dcore>` 在 family/subFamily/device 任一层均有效，device 层缺失时继承上层；`CM0` 缩写与 `Cortex-M0` 全名等价。
- `Dvendor` 的数字后缀（如 `Sinomcu:985`）不进入厂商显示名；vendor id 由完整值 sanitize 得出。
- 烧录后端 `openocd|jlink|pyocd` 与探针兼容矩阵见 `src/flash/backendProfiles.ts`；pyocd 后端不支持 J-Link 探针（硬件限制）。
- pyOCD 的 pack 参数必须是真实存在的 `.pack` 文件；导入设备没有归档时省略 `--pack`，不得生成指向虚拟路径的配置。
- 在线 Pack 搜索可复用 TTL 缓存，限制并发索引请求，并在取消后停止发起后续请求；每个可下载版本都保留为独立条目，不折叠为最新版本。
- 侧栏 MCU 选择为 vendor → pack → version → series → part 五级；series/part 必须属于当前选中 Pack 的版本，否则回退到该版本首个可用系列与型号，不保留跨 vendor 或跨 Pack 残留。
- Pack 目录条目按身份区分：`builtin`（每厂商一个虚拟 Pack，单一 `builtin` 版本）、`installed`、`imported`、`downloadable`；同一 packId+version 只展示一个条目，已安装/已导入优先于可下载。
- 已安装 Pack 的身份取自 PDSC（`Dvendor`、包名、`release version`）；Keil 安装目录名或归档文件名不是最终身份，PDSC 无法解析的条目被跳过。
- 目录选项的 `packFile` 是安装位置，不是导入档案的所有权键；导入档案的所有权键固定为 `packs/<vendor>/<file>.pack` 形式的扩展存储相对路径。切换 Pack 或版本时所有权键随之切换，目录中已加载的 `imported` 条目优先于持久化键，目录未加载时沿用持久化键。
- 侧栏调试器列表仅提供当前烧录后端支持的探针；切换后端时不保留不兼容探针。

## Performance And Resources

- 无运行时性能契约；注册表构建为启动期一次性成本。

## Safety And Failure Behavior

- 生成器绝不执行外部工具；flash.py 由用户显式运行。
- zip 读取器遇 Zip64/加密条目抛显式错误，不部分解压。
- 校验失败的 Pack 设备进入 skipped 并给出原因，不中断整包导入。

## Verification Matrix

| Contract | Automated evidence location | Operational acceptance surface |
| --- | --- | --- |
| DeviceProfile 注册表唯一性与校验 | `src/test/deviceProfile.test.ts` | 侧边栏五级选择流 |
| Pack 导入→档案可查 | `src/test/packParser.test.ts`、`src/test/importedProfiles.test.ts` | 扩展宿主导入真实 pack 后生成 |
| 三后端 flash.py/launch.json | `src/test/flashScriptGenerator.test.ts`、`src/test/debugConfigGenerator.test.ts` | 本机 J-Link/pyOCD 真机烧录（用户侧） |
| 生成工程可编译 | `src/test/cmakeBuild.test.ts` | `cmake --preset debug && cmake --build --preset debug` |
| Keil Pack 发现与 PDSC 身份 | `src/test/toolchainScanner.test.ts`、`src/test/installedPacks.test.ts` | 扩展宿主「导入 Pack」选择 Keil 已安装 Pack |
| Pack 目录五级选择与失败恢复 | `src/test/sidebarBuild.test.ts`、`src/test/sidebarAssets.test.ts` | 扩展宿主侧栏实际选择流 |
