# CMake-Embedded Architecture

## Purpose

VS Code 扩展：为桌面 C/C++、MCU 固件、Linux/SoC 交叉编译生成可构建的 CMake 工程。芯片知识集中在数据注册表，生成器完全由档案（profile）驱动。

## System Context

- 用户与外部系统：嵌入式开发者在 VS Code 侧边栏/命令面板选择方向与芯片；扩展读写工作区文件并生成 `.vscode/` 配置；配置与编译由 CMake Tools 负责，烧录/调试依赖用户 PATH 或设置中的 OpenOCD、arm-none-eabi、J-Link、pyOCD；CMSIS Pack 来自内置虚拟 Pack、本地文件、Keil 安装库或 keil.com 索引。
- 运行与部署目标：VS Code 扩展宿主（Node，`engines.vscode ^1.85`），`main: ./out/extension.js`，tsc 编译，无打包器。
- 信任与安全边界：生成文件落盘前有覆盖确认；不执行外部烧录器进程（仅生成脚本供用户执行）；Pack 导入只读 zip 内容并复制到扩展 globalStorage。

## Component Ownership

| Component | Responsibility | May depend on | Must not own |
| --- | --- | --- | --- |
| `src/devices/` | 芯片档案注册表（DeviceProfile）、厂商元数据、校验、Pack 导入持久化 | vendorRegistry、generator 契约 | UI、烧录细节 |
| `src/packs/` | zip 读取、PDSC/SVD 解析、已安装 Pack 身份解析、在线索引 | 无 vscode 依赖 | 档案注册（交给 devices） |
| `src/env/` | Keil Pack 目录发现、独立工具链扫描算法（Pack/兼容测试使用） | node fs（注入式） | 设置写入、身份解析（交给 packs） |
| `src/generator/` | 纯函数字符串生成器（CMake/toolchain/linker/startup/flash/debug） | DeviceProfile、Flash*Profile 契约 | 文件系统、UI |
| `src/generation/` | 生成工作流编排 | generator、scanner、integration、shared | 芯片数据、烧录执行、编译执行 |
| `src/integration/` | 生成产物的宿主接线（C/C++ IntelliSense、工作区设置写入） | generator 契约、VS Code API | 生成器逻辑、芯片数据、编译执行 |
| `src/flash/` | 烧录探针、target、后端注册表 | devices 档案（经 debugTarget 桥） | 调用外部进程 |
| `src/scanner/` | 工作区源码/头文件/宏扫描 | vendorRegistry（宏前缀） | — |
| `src/sidebar/` + `src/extension.ts` | 命令/QuickPick/Webview 交互层、状态持久化 | 全部下层注册表 API | 生成逻辑 |
| `src/linux/`、`src/native/` | 独立的 Linux 交叉与桌面方向 | — | MCU 芯片数据 |

## Dependency Direction

生成路径：`sidebar/extension → generation → generator/scanner/integration → devices/flash/packs/env → shared`。插件没有构建路径：生成结束后由 CMake Tools 读取生成的 `CMakeLists.txt`、预设和工具链文件完成配置与编译。生成器与解析器无 vscode 依赖；宿主交互由 `sidebar/` 与 `extension.ts` 隔离。

## Data And Control Flow

MCU 路径：目录加载（vendor→pack→version：内置虚拟 Pack、已安装 PDSC 身份、已导入记录、在线版本）→ 选择版本激活并按其所有权取档案 → `getDeviceProfileForPack` → `generateMcuWorkflow` 生成 CMakeLists/toolchain/linker/startup/presets（flash.py 与 launch.json 经烧录后端 openocd/jlink/pyocd 参数化）→ 覆盖确认 → 写盘。烧录 target 经 `DeviceProfile.debugTarget` 桥接到 OpenOCD cfg；无映射的设备走 jlink/pyocd 后端。Pack 导入：zip 或解压目录→PDSC/SVD→DeviceProfile 合成→globalStorage 持久化→注册表注入；identity 与 profile 所有权都以导入存储路径为准。

编译路径：生成的工程文件交给 CMake Tools，由用户在其 UI 或 `cmake --preset` 中配置和编译；插件不启动编译器进程。

工具链路径：插件不保存 ARM GNU 路径。生成的工具链文件、Cortex-Debug 配置和 IntelliSense 只写 `arm-none-eabi-*` 命令名，解析交给 `PATH` 或 CMake Tools kit。

## Cross-Cutting Constraints

- 错误处理：未知 part/target/probe/backend 抛显式 `Unsupported ...` 错误；不静默回退到其它档案。
- 兼容性：`architecture` 仅 `'arm'`（RISC-V 排除）；生成文件名全部来自 profile 字段。
- 性能/资源：注册表启动时构建并全量校验；Pack 解析在导入时一次性完成并持久化。
- 信息卫生：生成内容中不含会话性文字。

## Verification Surfaces

- 自动回归：`npm test`（node --test，纯函数层全覆盖，固件编译用例受 `CMAKE_EMBEDDED_SKIP_FIRMWARE_BUILDS=1` 门控）。
- 操作面验收：VS Code 扩展宿主（F5）侧边栏生成流、生成产物的 cmake+ninja 真实构建、flash.py 语法检查。
