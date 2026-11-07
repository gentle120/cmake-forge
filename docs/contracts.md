# CMake-Embedded Contracts

## Source Rules

Record an item here only when it is a stable externally observable or cross-module invariant that future changes must preserve. Code and executable tests remain the final behavioral evidence.

Do not append content merely because a batch changed code. Current or planned work, implementation status, bug narratives, task-specific acceptance notes, command output, test results, and completed history do not belong here. Put current work in `roadmap.md`, executable evidence in tests, stable design shape in `architecture.md`, and completed history in Git.

Prefer precise constraints and links to the owning schema, symbol, test, or runbook over duplicated implementation prose. Remove an entry when the invariant no longer exists; do not retain it as historical context.

Before adding an entry, name the exact invariant future changes must preserve. If no such invariant exists, do not add the entry. Whenever this file is edited, consolidate duplicate statements and remove obsolete or task-specific text in the sections being changed.

## Public Interfaces

- `DeviceProfile`（`src/devices/deviceProfiles.ts`）是生成器的唯一芯片契约；`part` 在注册表内唯一（大写归一化），未知 part 抛 `Unsupported MCU: <part>`。
- `registerDeviceProfiles()` 允许运行时追加档案；`unregisterDeviceProfilesByPack()` 按来源移除并恢复前一个来源，无前序来源时移除该型号；`listDeviceProfiles()/getDeviceProfile()` 签名稳定，返回防御性拷贝。
- 注册表无内置芯片数据：所有 DeviceProfile 由 Pack 导入注入；无任何 Pack 时注册表与厂商列表为空，持久化的 `builtin:` 选择落空为空选择。
- 厂商必须先在 `vendorRegistry` 注册（id 唯一，`getVendorMetadata` 未知 id 抛错）。
- 命令 ID：`cmakeEmbedded.generateMcu/generateLinux/generateNative/generateFlashScript/generateDebugConfiguration/importPack/installPackOnline/removePack/installCorePack`；`package.json` 贡献的命令必须与 `extension.ts` 注册的命令一一对应。
- 工作区可包含多个工程；扫描、生成、烧录与调试都以当前选中的工程根目录为边界，不跨工程合并源文件。目标工程按工作区持久化；发现结果只有一个时自动选择，多个时保留有效选择或等待用户选择。空工作区根目录仍作为可扫描目标保留；扫描返回零个源文件、头文件目录和宏，并明确提示没有 C/C++ 或汇编源文件。
- 插件不提供构建命令、构建执行器或 ARM GNU 路径设置；配置、编译与调试分别由 CMake Tools 与 Cortex-Debug 拥有。生成产物只写可移植命令名 `arm-none-eabi-gcc/g++/objcopy/size`，不含机器绝对路径。
- 生成文件落盘前必须经过覆盖确认（`shared/generatedFiles.ts`）。
- 内核向量表 16 槽 + `interruptHandlers` 按序拼接，槽位 `'0'` 表示保留（`startupGenerator`）；异常槽按内核架构族选择：ARMv6-M（M0/M0+/M1/SC000 与 ARMv8-M baseline 的 M23）保留 M0 布局，ARMv7-M（M3/M4/M7）保留 UsageFault 后四个保留字，ARMv8-M mainline（M33/M35P/M55）首保留字为 `SecureFault_Handler`。

## Data And Persistence

