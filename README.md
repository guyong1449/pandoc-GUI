# Pandoc Studio — Obsidian 文档转换插件

在 Obsidian 内选择文档、设置格式、批量转换并查看结果。适合将课程作业、研究笔记和普通文档导出为 PDF、Word、HTML、EPUB 等格式。

**2.0 起，Obsidian 插件直接调用本机 Pandoc，不需要 Python，也不会打开外部 GUI。** 仓库中的 Python 桌面版仍然保留，可独立使用。

## 功能

- 原生 Obsidian 转换面板，自动跟随浅色/深色主题。
- 搜索并添加 Vault 文件、添加当前文档、粘贴多行路径、移除文件。
- 支持完整路径、带引号路径、Markdown 文件链接、`file://`、`obsidian://open`、`[[笔记]]` 和 Vault 相对路径。
- 批量输出 PDF、DOCX、HTML、Markdown、EPUB、LaTeX、纯文本。
- 实时日志、文件级进度、错误提示；可在当前文件完成后停止剩余队列。
- 同名输出自动编号，保留源文件与已有输出。
- PDF 支持字体、A4/Letter、页边距、标题编号、目录和长代码行自动换行。
- Word 支持 `.docx` 参考样式模板。
- HTML 使用 Pandoc 的资源嵌入模式，公式使用 MathML。
- Obsidian 图片嵌入解析、普通 wikilink 转换，以及 `$$` 内 `align/align*` 和公式空行的兼容处理；YAML、代码块和行内代码中的示例保持原样。
- 启用 Pandoc Studio 时，为原生 PDF / Better Export PDF 的打印树补上异步公式重试和完整 MathJax 样式复制。
- 设置页提供 Pandoc / PDF 引擎依赖检测。

## 安装

### 1. 安装本机依赖

