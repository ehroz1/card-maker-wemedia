const { JSDOM } = require('jsdom');
const fs=require('fs');
const dom=new JSDOM('<div id="e" contenteditable></div>',{url:'http://localhost/'});
global.window=dom.window; global.document=dom.window.document; global.NodeFilter=dom.window.NodeFilter;
eval(fs.readFileSync('src/editor.js','utf8'));
const e=document.getElementById('e');

// (6) пустые строки
const cases = [
  ['<div>текст</div>', 'текст'],
  ['<div>текст</div><div><br></div>', 'текст\n'],
  ['<div>текст</div><div><br></div><div><br></div>', 'текст\n\n'],
  ['<div>текст<br></div>', 'текст'],
  ['<div>текст<br><br></div>', 'текст\n'],
];
console.log('--- пустые строки ---');
for (const [html, want] of cases) {
  e.innerHTML = html;
  const got = editorText(e);
  console.log((got===want?'OK  ':'НЕТ '), JSON.stringify(html), '->', JSON.stringify(got), 'ждём', JSON.stringify(want));
}

// (2) кегль у куска
console.log('\n--- кегль у выделения ---');
const m = wrapSize('крупно', 54) + ' обычно';
e.innerHTML = markupToHtml(m);
console.log('HTML:', e.innerHTML);
console.log('обратно совпало:', htmlToMarkup(e) === m);
console.log('текст без меток:', JSON.stringify(editorText(e)));

// (4) RTF из телеграма
console.log('\n--- RTF ---');
const rtf = String.raw`{\rtf1\ansi\ansicpg1251{\fonttbl\f0\fnil Helvetica;}\f0\fs28 Обычный \b жирный\b0  и \i курсив\i0 .\par Вторая строка}`;
console.log(JSON.stringify(clipboardRtfToMarkup(rtf)));
