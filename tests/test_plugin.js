const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
let launched;
let saved = false;
class Plugin {
  async loadData() { return {}; }
  addCommand() {}
  addRibbonIcon() {}
  registerEvent() {}
  addSettingTab() {}
}
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../obsidian-plugin/main.js'), 'utf8'), {
  module: moduleStub,
  require(name) {
    if (name === 'obsidian') return { Plugin, PluginSettingTab: class {}, MarkdownView: class {}, Notice: class {} };
    if (name === 'child_process') return { spawn(executable, args, options) {
      launched = { executable, args, options };
      return { on() {}, unref() {} };
    } };
    if (name === 'fs') return { existsSync: () => true };
    return require(name);
  }
});
(async () => {
  const plugin = new moduleStub.exports();
  plugin.app = {
    workspace: { on() {}, getActiveViewOfType() { return { async save() { saved = true; } }; } },
    vault: { adapter: { getBasePath() { return 'E:\\Vault with spaces'; } } }
  };
  await plugin.onload();
  await plugin.launch({ path: 'notes/中文 & test.md', extension: 'md' });
  assert(saved);
  assert.equal(launched.options.shell, false);
  assert.equal(launched.args[1], '--vault');
  assert.equal(launched.args[2], 'E:\\Vault with spaces');
  assert.equal(launched.args[3], '--input');
  assert(launched.args[4].endsWith('中文 & test.md'));
  launched = undefined;
  await plugin.launch({ extension: 'pdf' });
  assert.equal(launched, undefined);
  console.log('Plugin bridge: editor save, path arguments, no-shell launch and PDF input guard passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
