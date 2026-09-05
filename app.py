"""A small Windows desktop interface for Pandoc."""
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

FORMATS = {'PDF': '.pdf', 'Word (DOCX)': '.docx', 'HTML': '.html',
           'Markdown': '.md', 'EPUB': '.epub', 'LaTeX': '.tex', '纯文本': '.txt'}


def prepare_markdown(source, directory):
    """Resolve Obsidian image embeds without changing the source note."""
    content = source.read_text(encoding='utf-8-sig')
    roots = [source.parent]
    for parent in source.parents:
        if (parent / '.obsidian').is_dir():
            roots.append(parent)
            break

    def replace(match):
        target = match[1].split('|')[0]
        candidate = source.parent / target
        if not candidate.is_file():
            matches = list(roots[-1].rglob(Path(target).name))
            matches = [p for p in matches if p.is_file()]
            if len(matches) != 1:
                raise ValueError(f'图片不存在或存在重名：{target}')
            candidate = matches[0]
        if candidate.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'}:
            raise ValueError(f'暂不支持此 Obsidian 嵌入类型：{target}')
        return f'![](<{candidate.resolve().as_posix()}>)'

    content = re.sub(r'!\[\[([^\]]+)\]\]', replace, content)
    # Obsidian accepts align inside $$; LaTeX requires aligned there.
    def normalize_math(match):
        block = match[0]
        for environment in ('align*', 'align'):
            block = block.replace('\\begin{' + environment + '}', '\\begin{aligned}')
            block = block.replace('\\end{' + environment + '}', '\\end{aligned}')
        return block
    content = re.sub(r'\$\$[\s\S]*?\$\$', normalize_math, content)
    result = directory / source.name
    result.write_text(content, encoding='utf-8')
    return result


