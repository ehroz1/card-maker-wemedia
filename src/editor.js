/*
 * Поле ввода с видимым форматированием.
 *
 * Внутри остаётся та же разметка (**жирный**, _курсив_, //1), но пользователь
 * видит уже отформатированный текст. Преобразование идёт в обе стороны:
 *   markupToHtml — разметка -> то, что показываем
 *   htmlToMarkup — то, что набрали -> разметка
 */

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CARD_MARK_RE = /^\/\/\s*\d*\s*[+-]?\s*$/;

/* Разметка -> HTML для показа в поле ввода. */
function markupToHtml(text) {
  const lines = [];
  let current = [];
  for (const c of markupToChars(text)) {
    if (c.ch === '\n') { lines.push(current); current = []; continue; }
    current.push(c);
  }
  lines.push(current);

  return lines.map(chars => {
    const plain = chars.map(c => c.ch).join('');
    if (CARD_MARK_RE.test(plain.trim())) {
      return '<div class="ed-card">' + escapeHtml(plain) + '</div>';
    }
    if (!chars.length) return '<div><br></div>';

    let html = '';
    let i = 0;
    while (i < chars.length) {
      const start = chars[i];
      let text = '';
      while (i < chars.length && sameStyle(chars[i], start)) { text += chars[i].ch; i++; }
      let piece = escapeHtml(text);
      if (start.italic) piece = '<i>' + piece + '</i>';
      if (start.bold) piece = '<b>' + piece + '</b>';
      if (start.size) {
        // показываем разницу кеглей прямо в поле, чтобы её было видно
        const em = Math.max(0.7, Math.min(2.2, start.size / 38)).toFixed(2);
        piece = '<span data-size="' + start.size + '" style="font-size:' + em + 'em">' + piece + '</span>';
      }
      html += piece;
    }
    return '<div>' + html + '</div>';
  }).join('');
}

/*
 * Единый обход содержимого поля.
 *
 * Браузеры оформляют перевод строки по-разному: Chrome заводит <div>,
 * Safari и Firefox ставят <br>. Обход сводит все формы к одному правилу:
 * каждый блок — строка, одиночный <br> внутри блока — пустая строка,
 * <br> среди текста — перевод строки.
 *
 * onText(node, bold, italic, size), onNewline() и onBlock(node) вызываются по порядку.
 */
function walkEditor(root, onText, onNewline, onBlock) {
  const state = { emitted: false };

  const isBlock = node => node.nodeType === 1 &&
    /^(DIV|P|LI|TR|H[1-6]|BLOCKQUOTE|SECTION|ARTICLE)$/.test(node.tagName);

  const walk = (node, bold, italic, size) => {
    let afterBlock = false;          // текст сразу после блока начинает новую строку
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        if (!child.nodeValue.length) continue;
        if (afterBlock) { onNewline(); afterBlock = false; }
        onText(child, bold, italic, size);
        state.emitted = true;
        continue;
      }
      if (child.nodeType !== 1) continue;

      const tag = child.tagName.toLowerCase();

      if (tag === 'br') {
        afterBlock = false;
        const aloneInBlock = isBlock(child.parentNode) && child.parentNode.childNodes.length === 1;
        if (!aloneInBlock) { onNewline(); state.emitted = true; }
        continue;
      }

      const style = (child.getAttribute && child.getAttribute('style')) || '';
      // Google Docs оборачивает фрагмент в <b> с font-weight:normal,
      // поэтому явно указанный стиль важнее самого тега
      const weightBold = /font-weight\s*:\s*(bold|[6-9]00)/i.test(style);
      const weightNormal = /font-weight\s*:\s*(normal|lighter|[1-5]00)/i.test(style);
      const slantItalic = /font-style\s*:\s*italic/i.test(style);
      const slantNormal = /font-style\s*:\s*normal/i.test(style);
      const tagBold = tag === 'b' || tag === 'strong' || /^h[1-6]$/.test(tag);
      const tagItalic = tag === 'i' || tag === 'em';

      const nextBold = weightNormal ? false : (bold || tagBold || weightBold);
      const nextItalic = slantNormal ? false : (italic || tagItalic || slantItalic);
      const attrSize = child.getAttribute && child.getAttribute('data-size');
      const nextSize = attrSize ? Number(attrSize) : size;

      if (isBlock(child)) {
        if (state.emitted) onNewline();      // блок — это новая строка
        state.emitted = true;
        afterBlock = true;
        if (onBlock) onBlock(child);
        walk(child, nextBold, nextItalic, nextSize);
      } else {
        if (afterBlock) { onNewline(); afterBlock = false; }
        walk(child, nextBold, nextItalic, nextSize);
      }
    }
  };

  walk(root, false, false, null);
}

