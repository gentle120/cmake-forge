# CMake-Embedded Architecture

## Purpose

VS Code 扩展：为桌面 C/C++、MCU 固件、Linux/SoC 交叉编译生成可构建的 CMake 工程。芯片知识集中在数据注册表，生成器完全由档案（profile）驱动。

## System Context

- 用户与外部系统：嵌入式开发者在 VS Code 侧边栏/命令面板选择方向与芯片；扩展读写工作区文件并生成 `.vscode/` 配置；烧录/调试依赖用户 PATH 或设置中的 OpenOCD、arm-none-eabi、J-Link、pyOCD；CMSIS Pack 来自本地文件、Keil 安装库或 keil.com 索引。
- 运行与部署目标：VS Code 扩展宿主（Node，`engines.vscode ^1.85`），`main: ./out/extension.js`，tsc 编译，无打包器。
- 信任与安全边界：生成文件落盘前有覆盖确认；不执行外部烧录器进程（仅生成脚本供用户执行）；Pack 导入只读 zip 内容并复制到扩展 globalStorage。

## Component Ownership

| Component | Responsibility | May depend on | Must not own |
| --- | --- | --- | --- |
| `src/devices/` | 芯片档案注册表（DeviceProfile）、厂商元数据、校验、Pack 导入持久化 | vendorRegistry、generator 契约 | UI、烧录细节 |
| `src/packs/` | zip 读取、PDSC/SVD 解析、在线索引 | 无 vscode 依赖 | 档案注册（交给 devices） |
| `src/env/` | 本机工具链扫描（ARM GNU/EIDE/Keil/CubeCLT/J-Link/PATH）、ARM bin 路径归一化与文件状态 | node fs（注入式） | 设置写入（交给宿主接线） |
| `src/generator/` | 纯函数字符串生成器（CMake/toolchain/linker/startup/flash/debug） | DeviceProfile、Flash*Profile 契约 | 文件系统、UI |
| `src/generation/` | 生成工作流及显式构建编排；Node 构建执行器管理 CMake 进程、日志、环境与取消 | generator、scanner、integration、shared、Node 进程 API | 芯片数据、烧录执行 |
| `src/integration/buildProject.ts` | 构建命令注册、工作区信任、预设选择、输出和进度 UI | generation 构建工作流、VS Code API | 生成器、芯片数据 |
| `src/integration/toolchainSettings.ts` | ARM GNU 路径选择、有效作用域读写 | env 工具链状态、VS Code API | 编译、系统环境修改 |
| `src/flash/` | 烧录探针、target、后端注册表 | devices 档案（经 debugTarget 桥） | 调用外部进程 |
| `src/scanner/` | 工作区源码/头文件/宏扫描 | vendorRegistry（宏前缀） | — |
| `src/sidebar/` + `src/extension.ts` | 命令/QuickPick/Webview 交互层、状态持久化 | 全部下层注册表 API | 生成逻辑 |
| `src/linux/`、`src/native/` | 独立的 Linux 交叉与桌面方向 | — | MCU 芯片数据 |

## Dependency Direction

生成路径：`sidebar/extension → generation → generator/scanner/integration → devices/flash/packs/env → shared`。构建路径：`sidebar/extension → integration/buildProject → generation/buildWorkflow → generation/buildRunner → CMake`。生成器与解析器无 vscode 依赖；构建命令的 vscode 交互由专用适配器隔离。

## Data And Control Flow

MCU 路径：选芯片（vendor→series→part，来自合并注册表=内置+Pack 导入）→ `getDeviceProfile(part)` → `generateMcuWorkflow` 生成 CMakeLists/toolchain/linker/startup/presets（flash.py 与 launch.json 经烧录后端 openocd/jlink/pyocd 参数化）→ 覆盖确认 → 写盘。烧录 target 经 `DeviceProfile.debugTarget` 桥接到 OpenOCD cfg；无映射的设备走 jlink/pyocd 后端。Pack 导入：zip→PDSC/SVD→DeviceProfile 合成→globalStorage 持久化→注册表注入。

编译路径：用户显式构建→工作区信任与 CMake 文件检查→Debug/Release 选择→子进程 PATH 叠加 ARM GNU bin→CMake 配置→配置成功后编译。输出实时送到构建日志面板，取消终止构建进程树；不启动烧录器。

工具链路径：侧栏输入/浏览/环境扫描→ARM bin 归一化与文件校验→已有有效设置作用域写入→侧栏文件状态、构建子进程以及 MCU 生成时的 IntelliSense/Cortex-Debug 配置。设置更新不执行编译器或修改系统 PATH。

## Cross-Cutting Constraints

- 错误处理：未知 part/target/probe/backend 抛显式 `Unsupported ...` 错误；不静默回退到其它档案。
- 兼容性：`architecture` 仅 `'arm'`（RISC-V 排除）；生成文件名全部来自 profile 字段。
- 性能/资源：注册表启动时构建并全量校验；Pack 解析在导入时一次性完成并持久化。
- 信息卫生：生成内容中不含会话性文字。

## Verification Surfaces

- 自动回归：`npm test`（node --test，纯函数层全覆盖，固件编译用例受 `CMAKE_EMBEDDED_SKIP_FIRMWARE_BUILDS=1` 门控）。
- 操作面验收：VS Code 扩展宿主（F5）侧边栏生成流、生成产物的 cmake+ninja 真实构建、flash.py 语法检查。
