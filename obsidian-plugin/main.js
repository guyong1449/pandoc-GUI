const { Plugin, Modal, FuzzySuggestModal, PluginSettingTab, Setting, Notice, MarkdownView, loadMathJax, finishRenderMath } = require('obsidian');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { fileURLToPath } = require('url');
const { spawn } = require('child_process');

const FORMATS = { pdf: 'PDF', docx: 'Word (DOCX)', html: 'HTML', md: 'Markdown', epub: 'EPUB', tex: 'LaTeX', txt: '纯文本' };
const INPUTS = new Set(['md', 'markdown', 'txt', 'docx', 'html', 'htm', 'tex', 'rst', 'epub', 'odt', 'org', 'rtf']);
const DEFAULTS = { pandoc: 'pandoc', engine: 'xelatex', format: 'pdf', output: 'Exports',
  font: process.platform === 'win32' ? 'Microsoft YaHei' : '', pageSize: 'a4', margin: '25mm',
  toc: false, numberSections: false, obsidian: true, referenceDoc: '', cjkFont: '' };

function parsePaths(text, vault, resolveLink) {
  const result = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    const md = line.match(/^\[[^\]]*\]\((.*)\)$/);
    if (md) line = md[1];
    line = line.replace(/^["'<]|["'>]$/g, '');
    if (line.startsWith('file://')) line = fileURLToPath(line);
    else if (line.startsWith('obsidian://')) {
      const url = new URL(line);
      const library = url.searchParams.get('vault');
      if (library && library !== path.basename(vault) && library !== vault) throw new Error('链接属于其他 Vault。');
      line = url.searchParams.get('file');
      if (!line) throw new Error('Obsidian 链接缺少 file 参数。');
    } else if (/^https?:\/\//i.test(line)) throw new Error('暂不下载网页，请使用本地文件或 Obsidian 链接。');
    const wiki = line.match(/^\[\[(.*?)\]\]$/);
    if (wiki) line = wiki[1].split('|')[0].split('#')[0];
    if (/^\/[A-Za-z]:/.test(line)) line = line.slice(1);
    let candidate = path.resolve(vault, line);
    if (!fs.existsSync(candidate) && line.includes('\\_')) candidate = path.resolve(vault, line.replace(/\\_/g, '_'));
    if (!fs.existsSync(candidate) && !path.extname(candidate)) candidate += '.md';
    if (!fs.existsSync(candidate) && resolveLink) candidate = resolveLink(line) || candidate;
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`文件不存在：${line}`);
    if (!INPUTS.has(path.extname(candidate).slice(1).toLowerCase())) throw new Error(`不支持此输入格式：${line}（PDF 不能作为输入）`);
    if (!result.includes(candidate)) result.push(candidate);
  }
  return result;
}

