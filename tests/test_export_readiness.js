const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const assert = require('assert');
const { spawnSync } = require('child_process');
const bundle = process.argv[2];
if (!bundle) throw new Error('Pass the Better Export PDF 1.11.0 main.js bundle.');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function simulate(source, patched) {
  const start = source.indexOf('  async appendWebview(e, doc) {');
  const end = source.indexOf('  async appendWebviews(', start);
  assert(start >= 0 && end > start);
  const calls = [], pendingCss = new Map();
  let onReady;
  const preview = {
    addEventListener(name, callback) { assert.equal(name, 'dom-ready'); onReady = callback; },
    insertCSS(css) {
      calls.push('insert:' + css);
      return new Promise(resolve => pendingCss.set(css, () => { calls.push('ready:' + css); resolve(); }));
    },
    async executeJavaScript(code) { calls.push(code.includes('document.fonts.ready') ? 'fonts' : 'markup'); }
  };
  const host = { webviews: [], scale: 1, config: { cssSnippet: '0' }, completed: false, makeWebviewJs: () => 'markup' };
  const append = vm.runInNewContext('({' + source.slice(start, end) + '}).appendWebview', {
    createWebview: () => preview, getAllStyles: () => ['base'], getPatchStyle: () => ['patch'], console
  });
  await append.call(host, { appendChild: () => preview }, {});
  const rendering = onReady();
  await tick();
  if (!patched) {
    assert.equal(host.completed, true);
    assert(calls.includes('markup'), 'Old code should reproduce markup insertion before CSS completes.');
  } else {
    assert.equal(host.completed, false);
    assert(!calls.includes('markup'));
    let ready = false;
    preview.__pdfMathReady.then(() => { ready = true; });
    await tick();
    assert.equal(ready, false);
  }
  pendingCss.get('base')();
  await tick();
  assert(calls.includes('markup'));
  if (patched) assert.equal(host.completed, false);
  pendingCss.get('patch')();
  await rendering;
  if (patched) {
    await preview.__pdfMathReady;
    assert.equal(host.completed, true);
    assert(calls.indexOf('ready:base') < calls.indexOf('markup'));
    assert(calls.indexOf('ready:patch') < calls.indexOf('fonts'));
    assert(source.includes('await w.__pdfMathReady;'));
  }
}

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-math-readiness-'));
  try {
    const original = fs.readFileSync(bundle, 'utf8');
    await simulate(original, false);
    const copy = path.join(directory, 'main.js');
    fs.writeFileSync(copy, original);
    const repair = path.join(__dirname, '../tools/repair_pdf_math.js');
    const run = () => spawnSync(process.execPath, [repair, copy], { encoding: 'utf8' });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const patched = fs.readFileSync(copy, 'utf8');
    await simulate(patched, true);
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(copy, 'utf8'), patched);
    assert.equal(fs.readdirSync(directory).filter(name => name.endsWith('.bak')).length, 1);
    fs.writeFileSync(copy, 'module.exports = {};');
    assert.notEqual(run().status, 0);
    assert.equal(fs.readFileSync(copy, 'utf8'), 'module.exports = {};');
    console.log('Old CSS race reproduced; CSS/font barriers, patch idempotence and version guard passed.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
