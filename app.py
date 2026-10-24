"""A small Windows desktop interface for Pandoc."""
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import argparse
from urllib.parse import urlparse, unquote, parse_qs
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

FORMATS = {'PDF': '.pdf', 'Word (DOCX)': '.docx', 'HTML': '.html',
           'Markdown': '.md', 'EPUB': '.epub', 'LaTeX': '.tex', '纯文本': '.txt'}

COLORS = dict(bg='#1e1e2e', surface='#313244', overlay='#45475a',
              text='#cdd6f4', subtext='#a6adc8', blue='#89b4fa',
              green='#a6e3a1', mantle='#181825', red='#f38ba8')


def parse_paths(text, vault):
    """Accept one local path/link per line, including Explorer's quoted paths."""
    paths = []
    for line in text.splitlines():
        value = line.strip().strip('"').strip("'")
        if not value:
            continue
        markdown = re.fullmatch(r'\[[^\]]*\]\((.*?)\)', value)
        if markdown:
            value = markdown[1].strip('<>')
        value = value.strip('<>')
        if value.startswith('obsidian://'):
            query = parse_qs(urlparse(value).query)
            linked_vault = query.get('vault', [''])[0]
            if linked_vault and linked_vault not in {Path(vault).name, str(vault)}:
                raise ValueError('此 Obsidian 链接属于其他 Vault，请先切换 Vault。')
            value = query.get('file', [''])[0]
            if not value:
                raise ValueError('Obsidian 链接缺少 file 参数。')
        elif value.startswith('file://'):
            url = urlparse(value)
            value = unquote(url.path)
            if url.netloc and url.netloc != 'localhost':
                value = '//' + url.netloc + value
            elif re.match(r'^/[A-Za-z]:', value):
                value = value[1:]
        elif re.match(r'^https?://', value):
            raise ValueError('请粘贴本地文件路径、file:// 或 Obsidian 链接；暂不下载网页。')
        if value.startswith('[[') and value.endswith(']]'):
            value = value[2:-2].split('|')[0].split('#')[0]
        path = Path(value).expanduser()
        if re.match(r'^/[A-Za-z]:', value):
            path = Path(value[1:])
        if not path.is_absolute():
            path = Path(vault) / path
        if not path.exists() and '\\_' in value:
            # Only interpret Markdown escapes when the literal path is absent.
            alternate = Path(value.replace('\\_', '_'))
            path = alternate if alternate.is_absolute() else Path(vault) / alternate
        if not path.exists() and not path.suffix:
            path = path.with_suffix('.md')
        if not path.is_file():
            raise ValueError(f'文件不存在：{path}')
        if path.suffix.lower() == '.pdf':
            raise ValueError('Pandoc 不支持以 PDF 为输入，请选择原始文档。')
        if path.resolve() not in paths:
            paths.append(path.resolve())
    return paths


def apply_theme(root):
    root.configure(bg=COLORS['bg'])
    root.option_add('*Font', ('Microsoft YaHei UI', 10))
    root.option_add('*TCombobox*Listbox.background', COLORS['surface'])
    root.option_add('*TCombobox*Listbox.foreground', COLORS['text'])
    style = ttk.Style(root)
    style.theme_use('clam')
    style.configure('.', background=COLORS['bg'], foreground=COLORS['text'])
    style.configure('TFrame', background=COLORS['bg'])
    style.configure('Card.TFrame', background=COLORS['surface'])
    style.configure('TLabel', background=COLORS['bg'], foreground=COLORS['text'])
    style.configure('Muted.TLabel', foreground=COLORS['subtext'])
    style.configure('TButton', background=COLORS['overlay'], foreground=COLORS['text'], borderwidth=0, padding=(12, 7))
    style.map('TButton', background=[('active', COLORS['blue'])], foreground=[('active', COLORS['bg'])])
    style.configure('Go.TButton', background=COLORS['green'], foreground=COLORS['bg'])
    style.map('Go.TButton', background=[('disabled', COLORS['overlay']), ('active', COLORS['blue'])])
    for name in ('TEntry', 'TCombobox'):
        style.configure(name, fieldbackground=COLORS['surface'], foreground=COLORS['text'], padding=5, bordercolor=COLORS['overlay'], arrowcolor=COLORS['blue'])
        style.map(name, fieldbackground=[('readonly', COLORS['surface'])], foreground=[('readonly', COLORS['text'])])
    style.configure('TCheckbutton', background=COLORS['bg'], foreground=COLORS['text'])
    style.map('TCheckbutton', background=[('active', COLORS['bg'])])
    style.configure('Horizontal.TProgressbar', background=COLORS['green'], troughcolor=COLORS['surface'], borderwidth=0)


def outside_code(text, transform):
    """Apply export fixes to prose/math while preserving YAML and code examples."""
    frontmatter = re.match(r'\A---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)', text)
    prefix = frontmatter[0] if frontmatter else ''
    text = text[len(prefix):]
    parts = re.split(r'(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[ \t]*\r?(?:\n|$))', text, flags=re.M)
    result = []
    for index, part in enumerate(parts):
        if index % 3 == 1:
            result.append(part)
        elif index % 3 == 0:
            # Treat an entire math block as one token, including TeX backticks.
            tokens = re.split(r'(\$\$[\s\S]*?\$\$|`+[^`\n]*`+)', part)
            result.extend(token if i % 2 and token.startswith('`') else transform(token)
                          for i, token in enumerate(tokens))
    return prefix + ''.join(result)