function outsideCode(text, transform) {
  // Keep fenced code and inline code literal during Obsidian syntax normalization.
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/)?.[0] || '';
  return frontmatter + text.slice(frontmatter.length).split(/(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[ \t]*\r?(?:\n|$))/gm)
    .map((part, index) => index % 3 === 0 ? part.split(/(\$\$[\s\S]*?\$\$|`+[^`\n]*`+)/g)
      .map((p, i) => i % 2 && p.startsWith('`') ? p : transform(p)).join('') : index % 3 === 1 ? part : '').join('');
}

function normalizeDisplayMath(text) {
  return text.replace(/(?<!\\)\$\$[\s\S]*?\$\$/g, math => math
    .replace(/\\(begin|end)\{align\*?\}/g, '\\$1{aligned}')
    // Preserve a newline after % comments while removing Pandoc-breaking blank lines.
    .replace(/(\r?\n)[ \t]*(?:\r?\n[ \t]*)+/g, '$1'));
}

async function preparePrintMath(el) {
  // Native PDF export and Better Export PDF both render inside a .print tree.
  // Use the async MathJax API: its synchronous API can throw a font-load retry.
  if (!el.closest('.print')) return;
  const nodes = el.matches('.math') ? [el] : [...el.querySelectorAll('.math')];
  if (!nodes.length) return;
  await loadMathJax();
  const mathjax = globalThis.MathJax;
  if (!mathjax?.tex2chtmlPromise) return;
  let changed = false;
  for (const node of nodes) {
    const source = node.querySelector('mjx-math[data-latex]')?.getAttribute('data-latex')
      || node.querySelector('annotation[encoding="application/x-tex"]')?.textContent
      || (!node.querySelector('mjx-container') ? node.textContent : '');
    if (!/\\begin\{(?:align\*?|aligned)\}/.test(source)) continue;
    if (!node.querySelector('mjx-container') || node.querySelector('mjx-merror')) {
      const rendered = await mathjax.tex2chtmlPromise(source, { display: node.classList.contains('math-block') });
      node.replaceChildren(rendered);
    }
    changed = true;
  }
  if (!changed) return;
  await finishRenderMath();
  // Copy actual CSS rules, including dynamically inserted table/font rules,
  // into the print document; style.textContent alone is incomplete in MathJax 4.
  const sourceStyle = mathjax.chtmlStylesheet();
  const css = mathjax.startup.adaptor.cssText?.(sourceStyle)
    || Array.from(sourceStyle.sheet?.cssRules || [], rule => rule.cssText).join('\n')
    || sourceStyle.textContent;
  const doc = el.ownerDocument;
  let style = doc.getElementById('pandoc-studio-print-math');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'pandoc-studio-print-math';
    doc.head.appendChild(style);
  }
  style.textContent = css;
}

function prepareMarkdown(text, source, resolveLink) {
  return outsideCode(text, block => {
    block = block.replace(/!\[\[([^\]]+)\]\]/g, (_, ref) => {
      const [target, width] = ref.split('|');
      let image = path.resolve(path.dirname(source), target);
      if (!fs.existsSync(image)) image = resolveLink?.(target, source);
      if (!image || !fs.existsSync(image)) throw new Error(`找不到嵌入图片：${target}`);
      if (!/\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(image)) throw new Error(`暂不展开嵌入笔记或 PDF：${target}`);
      return `![](<${image.replace(/\\/g, '/')}>)${/^\d+$/.test(width || '') ? `{width=${width}px}` : ''}`;
    });
    block = block.replace(/\[\[([^\]]+)\]\]/g, (_, ref) => {
      const [target, alias] = ref.split('|');
      const file = resolveLink?.(target.split('#')[0], source);
      const label = (alias || target).replace(/([\[\]])/g, '\\$1');
      return file ? `[${label}](<${file.replace(/\\/g, '/')}>)` : label;
    });
    return normalizeDisplayMath(block);
  });
}

function runProcess(executable, args, cwd, onLog = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', chunk => { output = (output + chunk).slice(-24000); onLog(chunk); });
    }
    child.on('error', error => reject(new Error(`无法启动 ${executable}：${error.message}`)));
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(output.trim() || `进程退出码 ${code}`)));
  });
}

