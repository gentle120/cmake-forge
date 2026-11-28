# CMake Forge Contracts

这里只记录**稳定的、外部可观察或跨模块的不变量**——未来改动必须保留的行为。代码与可执行测试是最终依据；当前工作写进 `roadmap.md`，稳定的结构形状写进 `architecture.md`，已完成的变更留在 Git。

新增条目之前先说出它要守住的不变量；没有就写进代码或测试。编辑某一节时顺手合并重复、删除过期文本。

## Public Interfaces

- `DeviceProfile`（`src/devices/deviceProfiles.ts`）是生成器唯一的芯片契约；`part` 在注册表内唯一（大写归一），未知 part 抛 `Unsupported MCU: <part>`。
- 注册表无内置芯片数据：`registerDeviceProfiles()` 只做运行时追加，`unregisterDeviceProfilesByPack()` 按来源移除并恢复前一个来源；`listDeviceProfiles()` / `getDeviceProfile()` 签名稳定并返回防御性拷贝。没有 Pack 时器件列表为空，但厂商下拉仍含精选厂商（`curatedVendors`）；扫描完成前的窗口期不得清空持久化的厂商/系列，首次打开且无有效持久化时采用厂商列表第一项及其首个系列。
- 厂商必须先在 `vendorRegistry` 注册；未知 id 抛错。
- 命令 ID 固定为 `cmakeForge.generateMcu/generateLinux/generateNative/generateFlashScript/generateDebugConfiguration/importPack/installPackOnline/removePack/installCorePack`，`package.json` 的贡献与 `extension.ts` 的注册必须一一对应。
- 工作区可含多个工程；扫描、生成、烧录、调试都以当前选中的工程根为边界，不跨工程合并源文件。持久化选择只在本工作区有效；发现唯一工程时自动选中，多个时保留有效选择或等待用户选择。空工作区根目录仍可扫描，返回零源文件并明确提示没有 C/C++ 或汇编源。
- 插件不提供构建命令或构建执行器：配置/编译归 CMake Tools，调试归 Cortex-Debug。两者写进 `extensionDependencies`（`ms-vscode.cmake-tools`、`marus25.cortex-debug`），由 VS Code 随扩展安装；生成调试配置前仍做运行时检查，覆盖被禁用、被卸载或离线手装的情况。
- 生成文件落盘前必须经过确认（`shared/generatedFiles.ts`）：只有内容与新输出不同、或会被生成过程删除的文件才进入确认；内容一致的重新生成不提示、不重写。覆盖与删除分开告知（数量 + 前若干个路径），不得把删除说成覆盖。MCU/Linux/桌面与仅 `flash.py` 的生成共用同一判据。
- 工具链文件中的可执行路径（编译器、objcopy、size）以 `/` 书写并加引号，再交给 CMake；Windows 反斜杠会被当作转义序列（`\U` 直接让 configure 失败），生成器不得把绝对路径原样拼进 `set(...)`。
- 启动向量表固定 16 槽 + `interruptHandlers` 依序拼接，`'0'` 表示保留（`startupGenerator`）：ARMv6-M（M0/M0+/M1/SC000 与 v8-M baseline 的 M23）用 M0 布局；ARMv7-M（M3/M4/M7）在 UsageFault 后保留四个字；ARMv8-M mainline（M33/M35P/M55）首保留字为 `SecureFault_Handler`。

## Data And Persistence

