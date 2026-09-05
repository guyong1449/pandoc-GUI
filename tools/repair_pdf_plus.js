// One narrowly scoped compatibility fix for PDF++ 0.40.31 / Obsidian 1.13.
// Reference: https://github.com/RyotaUshio/obsidian-pdf-plus/pull/572
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const target = process.argv[2];
if (!target) throw new Error('Usage: node repair_pdf_plus.js <pdf-plus/main.js>');
const original = 'requireModKeyForLinkHover(t="pdf-plus"){var i,r,o;return(o=(r=this.app.internalPlugins.plugins["page-preview"].instance.overrides[t])!=null?r:(i=this.app.workspace.hoverLinkSources[t])==null?void 0:i.defaultMod)!=null?o:!1}';
const replacement = 'requireModKeyForLinkHover(t="pdf-plus"){const p=this.app.internalPlugins.plugins["page-preview"]?.instance;return(p?.options??p?.overrides)?.[t]??this.app.workspace.hoverLinkSources?.[t]?.defaultMod??false}';
const source = fs.readFileSync(target, 'utf8');
if (source.includes(replacement)) { console.log('Compatibility patch already installed.'); process.exit(0); }
assert.equal(source.split(original).length, 2, 'Unexpected plugin build; no files changed.');
const before = new Function('return ({' + original + '})')();
const after = new Function('return ({' + replacement + '})')();
function environment(instance, fallback = true) {
  return { app: { internalPlugins: { plugins: { 'page-preview': { instance } } }, workspace: { hoverLinkSources: { 'pdf-plus': { defaultMod: fallback } } } } };
}
assert.throws(() => before.requireModKeyForLinkHover.call(environment({ options: {} })), TypeError);
assert.equal(after.requireModKeyForLinkHover.call(environment({ options: { 'pdf-plus': false } })), false);
assert.equal(after.requireModKeyForLinkHover.call(environment({ options: { 'pdf-plus': true } })), true);
assert.equal(after.requireModKeyForLinkHover.call(environment({ overrides: { 'pdf-plus': false } })), false);
assert.equal(after.requireModKeyForLinkHover.call(environment(undefined)), true);
assert.equal(after.requireModKeyForLinkHover.call(environment({ options: {} }, false)), false);
const backup = target + '.before-1.13-fix-' + Date.now() + '.bak';
fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
fs.writeFileSync(target, source.replace(original, replacement));
console.log('Reproduced old TypeError; 5 compatibility cases passed.');
console.log('Patched: ' + path.resolve(target));
console.log('Backup: ' + backup);