async function convert(source, settings, vault, resolveLink, onLog) {
  if (!Object.hasOwn(FORMATS, settings.format)) throw new Error('请选择有效输出格式。');
  if (!/^\d+(\.\d+)?(mm|cm|in|pt)$/.test(settings.margin)) throw new Error('页边距格式应为 25mm、2.5cm 或 1in。');
  const directory = path.resolve(vault, settings.output || 'Exports');
  await fsp.mkdir(directory, { recursive: true });
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'pandoc-studio-'));
  try {
    let input = source;
    if (settings.obsidian && /\.(md|markdown)$/i.test(source)) {
      input = path.join(temp, 'input.md');
      const text = await fsp.readFile(source, 'utf8');
      await fsp.writeFile(input, prepareMarkdown(text, source, resolveLink), 'utf8');
    }
    const result = path.join(temp, 'result.' + settings.format);
    const args = [input, '--standalone', '--resource-path=' + [path.dirname(source), vault].join(path.delimiter), '-o', result];
    if (settings.toc) args.push('--toc');
    if (settings.numberSections) args.push('--number-sections');
    if (settings.format === 'txt') args.push('-t', 'plain');
    if (settings.format === 'html') args.push('--self-contained', '--mathml');
    if (settings.format === 'docx' && settings.referenceDoc) {
      const reference = path.resolve(vault, settings.referenceDoc);
      if (!fs.existsSync(reference)) throw new Error(`Word 参考模板不存在：${reference}`);
      args.push('--reference-doc=' + reference);
    }
    if (settings.format === 'pdf') {
      const header = path.join(temp, 'layout.tex');
      await fsp.writeFile(header, '\\usepackage{fvextra}\n\\DefineVerbatimEnvironment{Highlighting}{Verbatim}{commandchars=\\\\\\{\\},breaklines=true,breakanywhere=true,fontsize=\\small}\n');
      args.push('--pdf-engine=' + settings.engine, '-V', 'geometry:margin=' + settings.margin, '-V', 'papersize=' + settings.pageSize, '-H', header);
      if (settings.font.trim()) args.push('-V', 'mainfont=' + settings.font.trim());
      if (settings.cjkFont?.trim()) args.push('-V', 'CJKmainfont=' + settings.cjkFont.trim(), '-V', 'CJKoptions=AutoFakeBold=2,AutoFakeSlant=0.2');
    }
    await runProcess(settings.pandoc, args, path.dirname(source), onLog);
    const stem = path.basename(source, path.extname(source));
    for (let i = 0; ; i++) {
      const destination = path.join(directory, `${stem}${i ? ` (${i})` : ''}.${settings.format}`);
      try {
        await fsp.copyFile(result, destination, fs.constants.COPYFILE_EXCL);
        return destination;
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  } finally { await fsp.rm(temp, { recursive: true, force: true }); }
}

class FilePicker extends FuzzySuggestModal {
  constructor(plugin, callback) { super(plugin.app); this.callback = callback; this.setPlaceholder('搜索 Vault 内的文档…'); }
  getItems() { return this.app.vault.getFiles().filter(file => INPUTS.has(file.extension.toLowerCase())); }
  getItemText(file) { return file.path; }
  onChooseItem(file) { this.callback(file); }
}

class ConverterModal extends Modal {
  constructor(plugin, file) {
    super(plugin.app); this.plugin = plugin; this.files = []; this.running = false;
    this.options = { ...plugin.settings };
    if (file && INPUTS.has(file.extension?.toLowerCase())) this.files.push(path.join(plugin.basePath(), file.path));
  }
  onOpen() {
    const el = this.contentEl;
    el.addClass('pandoc-studio'); this.modalEl.addClass('pandoc-studio-modal');
    el.createEl('h2', { text: 'Pandoc Studio' });
    el.createEl('p', { text: '在 Obsidian 内转换文档 · 同名输出自动编号', cls: 'pandoc-hint' });
    const controls = el.createDiv({ cls: 'pandoc-actions' });
    const button = (label, callback) => { const b = controls.createEl('button', { text: label }); b.onclick = callback; return b; };
    button('添加库内文件', () => new FilePicker(this.plugin, file => this.add([path.join(this.plugin.basePath(), file.path)])).open());
    button('添加当前文档', () => { const file = this.app.workspace.getActiveFile(); if (file) { try { this.add(parsePaths(file.path, this.plugin.basePath())); } catch (e) { new Notice(e.message); } } });
    button('清空队列', () => { if (!this.running) { this.files = []; this.renderQueue(); } });
    this.input = el.createEl('textarea', { placeholder: '粘贴路径，每行一个；支持 file://、obsidian://、[[笔记]] 和 Vault 相对路径', cls: 'pandoc-paths' });
    const parse = el.createEl('button', { text: '解析并添加' });
    parse.onclick = () => { try { this.add(parsePaths(this.input.value, this.plugin.basePath(), target => this.plugin.resolve(target))); } catch (e) { new Notice(e.message); } };
    this.queueEl = el.createDiv({ cls: 'pandoc-queue' }); this.renderQueue();
    new Setting(el).setName('输出格式').addDropdown(drop => drop.addOptions(FORMATS).setValue(this.options.format).onChange(value => { this.options.format = value; }));
    new Setting(el).setName('输出目录').setDesc('相对路径按当前 Vault 解析，也可填写完整路径。').addText(text => text.setValue(this.options.output).onChange(value => { this.options.output = value; }));
    new Setting(el).setName('生成目录').addToggle(toggle => toggle.setValue(this.options.toc).onChange(value => { this.options.toc = value; }));
    new Setting(el).setName('Obsidian 图片与公式兼容处理').addToggle(toggle => toggle.setValue(this.options.obsidian).onChange(value => { this.options.obsidian = value; }));
    const actions = el.createDiv({ cls: 'pandoc-actions' });
    this.startButton = actions.createEl('button', { text: '开始转换', cls: 'mod-cta' }); this.startButton.onclick = () => this.start();
    this.stopButton = actions.createEl('button', { text: '完成当前文件后停止' }); this.stopButton.disabled = true;
    this.stopButton.onclick = () => { this.plugin.stopRequested = true; this.status.setText('将在当前文件完成后停止。'); };
    const open = actions.createEl('button', { text: '打开输出目录' });
    open.onclick = async () => {
      const folder = path.resolve(this.plugin.basePath(), this.options.output || 'Exports');
      if (!fs.existsSync(folder)) return new Notice('输出目录尚未创建。');
      const error = await require('electron').shell.openPath(folder); if (error) new Notice(error);
    };
    this.status = el.createDiv({ cls: 'pandoc-status', text: '就绪' });
    this.progress = el.createEl('progress'); this.progress.max = 1; this.progress.value = 0;
    this.log = el.createEl('pre', { cls: 'pandoc-log' });
    el.createEl('p', { cls: 'pandoc-hint', text: '字体、页边距、PDF 引擎和 Word 模板可在插件设置中调整。关闭面板不会终止当前转换。' });
  }
  add(files) { if (this.running) return; for (const file of files) if (!this.files.includes(file)) this.files.push(file); this.renderQueue(); }
  renderQueue() {
    this.queueEl.empty();
    if (!this.files.length) this.queueEl.createDiv({ text: '尚未添加文件', cls: 'pandoc-hint' });
    this.files.forEach(file => {
      const row = this.queueEl.createDiv({ cls: 'pandoc-queue-row' });
      row.createEl('span', { text: file });
      const remove = row.createEl('button', { text: '移除' });
      remove.disabled = this.running;
      remove.onclick = () => { this.files = this.files.filter(f => f !== file); this.renderQueue(); };
    });
  }
  append(text) { this.log.textContent = (this.log.textContent + text).slice(-50000); this.log.scrollTop = this.log.scrollHeight; }
  async start() {
    if (!this.files.length) return new Notice('请先添加文件。');
    if (this.plugin.busy) return new Notice('已有转换任务运行，请等待完成。');
    this.plugin.busy = this.running = true; this.plugin.stopRequested = false;
    this.startButton.disabled = true; this.stopButton.disabled = false; this.renderQueue();
    const files = [...this.files], options = { ...this.options }; let success = 0, failed = 0;
    this.progress.max = files.length; this.progress.value = 0; this.log.textContent = '';
    try {
      await this.app.workspace.getActiveViewOfType(MarkdownView)?.save?.();
      for (const file of files) {
        if (this.plugin.stopRequested) break;
        this.status.setText(`正在转换 ${success + failed + 1}/${files.length}：${path.basename(file)}`);
        try {
          const output = await convert(file, options, this.plugin.basePath(), (target, source) => this.plugin.resolve(target, source), text => this.append(text));
          success++; this.append(`\n完成：${output}\n`);
        } catch (error) { failed++; this.append(`\n失败：${file}\n${error.message}\n`); }
        this.progress.value = success + failed;
      }
    } catch (error) { this.append(error.message + '\n'); }
    finally {
      this.plugin.busy = this.running = false; this.startButton.disabled = false; this.stopButton.disabled = true; this.renderQueue();
      const summary = `成功 ${success}，失败 ${failed}，未处理 ${files.length - success - failed}`;
      this.status.setText(summary); new Notice('Pandoc Studio：' + summary, 8000);
    }
  }
}

class StudioSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl; el.empty();
    el.createEl('h2', { text: 'Pandoc Studio' });
    el.createEl('p', { text: '插件直接调用本机 Pandoc。PDF 还需要 XeLaTeX / LuaLaTeX；不需要 Python。' });
    const save = async (key, value) => { this.plugin.settings[key] = value; await this.plugin.saveData(this.plugin.settings); };
    for (const [key, title, desc] of [
      ['pandoc', 'Pandoc 可执行文件', '可填 pandoc 或完整路径。Windows GUI 的 PATH 可能与终端不同。'],
      ['engine', 'PDF 引擎', 'xelatex、lualatex 或相应可执行文件的完整路径。'],
      ['font', 'PDF 正文字体', '填写本机已安装字体；中英分开设置时，英文字体可填 Times New Roman。'],
      ['cjkFont', 'PDF 中文字体', '可选；华文宋体填 STSong，宋体填 SimSun。启用中文自动换行，留空沿用正文字体。'],
      ['output', '默认输出目录', '默认 Exports，位于当前 Vault；也支持完整路径。'],
      ['margin', 'PDF 页边距', '例如 25mm、2.5cm、1in。'],
      ['referenceDoc', 'Word 参考模板', '可选 .docx 文件，用于定义 Word 样式；支持 Vault 相对路径。']
    ]) new Setting(el).setName(title).setDesc(desc).addText(text => text.setValue(this.plugin.settings[key]).onChange(value => save(key, value.trim())));
    new Setting(el).setName('默认格式').addDropdown(drop => drop.addOptions(FORMATS).setValue(this.plugin.settings.format).onChange(value => save('format', value)));
    new Setting(el).setName('PDF 纸张').addDropdown(drop => drop.addOptions({ a4: 'A4', letter: 'Letter' }).setValue(this.plugin.settings.pageSize).onChange(value => save('pageSize', value)));
    for (const [key, title] of [['toc', '默认生成目录'], ['numberSections', '标题编号'], ['obsidian', '默认启用 Obsidian 兼容处理']])
      new Setting(el).setName(title).addToggle(toggle => toggle.setValue(this.plugin.settings[key]).onChange(value => save(key, value)));
    new Setting(el).setName('检测依赖').setDesc('检查 Pandoc 和所选 PDF 引擎能否启动。').addButton(button => button.setButtonText('检测').onClick(async () => {
      button.setDisabled(true);
      const lines = [];
      for (const command of [this.plugin.settings.pandoc, this.plugin.settings.engine]) {
        try { const output = await runProcess(command, ['--version'], this.plugin.basePath()); lines.push(output.split('\n')[0]); }
        catch (error) { lines.push(error.message); }
      }
      new Notice(lines.join('\n'), 15000); button.setDisabled(false);
    }));
  }
}

