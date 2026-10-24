// Optional integration: NODE_PATH must provide jsdom; pass Obsidian's bundled MathJax JS.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
if (!process.argv[2]) throw new Error('Pass the extracted Obsidian MathJax bundle.');
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only', url: 'https://localhost/' });
const print = new JSDOM('<!doctype html><html><head></head><body><div class="print"><div id="content"></div></div></body></html>');
const w = dom.window;
w.eval("MathJax={startup:{typeset:false},options:{enableMenu:false,enableEnrichment:false,enableExplorer:false},chtml:{font:'mathjax-tex'},output:{font:'mathjax-tex'},loader:{load:[]}};");
w.eval(fs.readFileSync(process.argv[2], 'utf8'));
const moduleStub = { exports: {} };
let loads = 0;
class Stub {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../obsidian-plugin/main.js'), 'utf8'), {
  module: moduleStub, process, URL, console, MathJax: w.MathJax,
  require(name) {
    if (name !== 'obsidian') return require(name);
    return { Plugin: Stub, Modal: Stub, FuzzySuggestModal: Stub, PluginSettingTab: Stub,
      loadMathJax: async () => { loads++; },
      finishRenderMath: async () => { dom.window.document.head.appendChild(w.MathJax.chtmlStylesheet()); } };
  }
});
(async () => {
  await w.MathJax.startup.promise;
  Object.assign(w.MathJax.startup.document.options, { enableMenu: false, enableEnrichment: false, enableExplorer: false });
  const core = moduleStub.exports.core;
  const doc = print.window.document;
  const el = doc.getElementById('content');
  const source = '\\begin{align}x &= 1 \\\\\n\ny &= 2\\end{align}';
  const raw = doc.createElement('div'); raw.className = 'math math-block'; raw.textContent = source;
  const valid = doc.createElement('div'); valid.className = 'math math-block';
  const existing = w.MathJax.tex2chtml(source, { display: true }); valid.appendChild(existing);
  el.append(raw, valid);
  await core.preparePrintMath(el);
  assert(raw.querySelector('mjx-mtable'));
  assert(!raw.querySelector('mjx-merror'));
  assert.equal(valid.firstChild, existing, 'Keep successful renders and equation labels intact.');
  const style = doc.getElementById('pandoc-studio-print-math');
  assert(style.textContent.includes('mjx-mtable'));
  assert(style.sheet.cssRules.length > 100);
  await core.preparePrintMath(el);
  assert.equal(doc.querySelectorAll('#pandoc-studio-print-math').length, 1);
  const count = loads;
  await core.preparePrintMath(doc.createElement('div'));
  assert.equal(loads, count, 'Normal note rendering must not be modified.');
  console.log('Real MathJax ' + w.MathJax.version + ': print fallback, complete table styles, existing labels and print-only scope passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { dom.window.close(); print.window.close(); });
