# Pandoc GUI

界面采用 Catppuccin Mocha 深色配色，参考 VPN Auto-Connect 的深色分区和浅绿主按钮。

## 粘贴路径

可在窗口上方输入区直接粘贴，每行一个文件，点击“解析输入”（或 Ctrl+Enter）；“粘贴并解析”会读取剪贴板。

支持 Windows 完整路径（含引号和空格）、Markdown 文件链接、`file://`、`obsidian://open?file=...` 和 Vault 相对路径。相对路径按窗口中的 Vault 定位。HTTP/HTTPS 网页地址暂不下载；PDF 不能作为 Pandoc 输入。

## Obsidian 插件

将 `obsidian-plugin` 中的 `manifest.json`、`main.js` 复制到 Vault 的 `.obsidian/plugins/pandoc-studio/`，然后在 Obsidian 第三方插件中启用 Pandoc Studio。

- 命令面板：`Pandoc Studio: 转换当前文档` 或 `打开转换工作台`。
- 文件右键：`使用 Pandoc 转换`。
- 功能区：文档导出图标。

插件是桌面桥接入口，会打开本机 Pandoc 窗口并自动带入当前文档和 Vault，在窗口中选择输出格式和位置。仅支持桌面版，依赖本机 Python 和 Pandoc。可在插件设置中指定 Python 可执行文件及 `app.py` 的完整路径。插件使用参数数组调用进程，不将笔记路径拼接到 shell 命令中。

PowerShell 启动器也支持 `-Vault "你的 Vault 完整路径"`。

Windows 上的轻量文档转换界面，使用 Python 标准库 Tkinter 和 Pandoc。

## 启动

需要 Python 3（包含 Tkinter）和 Pandoc，并加入 PATH。转换 PDF 还需要 MiKTeX 或 TeX Live 提供 XeLaTeX / LuaLaTeX。首次生成 PDF 时，TeX 可能需要安装缺失的包（包括 fvextra）。

右键 `Start-PandocGUI.ps1`，选择“使用 PowerShell 运行”，或执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-PandocGUI.ps1
```

也可以运行 `python app.py`。

## 使用

1. 添加一个或多个源文件。
2. 选择 PDF、Word、HTML、Markdown、EPUB、LaTeX 或纯文本。
3. 指定输出目录；默认是用户 Downloads。
4. PDF 可选择引擎及已安装的字体，默认 Microsoft YaHei，以支持中文。
5. 点击“开始转换”，在下方查看进度及错误详情。

已有同名文件会自动编号，不会覆盖。源文件保持不变。程序不支持将 PDF 作为输入；具体输入与输出能力取决于 Pandoc，复杂 Word 或 HTML 的布局不保证原样保留。HTML 的普通相对图片仍可能依赖原图片资源。

Obsidian Markdown 图片嵌入会在转换副本中解析，先查找相对路径，再在带 `.obsidian` 的所属 Vault 下按图片名查找。遇到缺图或重名会报告错误。仅支持图片嵌入，不展开其他笔记。PDF 代码块自动换行。

转换在本机完成。请仅转换可信文档，尤其是包含原始 LaTeX 的文件。输出完成前请等待当前批次结束。

启用 Obsidian 处理时，也会将 `$$` 内的 `align` / `align*` 转为 LaTeX 支持的 `aligned`，避免公式嵌套报错。