- Pack 导入持久化在扩展 globalStorage：归档来源保存到 `packs/<vendor>/<file>.pack`，`packs.json`（version 2）记录 `source`、真实 `archiveFile` 和序列化 DeviceProfile；同 part 重复导入覆盖旧版。
- Pack 导入只解压/读取 PDSC、SVD 与启动文件条目（`isPackDeviceSourceEntry`）；文档、示例等无关条目不进入解析、不读入内存（真实 DFP 达数百 MB）。
- 同一 globalStorage 的 Pack 写入串行执行；`packs.json` 先写临时文件、校验后原子替换，损坏的现有文件报错且不得被静默清空。
- Keil 安装目录中的已解压 Pack 以目录引用方式导入（`packs.json` 记录元数据但不复制目录）；目录旁存在 `.pack` 时记录其绝对路径，删除导入记录不触碰原目录。
- `CMAKE_EMBEDDED_SKIP_FIRMWARE_BUILDS=1` 跳过真实固件编译用例；CI（release.yml）默认置位。
- `.mcu-cmake.json`、`.vscode/launch.json`、`c_cpp_properties.json` 的写入保留用户已有内容（JSONC 解析合并）；三个方向的 `c_cpp_properties.json` 与 settings 编辑共用 `shared/cppPropertiesFile.ts`，CMakePresets 共用 `shared/cmakePresets.ts`。

## Compatibility