module.exports = class PandocStudio extends Plugin {
  async onload() {
    this.settings = { ...DEFAULTS, ...await this.loadData() };
    this.busy = false; this.stopRequested = false;
    this.registerMarkdownPostProcessor(preparePrintMath, 1000);
    this.addCommand({ id: 'convert-current', name: '转换当前文档', callback: () => new ConverterModal(this, this.app.workspace.getActiveFile()).open() });
    this.addCommand({ id: 'open-converter', name: '打开转换工作台', callback: () => new ConverterModal(this).open() });
    this.addRibbonIcon('file-output', 'Pandoc Studio', () => new ConverterModal(this, this.app.workspace.getActiveFile()).open());
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (INPUTS.has(file.extension?.toLowerCase())) menu.addItem(item => item.setTitle('使用 Pandoc 转换').setIcon('file-output').onClick(() => new ConverterModal(this, file).open()));
    }));
    this.addSettingTab(new StudioSettings(this.app, this));
  }
  basePath() { return this.app.vault.adapter.getBasePath(); }
  resolve(target, source = '') {
    const relative = source ? path.relative(this.basePath(), source).replace(/\\/g, '/') : '';
    const file = this.app.metadataCache.getFirstLinkpathDest(target, relative);
    return file ? path.join(this.basePath(), file.path) : null;
  }
  onunload() { this.stopRequested = true; }
};
module.exports.core = { parsePaths, prepareMarkdown, preparePrintMath, convert, runProcess, DEFAULTS, FORMATS };