- 工具路径设置（`openocdPath` / `armGccPath` / `jlinkPath` / `pyocdPath` / `pythonPath`）先规范化再判存在：去首尾空白、去 Explorer「复制为路径」带的成对引号、展开 `%VAR%` 与开头的 `~`；带引号的真实路径不得判成「未安装」。
- 工具安装：侧栏用两个下拉选择编译工具链与烧录后端，缺失项仍列出并标「未安装」，**不把下载项塞进下拉**。缺任何工具时只弹**一条**通知，列出全部缺失项并提供「下载/稍后」，接受后按顺序安装；下载走可取消的通知进度条，取消即中止请求并删除半成品。GNU Arm GCC 取 xpack 15.2.1（经 `gh-proxy.com`，失败回退 Arm 官方 15.2.rel1），OpenOCD 取 xpack 0.12.0-7（同代理，失败回退 GitHub 直连）；CMake 与 Ninja 需用户自行安装（CMake Tools 不捆绑二者）。全部用系统 `tar.exe` 解压（缺失或失败回退 PowerShell `Expand-Archive`）到用户数据目录 `tools/`，成功后写对应设置。下载先发 `Range: bytes=0-0` 探测；支持分段时按 1 MB 分片、最多 24 路并发拉取并顺序重组（单片 30 秒无响应即超时，最多重试 3 次），否则单次请求；必须按百分比回报进度，失败或取消后删除半成品，不得把不完整解压当已安装。J-Link 打开 SEGGER 下载页（GUI 安装器，装完需重开窗口，非默认目录填 `jlinkPath`）；pyOCD 用 `PATH` 或 `pythonPath` 指到的 Python 执行 `-m pip install --user --upgrade -i https://pypi.tuna.tsinghua.edu.cn/simple pyocd`，失败回报最后一行输出，找不到 Python 时给官网说明而不是假装开始；成功后用 `sysconfig` 查用户 Scripts 目录，找到 `pyocd.exe` 就写 `pyocdPath`（`pip --user` 的脚本目录通常不在 `PATH`）。
- Pack 导入持久化在用户数据目录（Windows `%APPDATA%\cmake-forge`，其他平台 `$XDG_DATA_HOME/cmake-forge` 或 `~/.local/share/cmake-forge`）：归档存到 `packs/<vendor>/<file>.pack`，`packs.json`（version 2）记录 `source`、真实 `archiveFile` 与序列化 DeviceProfile；同 part 重复导入覆盖旧版。首次启动把旧 `globalStorage` 的 `packs.json`、`packs/`、`tools/` 迁到该目录（先重命名，跨卷失败再复制；迁移失败回退旧目录，不得显示成空库）。只解压/读取 PDSC、SVD、启动文件条目（`isPackDeviceSourceEntry`），文档与示例不读入内存（真实 DFP 可达数百 MB）。同一目录的写入串行；`packs.json` 先写临时文件、校验后原子替换，损坏时报错且不得静默清空；主文件缺失时恢复最新的 `packs.json.<pid>.<ts>.bak`（Windows 覆盖失败留下的备份），恢复不了才按空库处理。
- Keil 已解压 Pack 以目录引用导入（记录元数据、不复制目录）；目录旁有 `.pack` 时记录其绝对路径，删除导入记录不触碰原目录。
- `.mcu-cmake.json`、`.vscode/launch.json`、`c_cpp_properties.json` 写入时保留用户内容（JSONC 合并）；三个方向共用 `shared/cppPropertiesFile.ts` 与 `shared/cmakePresets.ts`。
- `.linux-cmake.json` 记录工具链、输出类型、宏与可选 `sysroot`，重建时回读这四项；`sysroot` 非空写 `CMAKE_SYSROOT` 与 `CMAKE_FIND_ROOT_PATH*`（PROGRAM NEVER，其余 ONLY），空值不写。`.native-cmake.json` 记录目标类型与语言标准，命令面板以保存值为默认。
- MCU 编译链只提供 GNU Arm GCC（`family === 'gcc'`），扫描只决定默认项与「已检测/未检测」提示；`armGccPath` 存在时合成已检测条目并写绝对编译器路径，`PATH` 内则只写 `arm-none-eabi-*` 命令名。桌面方向不写 `CMAKE_C_COMPILER`/`CMAKE_CXX_COMPILER`，由 CMake Tools/CMake 检测。

## Compatibility