- `architecture` 字段仅 `'arm'`；非 ARM Dcore 的 Pack 设备跳过并报告，不生成半成品档案。
- PDSC `<processor Dcore>` 在 family/subFamily/device 任一层均有效，device 层缺失时继承上层；`CM0` 缩写与 `Cortex-M0`、`Cortex-M0+` 等全名拼写等价（`+` 归一为 `plus`）。
- ARM CMSIS 内核包与器件 Pack 分开管理：内核包只取 `CMSIS/Core/Include/**/*.h` 与 PDSC，安装到扩展存储，其身份由 PDSC 的 vendor/name 决定；器件 Pack 的 `<devices>` 解析不得因内核包缺失或存在而改变。厂商器件头文件 `#include core_cm*.h`，而器件 DFP 不含这些文件，因此生成 MCU 工程时把已安装内核包的全部头文件按字节复制到工程内 `CMSIS/Include`，`target_include_directories` 只用工程内相对路径，不得写扩展存储或任何机器绝对路径；复制出的头文件计入覆盖确认。内核包未安装（或所选版本的头文件已缺失）时仍生成工程但提示缺失，不得静默产出一个必然编译失败的工程。
- `Dvendor` 的数字注册号后缀（如 `Sinomcu:985`、`ARM:82`）既不进入厂商显示名也不进入厂商 id；同一厂商的后缀变体解析为同一身份。
- 烧录后端 `openocd|jlink|pyocd` 与探针兼容矩阵见 `src/flash/backendProfiles.ts`；pyocd 后端不支持 J-Link 探针（硬件限制）。
- pyOCD 的 pack 参数必须是真实存在的 `.pack` 文件；导入设备没有归档时省略 `--pack`，不得生成指向虚拟路径的配置。
- 在线 Pack 搜索复用同一 TTL 缓存的索引；取消进度通知必须中断索引读取与 Pack 下载（请求随调用方 signal 中止，不再继续到完成），且取消后不再发起后续请求；连接级失败（连接超时、连接被重置、域名暂不可解析等）自动重试一次，取消与其它错误不重试。每个可下载版本都保留为独立条目，不折叠为最新版本。
- 「用户取消」与「请求超时」是两种不同结局，不得合并呈现：fetcher 自身计时器到期必须以超时失败告终（`RequestTimeoutError`，并说明等待了多久），不得报告为已取消；用户取消仍返回 `cancelled` 且不弹错误提示。两者在 undici 中都表现为 AbortError，因此判别只能发生在 fetcher 内部（`src/packs/fetcher.ts`）。
- Pack 下载通道按顺序尝试：配置的镜像（`cmakeEmbedded.packMirror`，扁平目录按 `<vendor>.<name>.<version>.pack` 提供文件）→ 索引发布地址改写后的 CDN 目标 → 索引里发布的原始地址。改写只作用于 `https://www.keil.com/pack/` 前缀（其 302 指向 `keilpack.azureedge.net/pack/`），厂商自托管地址（GD32/ST 等）必须原样请求。任一候选失败换下一个，取消与超时立即结束、不再换候选。
- 下载必须报告进度：通知显示「已下载 / 总大小（百分比）」，侧栏状态徽标同步同一文案（`operationProgress`），完成或失败后回到常规状态。总大小来自 `Content-Range` 或 `Content-Length`；无法获知总量时只报已下载字节且不显示百分比，不得伪造进度。
- 大包（≥2 MB 且服务端支持 `Range`）按 1 MB 分段并发下载（最多 8 路），每段独立重试、独立失败；小包与不支持 Range 的主机仍走单次请求（`200` 响应视为完整归档，不得当作分片）。重组后必须校验总长度与分段齐全，缺段即失败。
- 侧栏 MCU 选择为 vendor → series → pack → version → part：series 可在激活 Pack 前选择，来源为精选厂商系列目录（`src/devices/seriesCatalog.ts`，含各系列的 DFP 名与型号前缀）与本地包系列；选定系列后自动解析并激活本地对应 Pack（imported 按档案系列/型号前缀匹配，installed 按 DFP 名匹配），无匹配时提示确定性安装途径；part 按目录型号前缀或系列过滤；不保留跨 vendor 残留。
- 系列有两套命名：侧栏持久化的精选 id（`F1x`）与 PDSC 的 `Dfamily` 文本（`STM32F1 Series`）。匹配必须接受两者之一（同系列或型号前缀命中），选中系列不得因激活 Pack 而回弹到 Pack 自己的文本；下拉选项按精选 id 去重，同一系列不得出现两行；旧版本持久化的 Pack 文本 id 在渲染时归一为精选 id。切换系列后若当前 Pack 不含该系列，part 为空并给出「需要哪个 DFP」的提示，而不是把系列改回原值。
- 生成的工程是否复制内核包头文件由侧栏「生成内核包 include」开关决定（持久化，默认开）：开启时把所选已安装版本复制进工程 `CMSIS/Include` 并写入该相对 include；关闭时不复制、不写 include、也不再提示内核包缺失，用于用户自行提供 core 头文件的场景。目标配置面板在开关开启且已安装内核包时提供版本下拉，空值表示最新已安装版本，选择随选择持久化且不受切换厂商/器件 Pack 影响；该开关与版本选择只影响生成，不改变内核包的安装状态。
- 系列先于 Pack 选择，因此 Pack 下拉只列出服务所选系列的 Pack，不得让用户选中一个必然列不出型号的 Pack：imported 按已解析档案的系列/型号前缀判定，installed/downloadable 按目录 DFP 名判定（裸名与带厂商前缀名等价，如 `STM32F1xx_DFP` / `Keil.STM32F1xx_DFP`）；目录外厂商没有 DFP 名可判定时不隐藏 Pack。选中 Pack 的版本列表与持久化选择都必须在过滤后的集合内，不服务于该系列的 Pack 不作为有效选择保留。
- 没有服务所选系列的 Pack（或没有型号）时 MCU 无法生成：`mcuBlockedReason` 随状态下发，侧栏据此禁用「生成工程」「仅 flash.py」「仅 Debug」并显示同一句原因（点明缺少哪个 DFP 与获取方式），安装 Pack 的入口保持可用；侧栏生成与命令面板生成都必须给出同一提示，不得抛出底层 `Unsupported MCU` 之类的泛化错误。该提示与空型号列表共用一个来源，不重复显示。
- Pack 目录条目按身份区分：`installed`、`imported`、`downloadable`；同一 packId+version 只展示一个条目，已安装/已导入优先于可下载。
- 已安装 Pack 的身份取自 PDSC（`Dvendor`、包名、`release version`）；Keil 安装目录名或归档文件名不是最终身份，PDSC 无法解析的条目被跳过。
- 目录选项的 `packFile` 是安装位置，不是导入档案的所有权键；导入档案的所有权键固定为 `packs/<vendor>/<file>.pack` 形式的扩展存储相对路径。切换 Pack 或版本时所有权键随之切换，目录中已加载的 `imported` 条目优先于持久化键，目录未加载时沿用持久化键。
- 侧栏厂商列表按序包含：本地可用厂商（已导入档案、`parts` 非空的已导入记录、PDSC 解析出至少一个可导入设备的已安装 Pack，优先复用精选清单的友好标签），其后是精选芯片厂商清单（`src/devices/curatedVendors.ts`，本地暂缺的厂商带安装提示）；同一厂商本地来源优先且不重复出现；精选清单常驻，厂商下拉永不为空。
- MCU 面板的「导入 Pack 包」「在线安装 Pack」按钮分别触发 `cmakeEmbedded.importPack` 与 `cmakeEmbedded.installPackOnline`；导入/安装成功后目录按厂商切换自动激活语义刷新（优先激活服务当前所选系列的 imported/installed 版本，否则取最新版本；可下载版本仍不自动下载），失败不改变有效选择。
- 在线索引用 CMSIS 公开 Pack 索引（`https://www.keil.com/pack/index.pidx`，单次拉取 + TTL 缓存），供「在线安装 Pack」按钮与 `Import CMSIS Pack` 命令使用；其 `<pindex><pdsc url vendor name version/>` 条目按 CMSIS 命名约定派生下载地址 `<root><vendor>.<name>.<version>.pack`，缺失任何身份字段的条目、标为 `deprecated` 的条目与完全重复的条目跳过。索引同时覆盖 Keil 自托管包与厂商自托管包（如 GigaDevice、STMicroelectronics），因此「在线安装」的候选按已选系列的目录 DFP 名优先、否则按已选厂商 vendorId 过滤，无匹配时给出官方下载页或索引兜底。下载得到的 Pack 以索引条目为身份来源导入（存档文件名不是身份来源），成功后自动激活。
- 显式切换厂商时自动激活该厂商服务当前所选系列的可用版本（`imported`/`installed`，同版本 `imported` 优先；无系列匹配时取最新版本）；`downloadable` 版本不自动下载，启动时的目录刷新不自动激活。
- 仅切换侧栏模式（mcu/linux/native）的保存按消息保留模式；MCU 字段重算不改写模式。
- 侧栏调试器列表仅提供当前烧录后端支持的探针；切换后端时不保留不兼容探针。

