# Pandoc GUI

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