- `architecture` 仅 `'arm'`；非 ARM Dcore 的设备跳过并报告，不生成半成品档案。PDSC `<processor Dcore>` 在 family/subFamily/device 任一层有效，device 缺失时继承上层；`CM0` 与 `Cortex-M0`/`Cortex-M0+` 等价（`+` 归一为 `plus`）。
- ARM CMSIS 内核包与器件 Pack 分开管理：内核包只取 `CMSIS/Core/Include/**/*.h` 与 PDSC，身份由 PDSC 的 vendor/name 决定；器件 Pack 的 `<devices>` 解析不因内核包存在与否改变。生成 MCU 工程时把**所选内核实际用到的**头文件按字节复制到工程 `CMSIS/Include`：以 `core_cm*.h` 为起点沿 `#include "..."` 求闭包，只保留所选家族需要的编译器头（armgcc 保留 `cmsis_compiler.h`/`cmsis_gcc.h`/`cmsis_version.h` 与 `m-profile/*`；armclang 保留 `cmsis_armclang*.h` 同组）；未知内核名时复制全部。`target_include_directories` 只用工程内相对路径，不写扩展存储或机器绝对路径；复制头部计入覆盖确认，换内核/版本后旧头随确认删除。内核包缺失时仍生成工程但提示缺失，不得静默产出必然编译失败的工程。
- `Dvendor` 的数字注册号后缀（`Sinomcu:985`、`ARM:82`）不进入显示名与 id；同厂商后缀变体解析为同一身份。
- 精选厂商/系列（`curatedVendors` + `seriesCatalog`）是导航数据，不是芯片数据：每个精选厂商至少一个系列，系列用真实型号前缀过滤 Pack 型号；前缀互相嵌套时按最长匹配（`MK`/`MKL`、`STM32WB`/`STM32WBA`）。系列名可指向一个 DFP；跨 DFP 的系列留空由 Pack 下拉选择。内置 OpenOCD target 只覆盖 STM32/GD32，其它厂商生成烧录/调试配置时必须警告需要手改 `configFiles`/target。
- 后端 `openocd|jlink|pyocd` 与探针兼容矩阵见 `src/flash/backendProfiles.ts`；pyocd 不支持 J-Link 探针（硬件限制）。pyOCD 的 pack 参数必须是真实存在的 `.pack`，无归档时省略 `--pack`。
- 在线索引：`https://www.keil.com/pack/index.pidx`，单次拉取 + TTL 缓存；按 CMSIS 命名约定派生 `<root><vendor>.<name>.<version>.pack`，缺身份字段、`deprecated` 与完全重复的条目跳过，每个可下载版本保留为独立条目。索引同时覆盖 Keil 与厂商自托管包，候选按已选系列 DFP 名优先、否则按厂商 vendorId 过滤，无匹配时给官方下载页或索引兜底。取消进度通知必须中断索引读取与下载，取消后不再发起后续请求；连接级失败自动重试一次，取消与其它错误不重试。
- 「用户取消」与「请求超时」是两种结局，不得合并：fetcher 计时器到期必须以超时失败（`RequestTimeoutError`，说明等待了多久），不得报告为已取消；用户取消返回 `cancelled` 且不弹错误。两者在 undici 都是 AbortError，判别只能发生在 `src/packs/fetcher.ts` 内部。
- Pack 下载候选顺序：配置镜像（`packMirror`，扁平 `<vendor>.<name>.<version>.pack`）→ 索引地址改写后的 CDN → 索引原始地址。改写只作用于 `https://www.keil.com/pack/` 前缀（302 到 `keilpack.azureedge.net/pack/`），厂商自托管地址必须原样请求；任一候选失败换下一个，取消与超时立即结束。
- 下载必须报进度：通知显示「已下载 / 总大小（百分比）」，侧栏 `operationProgress` 同步同一文案；总量取自 `Content-Range`/`Content-Length`，无法得知时只报已下载字节且不伪造百分比。大包（≥2 MB 且支持 `Range`）按 1 MB 分段、最多 8 路并发，每段独立重试与失败；小包或不支持 Range 的主机走单次请求（`200` 即完整归档，不得当分片）；重组后校验总长度与分段齐全，缺段即失败。
- 侧栏 MCU 选择为 vendor → series → pack → version → part：series 可在激活 Pack 前选择（`seriesCatalog` 与本地包系列）；选定系列后自动解析并激活对应本地 Pack（imported 按档案系列/型号前缀，installed 按 DFP 名），无匹配时提示安装途径；part 按前缀或系列过滤；不保留跨 vendor 残留。
- 系列有两套命名：持久化的精选 id（`F1x`）与 PDSC `Dfamily`（`STM32F1 Series`）。匹配接受两者之一（同系列或型号前缀命中）；选中系列不因激活 Pack 回弹到 Pack 文本；下拉按精选 id 去重；旧持久化的 Pack 文本 id 渲染时归一为精选 id。切换系列后当前 Pack 不含该系列时 part 为空并提示「需要哪个 DFP」，不得把系列改回原值。
- 「生成内核包 include」开关（持久化，默认开）决定是否复制内核头：开时复制并写相对 include；关时不复制、不写 include、不再提示内核包缺失，用于用户自备 core 头。开关开启且已安装内核包时提供版本下拉（空值 = 最新），选择持久化且不受切换厂商/器件 Pack 影响；两者只影响生成，不改安装状态。
- 器件支持文件由 PDSC `<compile header>` 决定：导入时把 `Device/Include`、`Device/Source`（及 `devices/`、`Include/` 布局）中的器件头、`system_<stem>.h`、`system_<stem>.c` 快照到扩展存储；生成时复制进工程 `CMSIS/Device/Include|Source`，`system_<stem>.c` 进 CMake 源列表与 `.mcu-cmake.json` 清单；切换 Pack/系列后旧文件随覆盖确认删除。PDSC 未声明时按系列名推导且仅在 Pack 确实存在时采用；仍无器件支持时不阻断生成，启动文件的 weak `SystemInit` 兜底。旧导入记录（无 deviceHeader/无快照）生成时按归档或安装目录重建，以唯一器件头或系列名推导 header；目录来源持久化 `sourceRoot` 供重建。
- 器件支持复制范围刻意收窄：器件头、`system_<stem>.h/.c`、器件头强制包含的厂商 umbrella 头，以及 `system_*.c` 实际用到的寄存器头（GD32 只有 `gd32f10x_rcu.h`）；umbrella 列出的其余外设驱动头不复制。umbrella 无条件包含的 `RTE_Components.h` 若 Pack 未提供则生成空壳；快照目录写 `snapshot.json` 标记过滤规则版本，旧快照只重建一次，带标记且符合规则的快照不再回读归档。工程已有的器件头或 `system_*.c` 视为自带器件支持，不再复制；`RTE_Components.h`、umbrella 与 RCU 头不作为该判据。
- 系列先于 Pack：Pack 下拉只列出服务所选系列的 Pack（imported 按档案系列/前缀，installed/downloadable 按目录 DFP 名，裸名与带厂商前缀名等价）；目录外厂商没有 DFP 名可判定时不隐藏 Pack。选中 Pack 的版本列表与持久化选择都必须在过滤后的集合内。
- 没有服务所选系列的 Pack（或没有型号）时无法生成：`mcuBlockedReason` 随状态下发，侧栏据此禁用「生成工程」「仅 flash.py」「仅 Debug」并显示同一句原因（点明缺哪个 DFP 与获取方式），安装入口保持可用；侧栏与命令面板给同一提示，不得抛 `Unsupported MCU` 这类泛化错误。该提示与空型号列表共用一个来源，不重复显示。
- Pack 目录条目按身份区分 `installed|imported|downloadable`；同一 packId+version 只展示一个，已安装/已导入优先。已安装 Pack 的身份取自 PDSC（`Dvendor`、包名、`release version`），安装目录名或归档文件名不是身份；PDSC 无法解析的条目跳过。
- 目录选项的 `packFile` 是安装位置，不是所有权键；导入档案的所有权键固定为 `packs/<vendor>/<file>.pack` 形式的扩展存储相对路径。切换 Pack/版本时所有权键随之切换，目录中已加载的 `imported` 条目优先于持久化键。
- 厂商列表按序包含：本地可用厂商（已导入档案、`parts` 非空的导入记录、PDSC 解析出至少一个可导入设备的已安装 Pack，优先复用精选友好标签），其后是精选厂商（本地暂缺带安装提示）；同厂商本地优先且不重复；精选清单常驻，下拉永不为空。
- 「导入 Pack 包」「在线安装 Pack」按钮分别触发 `importPack` 与 `installPackOnline`；成功后按厂商切换语义刷新（优先激活服务当前系列的 imported/installed 版本，否则取最新；可下载版本不自动下载），失败不改变有效选择。显式切换厂商时同样自动激活服务当前系列的版本（同版本 imported 优先；无系列匹配取最新），启动时的目录刷新不自动激活。
- 仅切换侧栏模式（mcu/linux/native）的保存按消息保留模式；MCU 字段重算不改写模式。调试器列表只提供当前后端支持的探针，切换后端不保留不兼容探针。
- 固件来源顺序：手选 > `build/<preset>` 最新产物 > 工作区其余位置最新 ELF；手选路径不存在时烧录禁用并说明原因，构建目录为空时回退工作区扫描。
- 探针探测成功会把当前探针改成探测成功的接口；烧录 target 由读到的 DBGMCU DEV_ID 推导（`src/flash/chipTargets.ts`），未收录时保留当前目标而不是按内核猜。检测结果（芯片/目标/探针）写进「烧录输出」，侧栏不提供 target 手选或后端细节面板。检测不需要工程：未打开工程时也能读芯片并在侧栏显示结果，只是没有固件可烧（提示打开工程选择或构建固件）。检测先用不需要 `target/*.cfg` 的通用 Cortex-M SWD 会话（`swd newdap` + `target create cortex_m`）读 CPUID/DEV_ID，适配器不支持该传输层时才退回当前目标配置，再按常见 STM32 `target/*.cfg` 逐个试探（ST-Link 的 `hla_swd` 无法开无目标会话）——所以「先选型号才能检测」不成立，型号是检测的产物而不是前提。检测结果只对当前工程有效：切换工程或重开窗口后目标显示「自动」，本次检测成功前不复用旧 target，也不允许 OpenOCD 后端烧录或生成（提示先「检测探针」）；J-Link/pyOCD 用器件名而非 target 配置，不受限。

