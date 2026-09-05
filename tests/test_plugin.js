const vm = require('vm');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
function pixelPNG() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', require('zlib').deflateSync(Buffer.from([0, 20, 80, 120]))), chunk('IEND', Buffer.alloc(0))]);
}
const moduleStub = { exports: {} };
const commands = [];
class Plugin {
  async loadData() { return { appPath: 'legacy-python-path' }; }
  addCommand(command) { commands.push(command.id); }
  addRibbonIcon() {}
  registerEvent() {}
  addSettingTab() {}
}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../obsidian-plugin/main.js'), 'utf8'), {
  module: moduleStub, process, URL, console,
  require(name) {
    if (name === 'obsidian') return { Plugin, Modal: class {}, FuzzySuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {}, MarkdownView: class {} };
    return require(name);
  }
});
const { core } = moduleStub.exports;
(async () => {
  const plugin = new moduleStub.exports();
  plugin.app = { workspace: { on() {} } };
  await plugin.onload();
  assert.equal(plugin.settings.format, 'pdf');
  assert.deepEqual(commands, ['convert-current', 'open-converter']);
  plugin.onunload(); assert.equal(plugin.stopRequested, true);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pandoc-plugin-test-'));
  try {
    const source = path.join(directory, '中文 & sample.md');
    const photo = path.join(directory, 'pixel.png');
    fs.writeFileSync(photo, pixelPNG());
    const original = '# Test\n\nHello world.\n\n$$\n\\begin{align*}a &= b\\end{align*}\n$$\n\n![[pixel.png]]\n\n```text\n![[leave-literal.png]]\n```\n\n`[[literal]]`\n';
    fs.writeFileSync(source, original);
    for (const value of [source, `"${source}"`, `[sample](<${source}>)`, require('url').pathToFileURL(source).href, '[[中文 & sample]]', 'obsidian://open?file=' + encodeURIComponent('中文 & sample.md')]) {
      assert.equal(core.parsePaths(value, directory)[0], source);
    }
    assert.throws(() => core.parsePaths('https://example.com', directory));
    assert.throws(() => core.parsePaths('missing.md', directory));
    const normalized = core.prepareMarkdown(original, source);
    assert(normalized.includes('\\begin{aligned}'));
    assert(normalized.includes('![[leave-literal.png]]'));
    assert(normalized.includes('`[[literal]]`'));
    assert(normalized.includes(photo.replace(/\\/g, '/')));
    assert.throws(() => core.prepareMarkdown('![[missing.png]]', source));
    console.log('Plugin registration, legacy settings migration, path parsing and protected code normalization passed.');
    if (process.argv.includes('--integration')) {
      // Real Pandoc test; fixture uses PNG so PDF and Word embed the same resource.
      const options = { ...core.DEFAULTS, output: 'out', font: '', format: 'html' };
      for (const format of Object.keys(core.FORMATS)) {
        options.format = format;
        const output = await core.convert(source, options, directory);
        assert(fs.statSync(output).size > 50);
        if (format === 'html') assert(fs.readFileSync(output, 'utf8').includes('data:image/png;base64,'));
        console.log('Real conversion passed: ' + format);
      }
      options.format = 'html';
      const duplicate = await core.convert(source, options, directory);
      assert(duplicate.endsWith('(1).html'));
      options.pandoc = path.join(directory, 'missing-pandoc');
      await assert.rejects(core.convert(source, options, directory));
      assert.equal(fs.readFileSync(source, 'utf8'), original);
      console.log('Collision numbering, missing dependency error and source preservation passed.');
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