/* HTML из поля ввода -> разметка. */
function htmlToMarkup(root) {
  const chars = [];
  walkEditor(root,
    (node, bold, italic, size) => {
      for (const ch of node.nodeValue.replace(/\u00a0/g, ' ')) {
        chars.push({ ch, bold, italic, size });
      }
    },
    () => chars.push({ ch: '\n', bold: false, italic: false, size: null }));
  return charsToMarkup(chars);
}

/*
 * Превращает HTML из буфера обмена (Google Docs, Telegram, Word)
 * в нашу разметку, сохраняя жирный и курсив.
 */
function clipboardHtmlToMarkup(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  holder.querySelectorAll('style, script, meta, title, head').forEach(n => n.remove());
  return htmlToMarkup(holder).replace(/\n{3,}/g, '\n\n').trim();
}

/*
 * Telegram нередко кладёт в буфер только обычный текст, но с привычными
 * знаками разметки. Переводим их в наши, чтобы форматирование не пропадало.
 */
function clipboardPlainToMarkup(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '**_$1_**')
    .replace(/___([^_\n]+)___/g, '**_$1_**')
    .replace(/__([^_\n]+)__/g, '**$1**')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?):]|$)/g, '$1_$2_');
}

/*
 * Карта текста поля: где какой текстовый узел лежит.
 * Считается тем же обходом, что и разметка, поэтому смещения курсора
 * всегда совпадают с текстом, который потом разбирается на карточки.
 */
function textMap(root) {
  const entries = [];
  const anchors = [];          // начала строк: сюда можно поставить курсор на пустой строке
  let offset = 0;
  walkEditor(root,
    node => {
      const len = node.nodeValue.length;
      entries.push({ node, start: offset, len });
      offset += len;
    },
    () => { offset += 1; },
    block => { anchors.push({ block, start: offset }); });
  return { entries, anchors, length: offset };
}

/* Текст поля в том же виде, в каком считаются смещения. */
function editorText(root) {
  const { entries, length } = textMap(root);
  const chars = new Array(length).fill('\n');
  for (const entry of entries) {
    for (let i = 0; i < entry.len; i++) chars[entry.start + i] = entry.node.nodeValue[i];
  }
  return chars.join('').replace(/\u00a0/g, ' ');
}

/* Запоминает положение курсора как смещение в тексте. */
function getCaretOffset(root) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  const { entries, length } = textMap(root);
  const locate = (container, offsetInNode) => {
    if (container.nodeType === 3) {
      const hit = entries.find(e => e.node === container);
      return hit ? hit.start + Math.min(offsetInNode, hit.len) : length;
    }
    // курсор стоит между узлами — берём начало следующего текстового узла
    const child = container.childNodes[offsetInNode];
    if (child) {
      const hit = entries.find(e => e.node === child ||
        (child.contains && child.contains(e.node)));
      if (hit) return hit.start;
    }
    const inside = entries.filter(e => container.contains(e.node));
    if (inside.length) {
      const last = inside[inside.length - 1];
      return last.start + last.len;
    }
    return length;
  };

  return {
    start: locate(range.startContainer, range.startOffset),
    end: locate(range.endContainer, range.endOffset),
  };
}

/* Ставит курсор по смещению в тексте. */
function setCaretOffset(root, start, end = start) {
  const { entries, anchors } = textMap(root);
  const texts = entries;

  const place = target => {
    // ровно начало строки, в которой нет текста — ставим курсор в саму строку
    const emptyLine = anchors.find(a => a.start === target &&
      !texts.some(t => t.start >= a.start && t.start <= a.start));
    if (emptyLine) return { node: emptyLine.block, offset: 0 };

    for (const entry of texts) {
      if (target <= entry.start + entry.len) {
        return { node: entry.node, offset: Math.max(0, Math.min(target - entry.start, entry.len)) };
      }
    }
    if (texts.length) {
      const last = texts[texts.length - 1];
      return { node: last.node, offset: last.len };
    }
    return { node: root, offset: 0 };
  };

  const a = place(start), b = place(end);
  try {
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* поле могло перестроиться — курсор оставляем как есть */ }
}