## Performance And Resources

- 无运行时性能契约；注册表构建是启动期一次性成本。

## Safety And Failure Behavior

- 生成器本身不执行外部工具。扩展只在用户显式操作时执行烧录：OpenOCD 后端由 `src/flash/openocdDirect.ts` 直接拼参数 spawn `openocd`（不依赖 Python，命令行原样回显），J-Link/pyOCD 仍 spawn 生成的 `flash.py`（`src/flash/flashRunner.ts`）；两者可见、可取消、失败给诊断，不静默重试、不改写脚本。侧栏的固件/目标/探针扫描只读工作区与已导入档案，不写盘；「检测探针」只做 `init` + `read_memory` 读 CPUID/DBGMCU ID（优先通用 Cortex-M 会话，不需要 `target/*.cfg`），不 halt、不复位、不写目标。
- zip 读取器遇 Zip64/加密条目抛显式错误，不部分解压。
- 校验失败的设备进入 skipped 并给出原因，不中断整包导入。
- 内核包安装只写 `CMSIS/Core/Include/**/*.h`，拒绝绝对路径与含 `..` 的条目；安装目录名把只含点的身份字段归一为 `_`，安装前删除只作用于该版本目录。

## Verification Matrix

| Contract | Automated evidence | Operational acceptance |
| --- | --- | --- |
| DeviceProfile 唯一性与校验 | `src/test/deviceProfile.test.ts` | 侧栏五级选择流 |
| Pack 导入 → 档案可查 | `src/test/packParser.test.ts`、`src/test/importedProfiles.test.ts` | 扩展宿主导入真实 pack 后生成 |
| 三后端 flash.py / launch.json | `src/test/flashScriptGenerator.test.ts`、`src/test/debugConfigGenerator.test.ts` | 本机 J-Link/pyOCD 真机烧录（用户侧） |
| 工具一键安装 | `src/test/toolDownloads.test.ts` | 侧栏「下载」→ 进度 → 设置写入；真实 OpenOCD 安装与 tar 解压 |
| 工具路径规范化 | `src/test/configuredPath.test.ts` | 引号、`%VAR%`、`~` 展开后再判存在 |
| 烧录检测、执行与诊断 | `src/test/firmwareDiscovery.test.ts`、`flashRunner.test.ts`、`flashDiagnostics.test.ts`、`openocdDirect.test.ts`、`chipTargets.test.ts` | 侧栏「检测探针」读 CPUID →「烧录」真实探针 |
| 生成工程可编译 | `src/test/cmakeBuild.test.ts` | `cmake --preset debug && cmake --build --preset debug` |
| Keil Pack 发现与 PDSC 身份 | `src/test/toolchainScanner.test.ts`、`src/test/installedPacks.test.ts` | 扩展宿主「导入 Pack」选择 Keil 已安装 Pack |
| 厂商列表过滤与 `Dvendor` 归并 | `src/test/vendorOptions.test.ts`、`src/test/installedPacks.test.ts` | 侧栏厂商下拉（本机 Keil 安装目录） |
| Pack 目录五级选择与激活恢复 | `src/test/sidebarBuild.test.ts`、`src/test/sidebarAssets.test.ts` | 扩展宿主侧栏实际选择流 |