| 用途 | 依赖 |
| --- | --- |
| 所有转换 | [Pandoc](https://pandoc.org/installing.html)，建议 3.x |
| PDF 输出 | [MiKTeX](https://miktex.org/download) 或 [TeX Live](https://www.tug.org/texlive/)，提供 XeLaTeX / LuaLaTeX |
| 中文 PDF | 本机中文字体，例如 Windows 的 Microsoft YaHei |

插件只支持 Obsidian 桌面版。主要验证环境为 Windows；Node 代码兼容其他桌面系统，但 macOS/Linux 尚未实机验证。PDF 首次运行可能需要 TeX 安装额外宏包，包括 `fvextra`。Word、HTML 等非 PDF 输出不需要 TeX。

### 2. 安装插件文件

从仓库 `dist/pandoc-studio.zip` 获取安装包，解压后将 `pandoc-studio` 文件夹放入：

```text
你的 Vault/.obsidian/plugins/pandoc-studio/
```

文件夹中应直接包含三个文件：

```text
main.js
manifest.json
styles.css
```

也可手动复制仓库 `obsidian-plugin/` 下这三个文件，不需要 npm 构建。

在 Obsidian 的 **设置 → 第三方插件** 中刷新列表并启用 **Pandoc Studio**。本仓库提供手动安装包，尚未宣称已上架 Obsidian 社区插件市场。

### 3. 配置路径

打开 **设置 → Pandoc Studio**，点击“检测”。如果找不到 Pandoc 或 PDF 引擎，请填写对应可执行文件的完整路径。桌面应用继承的 PATH 可能与终端不同。

从 1.x 升级时替换上述三个文件并关闭再开启插件。原有 `appPath` / `python` 设置不再使用；新的输出目录默认为当前 Vault 的 `Exports`，不会沿用桌面版 Downloads 目录。

## 使用

1. 打开一篇文档，按 `Ctrl+P` 搜索 **Pandoc Studio: 转换当前文档**。
2. 在面板中选择输出格式和目录。需要批量处理时，继续添加库内文件或粘贴路径。
3. 点击“开始转换”，查看进度及日志。
4. 完成后点击“打开输出目录”。

其他入口：文件右键 **使用 Pandoc 转换**、左侧功能区的文档导出图标，以及命令 **打开转换工作台**。

相对输出目录按 Vault 根目录解析，例如 `Exports/课程作业`；也支持 `C:\Users\你的用户名\Downloads` 等完整路径。转换面板中的选项仅用于本次面板；设置页管理后续打开面板时的默认值。

### 粘贴示例

每行一个路径，点击“解析并添加”：

```text
"D:\Notes\Homework 2.md"
课程/算法/作业.md
[[课程/算法/作业]]
file:///D:/Notes/Homework%202.md
obsidian://open?vault=Notes&file=课程%2F算法%2F作业.md
```

`obsidian://` 的 Vault 必须与当前 Vault 一致。普通 wikilink 按 Obsidian 的链接解析规则查找。插件不下载 HTTP/HTTPS 网页地址。

### PDF 与 Word 设置

| 设置 | 说明 |
| --- | --- |
| PDF 引擎 | `xelatex`、`lualatex` 或完整路径 |
| 字体 | 已安装的字体名；留空使用 LaTeX 默认字体 |
| 纸张 | A4 或 Letter |
| 页边距 | 如 `25mm`、`2.5cm`、`1in` |
| 目录 / 标题编号 | 由 Pandoc 根据 Markdown 标题生成 |
| Word 参考模板 | 可选 `.docx` 文件，以其中的样式定义控制导出文档 |

## 支持范围与限制

- 输入支持 Markdown、TXT、DOCX、HTML、LaTeX、RST、EPUB、ODT、ORG、RTF；**PDF 不能作为输入**。
- Obsidian `![[图片.png]]` 会在临时副本中变为标准图片引用。可识别纯数字宽度别名，例如 `![[图片.png|400]]`。实际图片格式支持取决于输出引擎，PDF 推荐 PNG/JPEG。
- 普通 `[[笔记]]` 转为指向原文件的链接。导出文件中的链接不保证能在其他电脑上访问。
- 暂不展开 `![[另一篇笔记]]`、PDF 嵌入、Dataview 查询、Mermaid 图或其他插件的动态渲染结果。遇到不支持的嵌入会显示错误。
- Markdown/LaTeX 输出可能包含原 Vault 图片的绝对路径，复制到别的电脑时应同步图片资源。HTML、Word、PDF、EPUB 是否能嵌入某种资源取决于 Pandoc 与对应引擎。
- 文档结构与数学公式通过 Pandoc 转换；复杂版式无法保证与原文完全相同，详见 [Pandoc 用户手册](https://pandoc.org/MANUAL.html)。
- “停止”会等待当前文件完成，不会强行中断 TeX 写文件。关闭面板不会取消正在执行的任务，完成后仍会通知。卸载插件会停止后续队列。
- 转换在本机执行，但文档中的远程图片等资源可能由 Pandoc 请求。请使用可信文档，尤其是包含原始 LaTeX 的文件。

## 常见问题

**找不到 pandoc / xelatex**：在插件设置填写完整路径并点击检测；确认依赖已安装。

**中文缺字或方框**：选择本机已安装的中文字体；默认字体不适用于所有系统。

**PDF 报宏包缺失**：在 MiKTeX / TeX Live 中安装日志所列宏包后重试。

**`aligned allowed only in math mode`**：升级到 2.0.1 并启用 Obsidian 兼容处理。导出副本会将 `$$` 内的 `align/align*` 转成 `aligned`，移除会让 Pandoc 拆断公式的空行；保留 `%` 注释后的换行及源笔记。

**Better Export PDF 1.11.0 的公式打印不完整**：它的预览未等待异步 CSS 注入结束。可运行 `node tools/repair_pdf_math.js "你的 Vault/.obsidian/plugins/better-export-pdf/main.js"` 安装有备份、版本检查和重复运行保护的等待补丁，再重载该插件。该补丁只适用于经检查的 1.11.0 bundle，其他版本会拒绝修改。

**图片缺失**：先在 Obsidian 中确认链接可用；图片嵌入使用 Vault 链接解析，普通 Markdown 图片按源文档目录与 Vault 目录查找。

**更新后仍弹出 Python 窗口**：当前会话仍运行旧插件，请关闭再开启 Pandoc Studio。

**输出多了 `(1)`**：已有同名文件，插件自动编号以避免覆盖。

## 独立桌面版（可选）

仓库根目录 `app.py` 是保留的 Tkinter 桌面版，采用 Catppuccin Mocha 深色配色。该入口需要 Python 3 + Tkinter 和 Pandoc。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-PandocGUI.ps1
```

或 `python app.py`。桌面版与 Obsidian 2.x 插件是独立入口，不共享界面或全部设置；插件无需安装 Python。

PowerShell 启动器会优先使用用户 `tools/pandoc/pandoc-版本号/` 中最新的官方二进制目录，避免系统 PATH 内旧 Conda Pandoc 抢先。直接运行 `python app.py` 时仍按当前进程 PATH 查找；Obsidian 插件则使用设置中指定的路径。

## 开发与验证

`obsidian-plugin/main.js` 为可直接加载的 CommonJS 文件，`styles.css` 使用 Obsidian 主题变量；`manifest.json` 声明桌面插件及版本。

```sh
node --check obsidian-plugin/main.js
node tests/test_plugin.js
node tests/test_plugin.js --integration
python -m unittest discover -s tests
```

集成测试需要 Pandoc 与 XeLaTeX，会实际生成七种格式，检查 HTML 图片嵌入、重名编号、源文件保留和依赖缺失错误。测试在系统临时目录运行并清理自己的文件。

公式回归在 Python 与 JS 两端复用 `tests/math-cases.json`；设置 `PANDOC_INTEGRATION=1` 可运行 Python 的真实 PDF / Pandoc AST 检查。`node tests/test_export_readiness.js <Better-Export-PDF-1.11.0-main.js>` 先复现旧版 CSS 时序错误，再验证补丁、重复运行与版本保护。可选的 `tests/test_print_math.js <MathJax-JS>` 使用本机 Obsidian 的 MathJax bundle 和通过 `NODE_PATH` 提供的 `jsdom`，检查打印副本、公式重试与样式复制。

```powershell
# 生成可手动安装的 dist/pandoc-studio.zip
.\package-plugin.ps1
```

`tools/repair_pdf_plus.js` 是历史 PDF++ 兼容修复辅助脚本，与 Pandoc Studio 运行无关；插件不会自动修改其他插件。