## Performance And Resources

- 无运行时性能契约；注册表构建为启动期一次性成本。

## Safety And Failure Behavior

- 生成器绝不执行外部工具；flash.py 由用户显式运行。
- zip 读取器遇 Zip64/加密条目抛显式错误，不部分解压。
- 校验失败的 Pack 设备进入 skipped 并给出原因，不中断整包导入。
- 内核包安装只写 `CMSIS/Core/Include/**/*.h`，拒绝绝对路径与含 `..` 的归档条目；安装目录名把只含点的身份字段归一为 `_`，安装前的删除只作用于该版本目录。

## Verification Matrix

| Contract | Automated evidence location | Operational acceptance surface |
| --- | --- | --- |
| DeviceProfile 注册表唯一性与校验 | `src/test/deviceProfile.test.ts` | 侧边栏五级选择流 |
| Pack 导入→档案可查 | `src/test/packParser.test.ts`、`src/test/importedProfiles.test.ts` | 扩展宿主导入真实 pack 后生成 |
| 三后端 flash.py/launch.json | `src/test/flashScriptGenerator.test.ts`、`src/test/debugConfigGenerator.test.ts` | 本机 J-Link/pyOCD 真机烧录（用户侧） |
| 生成工程可编译 | `src/test/cmakeBuild.test.ts` | `cmake --preset debug && cmake --build --preset debug` |
| Keil Pack 发现与 PDSC 身份 | `src/test/toolchainScanner.test.ts`、`src/test/installedPacks.test.ts` | 扩展宿主「导入 Pack」选择 Keil 已安装 Pack |
| 厂商列表设备过滤与 `Dvendor` 归并 | `src/test/vendorOptions.test.ts`、`src/test/installedPacks.test.ts` | 侧栏厂商下拉（本机 Keil 安装目录） |
| Pack 目录五级选择、厂商切换自动激活与失败恢复 | `src/test/sidebarBuild.test.ts`、`src/test/sidebarAssets.test.ts` | 扩展宿主侧栏实际选择流 |