def convert(source, output, fmt, engine, font, obsidian):
    pandoc = shutil.which('pandoc')
    if not pandoc:
        raise RuntimeError('找不到 Pandoc，请安装并加入 PATH。')
    if fmt == 'PDF' and not shutil.which(engine):
        raise RuntimeError(f'找不到 PDF 引擎 {engine}，请安装 MiKTeX 或 TeX Live。')
    with tempfile.TemporaryDirectory(prefix='pandoc-gui-') as temp:
        directory = Path(temp)
        actual = prepare_markdown(source, directory) if obsidian and source.suffix.lower() == '.md' else source
        result = directory / ('result' + FORMATS[fmt])
        command = [pandoc, str(actual), '--standalone', '--resource-path=' + str(source.parent), '-o', str(result)]
        if fmt == 'PDF':
            header = directory / 'layout.tex'
            header.write_text('\\usepackage{fvextra}\n\\DefineVerbatimEnvironment{Highlighting}{Verbatim}{commandchars=\\\\\\{\\},breaklines=true,breakanywhere=true,fontsize=\\small}\n', encoding='utf-8')
            command += ['--pdf-engine=' + engine, '-V', 'geometry:margin=1in', '-V', 'fontsize=11pt', '-H', str(header)]
            if font.strip():
                command += ['-V', 'mainfont=' + font.strip()]
        if fmt == '纯文本':
            command += ['-t', 'plain']
        proc = subprocess.run(command, cwd=source.parent, capture_output=True, encoding='utf-8', errors='replace', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if proc.returncode:
            raise RuntimeError(proc.stderr.strip() or f'Pandoc 退出码：{proc.returncode}')
        # Exclusive creation protects existing files, even if another process created one.
        with result.open('rb') as src, output.open('xb') as dst:
            shutil.copyfileobj(src, dst)
        return proc.stderr.strip()


class App:
    def __init__(self, root):
        self.root = root
        root.title('Pandoc GUI · 文档转换')
        root.geometry('850x680')
        root.minsize(720, 560)
        self.files = []
        self.events = queue.Queue()
        self.busy = False
        self.format = tk.StringVar(value='PDF')
        self.folder = tk.StringVar(value=str(Path.home() / 'Downloads'))
        self.engine = tk.StringVar(value='xelatex')
        self.font = tk.StringVar(value='Microsoft YaHei')
        self.obsidian = tk.BooleanVar(value=True)
        self.status = tk.StringVar(value='选择文件，设置格式，然后开始转换。')
        frame = ttk.Frame(root, padding=20)
        frame.pack(fill='both', expand=True)
        ttk.Label(frame, text='文档转换', font=('Microsoft YaHei UI', 22, 'bold')).pack(anchor='w')
        ttk.Label(frame, text='Pandoc · 批量转换 · 自动保留已有文件').pack(anchor='w', pady=(0, 12))
        row = ttk.Frame(frame)
        row.pack(fill='x')
        ttk.Button(row, text='添加文件…', command=self.add).pack(side='left')
        ttk.Button(row, text='移除选中', command=self.remove).pack(side='left', padx=8)
        self.listbox = tk.Listbox(frame, height=7, selectmode='extended', font=('Microsoft YaHei UI', 10))
        self.listbox.pack(fill='both', expand=True, pady=8)
        settings = ttk.Frame(frame)
        settings.pack(fill='x')
        settings.columnconfigure(1, weight=1)
        ttk.Label(settings, text='输出格式').grid(row=0, column=0, sticky='w', padx=(0, 12), pady=5)
        ttk.Combobox(settings, textvariable=self.format, values=list(FORMATS), state='readonly').grid(row=0, column=1, sticky='ew')
        ttk.Label(settings, text='保存位置').grid(row=1, column=0, sticky='w', pady=5)
        ttk.Entry(settings, textvariable=self.folder).grid(row=1, column=1, sticky='ew')
        ttk.Button(settings, text='选择…', command=self.choose_folder).grid(row=1, column=2, padx=(8, 0))
        ttk.Label(settings, text='PDF 引擎').grid(row=2, column=0, sticky='w', pady=5)
        ttk.Combobox(settings, textvariable=self.engine, values=['xelatex', 'lualatex'], state='readonly').grid(row=2, column=1, sticky='ew')
        ttk.Label(settings, text='PDF 字体').grid(row=3, column=0, sticky='w', pady=5)
        ttk.Entry(settings, textvariable=self.font).grid(row=3, column=1, sticky='ew')
        ttk.Checkbutton(frame, text='解析 Obsidian 图片引用 ![[图片]]（在所属 Vault 内查找）', variable=self.obsidian).pack(anchor='w', pady=8)
        actions = ttk.Frame(frame)
        actions.pack(fill='x')
        self.start = ttk.Button(actions, text='开始转换', command=self.run)
        self.start.pack(side='left')
        ttk.Button(actions, text='打开输出文件夹', command=self.open_folder).pack(side='left', padx=8)
        self.progress = ttk.Progressbar(frame, mode='determinate')
        self.progress.pack(fill='x', pady=10)
        ttk.Label(frame, textvariable=self.status).pack(anchor='w')
        self.log = tk.Text(frame, height=8, wrap='word', state='disabled', font=('Microsoft YaHei UI', 9))
        self.log.pack(fill='both', expand=True, pady=(8, 0))
        root.protocol('WM_DELETE_WINDOW', self.close)
        root.after(100, self.poll)

    def add(self):
        for name in filedialog.askopenfilenames(filetypes=[('可转换文档', '*.md *.markdown *.docx *.html *.htm *.tex *.rst *.epub *.odt *.txt'), ('所有文件', '*.*')]):
            if name not in self.files:
                self.files.append(name)
                self.listbox.insert('end', name)

    def remove(self):
        for index in reversed(self.listbox.curselection()):
            del self.files[index]
            self.listbox.delete(index)

    def choose_folder(self):
        folder = filedialog.askdirectory()
        if folder:
            self.folder.set(folder)

    def open_folder(self):
        folder = Path(self.folder.get())
        if folder.is_dir():
            os.startfile(folder)
        else:
            messagebox.showinfo('保存位置', '此文件夹尚不存在，转换时会创建。')

    def run(self):
        if not self.files:
            messagebox.showinfo('选择文件', '请先添加要转换的文件。')
            return
        if not self.folder.get().strip():
            messagebox.showerror('保存位置', '请指定输出文件夹。')
            return
        options = (self.format.get(), self.engine.get(), self.font.get(), self.obsidian.get())
        self.busy = True
        self.start.config(state='disabled')
        self.progress.config(maximum=len(self.files), value=0)
        threading.Thread(target=self.worker, args=(list(self.files), Path(self.folder.get()), options), daemon=True).start()

    def worker(self, files, folder, options):
        successes = 0
        try:
            folder.mkdir(parents=True, exist_ok=True)
            for i, name in enumerate(files):
                source = Path(name)
                output = folder / (source.stem + FORMATS[options[0]])
                counter = 1
                while output.exists():
                    output = folder / f'{source.stem} ({counter}){FORMATS[options[0]]}'
                    counter += 1
                self.events.put(('status', f'正在转换 {i + 1}/{len(files)}：{source.name}'))
                try:
                    warning = convert(source, output, *options)
                    successes += 1
                    self.events.put(('log', f'完成：{output}\n' + (warning + '\n' if warning else '')))
                except Exception as error:
                    self.events.put(('log', f'失败：{source.name}\n{error}\n'))
                self.events.put(('progress', i + 1))
        except Exception as error:
            self.events.put(('log', str(error) + '\n'))
        finally:
            self.events.put(('done', f'转换结束：成功 {successes}，失败 {len(files) - successes}。'))

    def poll(self):
        while not self.events.empty():
            kind, value = self.events.get_nowait()
            if kind == 'log':
                self.log.config(state='normal')
                self.log.insert('end', value + '\n')
                self.log.see('end')
                self.log.config(state='disabled')
            elif kind == 'progress':
                self.progress.config(value=value)
            else:
                self.status.set(value)
                if kind == 'done':
                    self.busy = False
                    self.start.config(state='normal')
        self.root.after(100, self.poll)

    def close(self):
        if self.busy:
            messagebox.showinfo('正在转换', '请等待本批转换结束后关闭窗口。')
        else:
            self.root.destroy()


if __name__ == '__main__':
    window = tk.Tk()
    App(window)
    window.mainloop()
