const { Plugin, PluginSettingTab, Setting, Notice, MarkdownView } = require('obsidian');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

module.exports = class PandocStudio extends Plugin {
  async onload() {
    this.settings = Object.assign({
      appPath: path.join(os.homedir(), 'tools', 'pandoc-GUI', 'app.py'),
      python: 'pythonw.exe'
    }, await this.loadData());
    this.addCommand({ id: 'convert-current', name: '转换当前文档', callback: () => this.launch(this.app.workspace.getActiveFile()) });
    this.addCommand({ id: 'open-converter', name: '打开转换工作台', callback: () => this.launch() });
    this.addRibbonIcon('file-output', 'Pandoc Studio', () => this.launch(this.app.workspace.getActiveFile()));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file.extension && file.extension !== 'pdf') {
        menu.addItem(item => item.setTitle('使用 Pandoc 转换').setIcon('file-output').onClick(() => this.launch(file)));
      }
    }));
    this.addSettingTab(new StudioSettings(this.app, this));
  }
  async launch(file) {
    if (!fs.existsSync(this.settings.appPath)) {
      new Notice('请在 Pandoc Studio 设置中指定 app.py 路径。');
      return;
    }
    if (file?.extension === 'pdf') {
      new Notice('Pandoc 不支持 PDF 输入，请选择原始文档。');
      return;
    }
    const vault = this.app.vault.adapter.getBasePath();
    // Save editor contents before the external converter reads the file.
    await this.app.workspace.getActiveViewOfType(MarkdownView)?.save?.();
    const args = [this.settings.appPath, '--vault', vault];
    if (file) args.push('--input', path.join(vault, file.path));
    const child = spawn(this.settings.python, args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
    child.on('error', error => new Notice(`无法启动 Pandoc：${error.message}`));
    child.on('spawn', () => { child.unref(); new Notice('已打开 Pandoc Studio'); });
  }
};

class StudioSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl;
    el.empty();
    el.createEl('h2', { text: 'Pandoc Studio' });
    el.createEl('p', { text: '从当前文档、文件右键菜单或侧边栏启动本机转换窗口。Vault 路径自动传入。' });
    for (const [key, title] of [['appPath', '转换程序 app.py 路径'], ['python', 'Python 可执行文件']]) {
      new Setting(el).setName(title).addText(text => text.setValue(this.plugin.settings[key]).onChange(async value => {
        this.plugin.settings[key] = value;
        await this.plugin.saveData(this.plugin.settings);
      }));
    }
  }
}