def normalize_display_math(text):
    def normalize(match):
        math = re.sub(r'\\(begin|end)\{align\*?\}', lambda m: '\\' + m[1] + '{aligned}', match[0])
        # Pandoc ends a display-math block at a blank line. Keep a newline so
        # a TeX % comment cannot swallow the following equation or row break.
        return re.sub(r'(\r?\n)[ \t]*(?:\r?\n[ \t]*)+', r'\1', math)
    return re.sub(r'(?<!\\)\$\$[\s\S]*?\$\$', normalize, text)


def prepare_markdown(source, directory):
    """Resolve Obsidian image embeds without changing the source note."""
    content = source.read_bytes().decode('utf-8-sig')
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

    content = outside_code(content, lambda block: normalize_display_math(
        re.sub(r'!\[\[([^\]]+)\]\]', replace, block)))
    result = directory / source.name
    result.write_bytes(content.encode('utf-8'))
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
    def __init__(self, root, vault=None, inputs=()):
        self.root = root
        apply_theme(root)
        root.title('Pandoc GUI · 文档转换')
        root.geometry('880x850')
        root.minsize(760, 750)
        self.vault = tk.StringVar(value=str(vault or Path.home()))
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
        ttk.Label(frame, text='Pandoc Studio', font=('Segoe UI', 22, 'bold')).pack(anchor='w')
        ttk.Label(frame, text='文档转换  /  Obsidian 工作台', style='Muted.TLabel').pack(anchor='w', pady=(0, 12))
        vault_row = ttk.Frame(frame)
        vault_row.pack(fill='x', pady=(0, 8))
        ttk.Label(vault_row, text='Vault  ').pack(side='left')
        ttk.Entry(vault_row, textvariable=self.vault).pack(side='left', fill='x', expand=True)
        ttk.Button(vault_row, text='选择库', command=self.choose_vault).pack(side='left', padx=(8, 0))
        ttk.Label(frame, text='粘贴路径或链接 · 每行一个 · 支持带引号路径、file://、obsidian://', style='Muted.TLabel').pack(anchor='w')
        self.path_input = tk.Text(frame, height=3, wrap='none', bg=COLORS['mantle'], fg=COLORS['text'], insertbackground=COLORS['blue'], relief='flat', padx=10, pady=8)
        self.path_input.pack(fill='x', pady=8)
        self.path_input.bind('<Control-Return>', lambda event: self.parse_input())
        row = ttk.Frame(frame)
        row.pack(fill='x')
        ttk.Button(row, text='添加文件…', command=self.add).pack(side='left')
        ttk.Button(row, text='解析输入', command=self.parse_input).pack(side='left', padx=(8, 0))
        ttk.Button(row, text='粘贴并解析', command=self.paste).pack(side='left', padx=(8, 0))
        ttk.Button(row, text='移除选中', command=self.remove).pack(side='left', padx=8)
        self.listbox = tk.Listbox(frame, height=5, selectmode='extended', font=('Microsoft YaHei UI', 10), bg=COLORS['surface'], fg=COLORS['text'], selectbackground=COLORS['blue'], selectforeground=COLORS['bg'], relief='flat', highlightthickness=0)
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
        self.start = ttk.Button(actions, text='开始转换', command=self.run, style='Go.TButton')
        self.start.pack(side='left')
        ttk.Button(actions, text='打开输出文件夹', command=self.open_folder).pack(side='left', padx=8)
        self.progress = ttk.Progressbar(frame, mode='determinate')
        self.progress.pack(fill='x', pady=10)
        ttk.Label(frame, textvariable=self.status).pack(anchor='w')
        self.log = tk.Text(frame, height=6, wrap='word', state='disabled', font=('Microsoft YaHei UI', 9), bg=COLORS['mantle'], fg=COLORS['subtext'], relief='flat', padx=10, pady=8)
        self.log.pack(fill='both', expand=True, pady=(8, 0))
        root.protocol('WM_DELETE_WINDOW', self.close)
        root.after(100, self.poll)
        for name in inputs:
            self.add_path(Path(name))

    def add_path(self, path):
        if not path.is_file():
            messagebox.showerror('文件路径', f'文件不存在：{path}')
            return
        name = str(path.resolve())
        if name not in self.files:
            self.files.append(name)
            self.listbox.insert('end', name)

    def choose_vault(self):
        folder = filedialog.askdirectory(title='选择 Obsidian Vault')
        if folder:
            self.vault.set(folder)

    def parse_input(self):
        try:
            paths = parse_paths(self.path_input.get('1.0', 'end'), self.vault.get())
            for path in paths:
                self.add_path(path)
            self.status.set(f'已解析 {len(paths)} 个文件，队列共 {len(self.files)} 个。')
        except ValueError as error:
            messagebox.showerror('路径解析', str(error))

    def paste(self):
        try:
            value = self.root.clipboard_get()
        except tk.TclError:
            messagebox.showinfo('剪贴板', '剪贴板中没有文本。')
            return
        self.path_input.delete('1.0', 'end')
        self.path_input.insert('1.0', value)
        self.parse_input()

    def add(self):
        for name in filedialog.askopenfilenames(filetypes=[('可转换文档', '*.md *.markdown *.docx *.html *.htm *.tex *.rst *.epub *.odt *.txt'), ('所有文件', '*.*')]):
            self.add_path(Path(name))

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
    parser = argparse.ArgumentParser(description='Pandoc desktop converter')
    parser.add_argument('--vault', default=str(Path.home()))
    parser.add_argument('--input', action='append', default=[])
    args = parser.parse_args()
    window = tk.Tk()
    App(window, args.vault, args.input)
    window.mainloop()
