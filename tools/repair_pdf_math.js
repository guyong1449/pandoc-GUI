// Repair the export-ready race in Better Export PDF 1.11.0 without replacing it.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const target = process.argv[2];
if (!target) throw new Error('Usage: node tools/repair_pdf_math.js <better-export-pdf/main.js>');
const oldSetup = '    const preview = e.appendChild(webview);';
const newSetup = `    const preview = e.appendChild(webview);
    let resolveMathReady, rejectMathReady;
    preview.__pdfMathReady = new Promise((resolve, reject) => { resolveMathReady = resolve; rejectMathReady = reject; });
    preview.__pdfMathReady.catch(() => {});`;
const original = `    preview.addEventListener("dom-ready", async (e2) => {
      this.completed = true;
      getAllStyles().forEach(async (css) => {
        await preview.insertCSS(css);
      });`;
const replacement = `    preview.addEventListener("dom-ready", async (e2) => {
      this.completed = false;
      try {
      await Promise.all(getAllStyles().map((css) => preview.insertCSS(css)));`;
const oldEnd = `      getPatchStyle().forEach(async (css) => {
        await preview.insertCSS(css);
      });
    });`;
const newEnd = `      await Promise.all(getPatchStyle().map((css) => preview.insertCSS(css)));
      await preview.executeJavaScript("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
      this.completed = true;
      resolveMathReady();
      } catch (error) { rejectMathReady(error); console.error(error); }
    });`;
const oldPrint = '    let data = await w.printToPDF(printOptions);';
const newPrint = `    await w.__pdfMathReady;
    await w.executeJavaScript("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
    let data = await w.printToPDF(printOptions);`;
const sourceText = fs.readFileSync(target, 'utf8');
const source = sourceText.replace(/\r\n/g, '\n');
if (source.includes(newSetup) && source.includes(replacement) && source.includes(newEnd) && source.includes(newPrint)) {
  console.log('PDF math readiness patch already installed.');
  process.exit(0);
}
for (const marker of [oldSetup, original, oldEnd, oldPrint]) {
  assert.equal(source.split(marker).length, 2, 'Unexpected plugin build; no files changed.');
}
const patched = source.replace(oldSetup, newSetup).replace(original, replacement).replace(oldEnd, newEnd).replace(oldPrint, newPrint);
new (require('vm').Script)(patched, { filename: target });
const backup = target + '.before-math-export-' + Date.now() + '.bak';
fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
fs.writeFileSync(target, sourceText.includes('\r\n') ? patched.replace(/\n/g, '\r\n') : patched);
console.log('Patched: ' + path.resolve(target));
console.log('Backup: ' + backup);
