/* Card Maker — интерфейс. Всё считается локально в браузере. */

const STORE_TEMPLATES = 'cardmaker.templates.v2';
// v3: cardStyles хранится по стабильному ключу карточки (см. cardKeys), а не по позиции
const STORE_PROJECT = 'cardmaker.project.v3';
const PREVIEW_CSS_WIDTH = 225;
const PREVIEW_SCALE = 2;
const ZOOM_MIN = 1, ZOOM_MAX = 2.5;

const SAMPLE = `//1
_Лаура Саламат, Enterprise Architect — сооснователь сообщества IT-архитекторов Казахстана_

**Заголовок**

**Я занимаюсь плаванием** два с половиной года. За это время приняла участие в пяти заплывах и преодолела дистанцию в 14 километров.

//2
**Заголовок**

В бассейн я пришла ради _красоты_ и хорошей осанки. Но довольно быстро стало интереснее не то, как выглядит мое тело, а то, на что оно становится способно.`;

const state = {
  cover: { kind: 'cover', title: '', body: '', img: null, usePhoto: true,
           zoom: 1, panX: 0, panY: 0, rotate: 0, style: null },
  coverTitleSize: 60,
  coverBodySize: 45,
  cardsText: '',
  // фото/стиль/трансформация карточек хранятся по стабильному ключу карточки
  // (см. cardKeys), а не по позиции — иначе вставка или удаление карточки
  // выше по тексту молча переносит фото и настройки на другую карточку
  photosById: {},
  cardStylesById: {},   // стиль каждой карточки: то, что пользователь поменял руками
  transformsById: {},   // zoom/panX/panY/rotate каждой карточки с фото
  cardIds: [],          // ключи карточек state.cards, посчитанные последним syncCards()
  cards: [],           // разобранные карточки (пересобираются из текста)
  format: DEFAULT_FORMAT,
  exportFormat: 'png',
  exportScale: 1,       // множитель разрешения при экспорте (1×/2×/3×)
  exportZip: false,     // скачивать все карточки одним ZIP вместо файла за файлом
  coverStyles: { title: {}, body: {} },   // заголовок и подзаголовок обложки — отдельно
  templateName: null,
  templates: {},
  assets: {},
  current: 0,          // 0 — обложка, далее карточки
  focusZone: 'editor', // где пользователь работал: editor | coverTitle | coverBody | preview
  lastCaret: null,     // последнее положение курсора в поле карточек
  fontsReady: false,
  undoStack: [],       // снимки состояния для отмены (см. pushUndo/undo/redo)
  redoStack: [],
};

const el = {};
['previews', 'coverTitle', 'coverBody', 'coverTitleSize', 'coverBodySize', 'cardsText',
 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'alignGroup', 'exportFormat',
 'status', 'menu', 'filePicker', 'assetPicker',
 'rngScale', 'rngOffsetX', 'rngOffsetY', 'rngRotate', 'typoScope', 'exportScale', 'exportZip',
 'scaleOut', 'offsetXOut', 'offsetYOut', 'rotateOut']
  .forEach(id => { el[id] = document.getElementById(id); });

/* --------------------------------------------------- поле ввода карточек */

/* Текст поля в виде разметки. */
function editorValue() {
  return htmlToMarkup(el.cardsText);
}

/* Показать разметку в поле, сохранив положение курсора. */
function setEditorValue(text, keepCaret = true) {
  const caret = keepCaret ? getCaretOffset(el.cardsText) : null;
  el.cardsText.innerHTML = markupToHtml(text);
  if (caret) setCaretOffset(el.cardsText, caret.start, caret.end);
}

/* Выделение в поле как смещения в разметке. */
function editorSelection() {
  const plain = getCaretOffset(el.cardsText);
  if (!plain) return null;
  return plain;
}

let statusTimer = null;
function say(text) {
  el.status.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.status.textContent = ''; }, 5000);
}

/* ---------------------------------------------------------------- иконки */

function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => {
    const svg = (typeof ICONS !== 'undefined') ? ICONS[node.dataset.icon] : null;
    if (svg && !node.dataset.painted) {
      node.innerHTML = svg;
      node.dataset.painted = '1';
    }
  });
}

/* ------------------------------------------------------------- хранилище */

function loadTemplates() {
  try { state.templates = JSON.parse(localStorage.getItem(STORE_TEMPLATES) || '{}'); }
  catch { state.templates = {}; }
  if (!Object.keys(state.templates).length) {
    state.templates = { 'Мой проект': { logo: null, logoDark: null, gradient: null } };
  }
  state.templateName = Object.keys(state.templates)[0];
}

function saveTemplates() {
  try { localStorage.setItem(STORE_TEMPLATES, JSON.stringify(state.templates)); }
  catch { say('Не хватает места в браузере — логотип не сохранён'); }
}

function saveProject() {
  const data = {
    coverTitle: state.cover.title, coverBody: state.cover.body,
    coverTitleSize: state.coverTitleSize, coverBodySize: state.coverBodySize,
    cardsText: state.cardsText, format: state.format,
    exportFormat: state.exportFormat, exportScale: state.exportScale, exportZip: state.exportZip,
    cardStylesById: state.cardStylesById, coverStyles: state.coverStyles,
    templateName: state.templateName,
  };
  try { localStorage.setItem(STORE_PROJECT, JSON.stringify(data)); } catch { /* не критично */ }
}

/* Переносит сохранённый объект проекта (из localStorage или из файла) в state. */
function applyProjectData(d) {
  state.cover.title = d.coverTitle || '';
  state.cover.body = d.coverBody || '';
  state.coverTitleSize = d.coverTitleSize || 60;
  state.coverBodySize = d.coverBodySize || 45;
  state.cardsText = d.cardsText || '';
  if (FORMATS[d.format]) state.format = d.format;
  if (d.exportFormat) state.exportFormat = d.exportFormat;
  if (d.exportScale && [1, 2, 3].includes(Number(d.exportScale))) state.exportScale = Number(d.exportScale);
  if (typeof d.exportZip === 'boolean') state.exportZip = d.exportZip;
  if (d.cardStylesById && typeof d.cardStylesById === 'object') state.cardStylesById = d.cardStylesById;
  if (d.coverStyles) state.coverStyles = Object.assign({ title: {}, body: {} }, d.coverStyles);
  if (d.templateName && state.templates[d.templateName]) state.templateName = d.templateName;
}

function loadProject() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(STORE_PROJECT) || 'null'); } catch { d = null; }
  if (!d) return false;
  applyProjectData(d);
  return true;
}

/* Сохраняет проект (без фото — как и localStorage-версия) отдельным файлом. */
function exportProjectFile() {
  const data = {
    coverTitle: state.cover.title, coverBody: state.cover.body,
    coverTitleSize: state.coverTitleSize, coverBodySize: state.coverBodySize,
    cardsText: state.cardsText, format: state.format,
    exportFormat: state.exportFormat, exportScale: state.exportScale, exportZip: state.exportZip,
    cardStylesById: state.cardStylesById, coverStyles: state.coverStyles,
    templateName: state.templateName,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'card-maker-project.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  say('Проект сохранён в файл');
}

/* Загружает проект из файла, сохранённого exportProjectFile(). Фото не переносятся. */
function importProjectFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let d = null;
      try { d = JSON.parse(reader.result); } catch { d = null; }
      if (!d || typeof d !== 'object' || typeof d.cardsText !== 'string') {
        say('Файл не похож на проект Card Maker');
        return;
      }
      applyProjectData(d);
      // фото в файл не попадают — старые привязки от предыдущего проекта тоже сбрасываем
      state.photosById = {};
      state.transformsById = {};
      state.current = 0;
      state.focusZone = 'editor';
      state.lastCaret = null;
      fillControls();
      syncCards();
      buildPreviews();
      syncTypographyControls();
      saveProject();
      say('Проект загружен из файла — фото нужно добавить заново');
    };
    reader.onerror = () => say('Не удалось прочитать файл');
    reader.readAsText(file);
  });
  input.click();
}

/* ---------------------------------------------------------------- ассеты */

function dataUrlToImage(url, timeoutMs = 5000) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const img = new Image();
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => { clearTimeout(timer); finish(img); };
    img.onerror = () => { clearTimeout(timer); finish(null); };
    img.src = url;
  });
}

/* Находит видимую часть логотипа, отбрасывая прозрачные поля файла. */
function trimTransparent(img) {
  if (!img) return null;
  try {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { img, sx: 0, sy: 0, sw: img.width, sh: img.height };
    return { img, sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
  } catch {
    return { img, sx: 0, sy: 0, sw: img.width, sh: img.height };
  }
}

async function prepareAssets(name) {
  const tpl = state.templates[name] || {};
  const B = (typeof BUNDLED_BRAND !== 'undefined') ? BUNDLED_BRAND : {};
  const [logo, logoDark] = await Promise.all([
    dataUrlToImage(tpl.logo || B.logo),
    dataUrlToImage(tpl.logoDark || B.logoDark),
  ]);
  state.assets[name] = { logo: trimTransparent(logo), logoDark: trimTransparent(logoDark) };
}

function currentAssets() {
  return state.assets[state.templateName] || { logo: null, logoDark: null };
}

function currentGradient() {
  const tpl = state.templates[state.templateName] || {};
  return Object.assign({}, GRADIENT_DEFAULTS, tpl.gradient || {});
}

/* ------------------------------------------------------------- карточки */

/*
 * Стабильный ключ карточки: метка ("//1", "//2-", …) плюс номер её
 * повторения среди одинаковых меток. Метка не зависит от позиции карточки
 * в массиве, поэтому по ней можно узнавать «ту же» карточку после того,
 * как текст выше поменялся и все индексы сдвинулись.
 */
function cardKeys(parsed) {
  const seen = {};
  return parsed.map(p => {
    const marker = p.marker || '';
    const n = seen[marker] || 0;
    seen[marker] = n + 1;
    return marker + '#' + n;
  });
}

/* Пересобирает список карточек из текста, сохраняя уже загруженные фото. */
function syncCards() {
  const parsed = parseCards(state.cardsText);
  const keys = cardKeys(parsed);
  state.cardIds = keys;
  state.cards = parsed.map((p, i) => {
    const key = keys[i];
    const t = state.transformsById[key] || {};
    return {
      kind: 'card',
      lines: p.lines,
      usePhoto: p.usePhoto,
      img: state.photosById[key] || null,
      zoom: t.zoom || 1,
      panX: t.panX || 0,
      panY: t.panY || 0,
      rotate: t.rotate || 0,
      style: state.cardStylesById[key] || {},
    };
  });
  state.cover.style = { size: state.coverBodySize, headingSize: state.coverTitleSize };
  state.cover.titleStyle = Object.assign({}, state.coverStyles.title);
  state.cover.bodyStyle = Object.assign({}, state.coverStyles.body);
  if (state.current > state.cards.length) state.current = 0;
}

/* Записывает текущий zoom/pan/rotate карточки под её позицией в storage по ключу. */
function commitTransform(index) {
  if (index <= 0) return;              // у обложки трансформация хранится прямо в state.cover
  const key = state.cardIds[index - 1];
  const card = state.cards[index - 1];
  if (!key || !card) return;
  state.transformsById[key] = { zoom: card.zoom, panX: card.panX, panY: card.panY, rotate: card.rotate };
}

/*
 * Разбивает текст карточек на блоки по меткам //N: каждый блок — массив
 * строк от своей метки (включительно) до строки перед следующей меткой.
 * blocks.map(b => b.join('\n')).join('\n') всегда восстанавливает исходный
 * текст один в один — блоки партиционируют строки без потерь и наложений.
 * Общий разбор для duplicateCard()/reorderCard().
 */
function splitCardBlocks(text) {
  const markerRe = /^\/\/\s*(\d+)?\s*([+-])?\s*$/;
  const lines = text.split('\n');
  const starts = [];
  let maxNum = 0;
  lines.forEach((line, i) => {
    const m = line.trim().match(markerRe);
    if (m) { starts.push(i); if (m[1]) maxNum = Math.max(maxNum, Number(m[1])); }
  });
  const blocks = starts.map((from, i) => lines.slice(from, i + 1 < starts.length ? starts[i + 1] : lines.length));
  return { blocks, maxNum, markerRe };
}

/*
 * Дублирует карточку карусели: копирует её текстовый блок (включая метку)
 * сразу после неё, с новым, ещё не занятым номером в метке — чтобы у копии
 * сразу был свой стабильный ключ (см. cardKeys), а не тот же, что у оригинала.
 * Вместе с текстом переносятся фото, ручной стиль и трансформация.
 */
function duplicateCard(index) {
  if (index < 0 || index >= state.cards.length) return;
  const { blocks, maxNum, markerRe } = splitCardBlocks(state.cardsText);
  if (index >= blocks.length) return;
  pushUndo();

  const copy = blocks[index].slice();
  const markerMatch = copy[0].trim().match(markerRe);
  const sign = (markerMatch && markerMatch[2]) || '';
  copy[0] = '//' + (maxNum + 1) + sign;   // у копии — свежий, точно не занятый номер

  const oldKey = state.cardIds[index];
  blocks.splice(index + 1, 0, copy);
  state.cardsText = blocks.map(b => b.join('\n')).join('\n');
  setEditorValue(state.cardsText, false);
  syncCards(); buildPreviews(); saveProject();

  const newKey = state.cardIds[index + 1];
  if (oldKey && newKey && oldKey !== newKey) {
    if (state.photosById[oldKey]) state.photosById[newKey] = state.photosById[oldKey];
    if (state.cardStylesById[oldKey]) state.cardStylesById[newKey] = Object.assign({}, state.cardStylesById[oldKey]);
    if (state.transformsById[oldKey]) state.transformsById[newKey] = Object.assign({}, state.transformsById[oldKey]);
    syncCards(); buildPreviews(); saveProject();
  }
  selectCard(index + 2);   // +1 за обложку, +1 — это уже сама копия
  say('Карточка продублирована');
}

/*
 * Переставляет карточку карусели на новую позицию, просто переставляя её
 * текстовый блок в state.cardsText. Фото/стиль/трансформация переезжают
 * вместе с блоком сами собой — они привязаны к метке, а не к позиции
 * (см. cardKeys), так что здесь ничего досогласовывать не нужно.
 */
function reorderCard(sourceIndex, targetIndex) {
  if (sourceIndex === targetIndex) return;
  const { blocks } = splitCardBlocks(state.cardsText);
  if (sourceIndex < 0 || sourceIndex >= blocks.length || targetIndex < 0 || targetIndex >= blocks.length) return;
  pushUndo();

  const [moved] = blocks.splice(sourceIndex, 1);
  blocks.splice(targetIndex, 0, moved);

  state.cardsText = blocks.map(b => b.join('\n')).join('\n');
  setEditorValue(state.cardsText, false);
  syncCards(); buildPreviews(); saveProject();
  selectCard(targetIndex + 1);
  say('Карточка перемещена');
}

function allCards() {
  return [state.cover].concat(state.cards);
}

function cardLabel(i) {
  return i === 0 ? 'Обложка' : 'Карточка ' + i;
}

/* ---------------------------------------------------------------- превью */

function buildPreviews() {
  const list = allCards();
  el.previews.innerHTML = '';

  list.forEach((card, i) => {
    const item = document.createElement('div');
    item.className = 'preview-item';

    const label = document.createElement('p');
    label.className = 'section-label';
    label.textContent = cardLabel(i);
    item.appendChild(label);

    const frame = document.createElement('div');
    frame.className = 'frame' + (i === state.current ? ' selected' : '');
    frame.dataset.index = String(i);
    frame.appendChild(document.createElement('canvas'));

    if (i > 0) {
      // ручка для перетаскивания — отдельно от рамки, чтобы не мешать
      // панорамированию фото внутри рамки (там drag уже занят под сдвиг кадра)
      const grip = document.createElement('span');
      grip.className = 'drag-handle';
      grip.textContent = '⠿';
      grip.title = 'Перетащи, чтобы поменять карточки местами';
      grip.draggable = true;
      grip.addEventListener('dragstart', e => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-card-index', String(i - 1));
        frame.classList.add('dragging');
      });
      grip.addEventListener('dragend', () => frame.classList.remove('dragging'));
      label.appendChild(grip);
    }

    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Предпросмотр';
    frame.appendChild(empty);

    const warn = document.createElement('div');
    warn.className = 'warn';
    warn.textContent = '!';
    warn.title = 'Текст не помещается на карточку — уменьши кегль/межстрочный интервал или перенеси часть текста на другую карточку';
    frame.appendChild(warn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-photo';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Убрать фото с этой карточки';
    // pointerdown у рамки запускает панорамирование фото — гасим всплытие
    // именно здесь, иначе клик по кнопке ещё и подхватится как начало сдвига кадра
    removeBtn.addEventListener('pointerdown', e => e.stopPropagation());
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      removePhoto(i);
    });
    frame.appendChild(removeBtn);

    attachFrameEvents(frame, i);
    item.appendChild(frame);
    el.previews.appendChild(item);
  });

  scheduleRender();
}

/*
 * Пачка фото, брошенная не точно на карточку (например, в промежуток между
 * превью), раскладывается по карточкам карусели по порядку начиная с первой.
 * Одиночное фото на конкретную карточку по-прежнему обрабатывает сама
 * карточка (attachFrameEvents) и останавливает всплытие — сюда долетают
 * только пачки и промахи мимо рамок.
 */
function wirePreviewsBulkDrop() {
  el.previews.addEventListener('dragover', e => e.preventDefault());
  el.previews.addEventListener('drop', async e => {
    e.preventDefault();
    const images = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
    if (images.length <= 1) return;
    const n = await distributePhotos(images, 1);
    say('Разложено фото по карточкам: ' + n);
  });
}

function attachFrameEvents(frame, index) {
  // работает с мышью, пальцем и пером
  frame.addEventListener('pointerdown', e => {
    selectCard(index);
    const card = allCards()[index];
    if (!card || !card.img || !card.usePhoto) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { frame.setPointerCapture(e.pointerId); } catch { /* не критично */ }

    const sx = e.clientX, sy = e.clientY;
    const ox = card.panX, oy = card.panY;
    const ratio = FORMATS[state.format][0] / frame.clientWidth;

    const move = ev => {
      card.panX = ox - (ev.clientX - sx) * ratio;
      card.panY = oy - (ev.clientY - sy) * ratio;
      commitTransform(index);
      syncTransformControls();
      scheduleRender();
    };
    const up = ev => {
      frame.removeEventListener('pointermove', move);
      frame.removeEventListener('pointerup', up);
      frame.removeEventListener('pointercancel', up);
      try { frame.releasePointerCapture(ev.pointerId); } catch { /* не критично */ }
    };
    frame.addEventListener('pointermove', move);
    frame.addEventListener('pointerup', up);
    frame.addEventListener('pointercancel', up);
  });

  // щипок двумя пальцами — масштаб
  let pinchStart = null;
  frame.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) return;
    const card = allCards()[index];
    if (!card || !card.img || !card.usePhoto) return;
    const [a, b] = e.touches;
    pinchStart = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom: card.zoom };
  }, { passive: true });

  frame.addEventListener('touchmove', e => {
    if (!pinchStart || e.touches.length !== 2) return;
    const card = allCards()[index];
    if (!card) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    card.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinchStart.zoom * (dist / pinchStart.dist)));
    commitTransform(index);
    syncTransformControls();
    scheduleRender();
  }, { passive: false });

  frame.addEventListener('touchend', () => { pinchStart = null; }, { passive: true });

  frame.addEventListener('wheel', e => {
    const card = allCards()[index];
    if (!card || !card.img || !card.usePhoto) return;
    e.preventDefault();
    selectCard(index);
    card.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, card.zoom + (e.deltaY > 0 ? -0.05 : 0.05)));
    commitTransform(index);
    syncTransformControls();
    scheduleRender();
  }, { passive: false });

  frame.addEventListener('dragover', e => { e.preventDefault(); frame.classList.add('dropping'); });
  frame.addEventListener('dragleave', () => frame.classList.remove('dropping'));
  frame.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();   // иначе сработает ещё и общий обработчик пачки на #previews
    frame.classList.remove('dropping');

    const dragIndex = e.dataTransfer.getData('text/x-card-index');
    if (dragIndex !== '' && index > 0) {
      reorderCard(Number(dragIndex), index - 1);
      return;
    }

    selectCard(index);
    const images = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
    if (!images.length) return;
    if (images.length === 1) {
      await setPhoto(index, images[0]);
    } else {
      const n = await distributePhotos(images, index);
      say('Разложено фото по карточкам: ' + n);
    }
  });
}

function selectCard(index, options = {}) {
  state.current = index;
  if (!options.keepZone) state.focusZone = 'preview';
  [...el.previews.querySelectorAll('.frame')].forEach(f => {
    f.classList.toggle('selected', Number(f.dataset.index) === index);
  });
  syncTransformControls();
}

/* Ползунки трансформации показывают значения выбранной карточки. */
function syncTransformControls() {
  const card = allCards()[state.current];
  if (!card) return;
  el.rngScale.value = String(Math.round(((card.zoom || 1) - 1) * 100));
  el.rngOffsetX.value = String(Math.round(card.panX || 0));
  el.rngOffsetY.value = String(Math.round(card.panY || 0));
  el.rngRotate.value = String(Math.round(card.rotate || 0));
  paintTransformOutputs();
}

function paintTransformOutputs() {
  el.scaleOut.textContent = el.rngScale.value + '%';
  el.offsetXOut.textContent = el.rngOffsetX.value + ' пикселей';
  el.offsetYOut.textContent = el.rngOffsetY.value + ' пикселей';
  el.rotateOut.textContent = el.rngRotate.value + '°';
}

/* ------------------------------------------------------------------ фото */

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('не удалось прочитать изображение'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

async function setPhoto(index, file, { skipUndo = false } = {}) {
  try {
    const img = await fileToImage(file);
    if (!skipUndo) pushUndo();
    if (index === 0) {
      state.cover.img = img;
      state.cover.zoom = 1; state.cover.panX = 0; state.cover.panY = 0; state.cover.rotate = 0;
    } else {
      const key = state.cardIds[index - 1];
      if (key === undefined) return;
      state.photosById[key] = img;
      delete state.transformsById[key];   // новое фото — трансформация сбрасывается
      const card = state.cards[index - 1];
      if (card) { card.img = img; card.zoom = 1; card.panX = 0; card.panY = 0; card.rotate = 0; }
    }
    selectCard(index);
    scheduleRender();
    say('Фото добавлено');
  } catch (err) {
    say('Не получилось открыть файл: ' + err.message);
  }
}

/* Убирает фото с карточки — на случай, если передумали. Текст не трогает. */
function removePhoto(index) {
  const card = allCards()[index];
  if (!card || !card.img) return;
  pushUndo();
  if (index === 0) {
    state.cover.img = null;
    state.cover.zoom = 1; state.cover.panX = 0; state.cover.panY = 0; state.cover.rotate = 0;
  } else {
    const key = state.cardIds[index - 1];
    if (key === undefined) return;
    delete state.photosById[key];
    delete state.transformsById[key];
    card.img = null; card.zoom = 1; card.panX = 0; card.panY = 0; card.rotate = 0;
  }
  scheduleRender();
  say('Фото убрано');
}

/*
 * Раскладывает пачку фото по карточкам карусели по порядку, начиная с
 * startIndex (позиция в allCards(), обложка пропускается), пропуская
 * карточки без фото (//N-). Используется при перетаскивании/выборе сразу
 * нескольких файлов — вместо того чтобы цеплять их к карточкам по одному.
 */
async function distributePhotos(images, startIndex) {
  if (!images.length) return 0;
  pushUndo();   // одна пачка — один шаг отмены, а не по одному на файл
  const list = allCards();
  let idx = Math.max(1, startIndex);
  let used = 0;
  for (const file of images) {
    while (idx < list.length && !list[idx].usePhoto) idx++;
    if (idx >= list.length) break;
    await setPhoto(idx, file, { skipUndo: true });
    idx++;
    used++;
  }
  return used;
}

/* ---------------------------------------------------------------- рендер */

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAll, 60);
}

function renderAll() {
  if (!state.fontsReady) return;
  const [W, H] = FORMATS[state.format];
  const scale = (PREVIEW_CSS_WIDTH * PREVIEW_SCALE) / W;
  const assets = currentAssets();
  const gradient = currentGradient();
  const list = allCards();
  const frames = [...el.previews.querySelectorAll('.frame')];

  list.forEach((card, i) => {
    const frame = frames[i];
    if (!frame) return;
    const canvas = frame.querySelector('canvas');
    const empty = frame.querySelector('.empty');

    const hasPhoto = Boolean(card.usePhoto && card.img);
    const hasContent = hasPhoto ||
      (card.kind === 'cover' ? (card.title || card.body) : card.lines.some(l => l.trim()));
    empty.style.display = hasContent ? 'none' : 'grid';
    frame.classList.toggle('has-photo', hasPhoto);

    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    try {
      const fixed = renderCard(ctx, card, [W, H], assets, gradient);
      card.panX = fixed.panX; card.panY = fixed.panY;
      commitTransform(i);
      frame.classList.toggle('overflow', Boolean(fixed.overflow));
    } catch (err) {
      console.error('не удалось отрисовать карточку', i, err);
      say('Карточка ' + (i + 1) + ': ошибка отрисовки');
    }
  });
}

function renderFull(card, scale = state.exportScale) {
  const [W, H] = FORMATS[state.format];
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderCard(ctx, card, [W, H], currentAssets(), currentGradient());
  return canvas;
}

/* -------------------------------------------------------------- экспорт */

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

function hasContent(c) {
  return (c.usePhoto && c.img) ||
    (c.kind === 'cover' ? Boolean(c.title || c.body) : c.lines.some(l => l.trim()));
}

function downloadBlob(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

/*
 * ZIP-архив без сжатия (store): PNG/JPG и так уже сжаты, DEFLATE тут почти
 * ничего не выигрывает, а store — это десяток строк без внешних библиотек.
 * files: [{ name, data: Uint8Array }]. Формат проверен побайтово (см. commit).
 */
function crc32(bytes) {
  if (!crc32.table) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = crc32.table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const dosDate = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, dosDate };
}

function buildZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, dosDate } = dosDateTime(new Date());

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const data = file.data;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true);          // метод 0 = store
    local.setUint16(10, time, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = parts.concat(central, [new Uint8Array(end.buffer)]);
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let pos = 0;
  for (const chunk of all) { out.set(chunk, pos); pos += chunk.length; }
  return out;
}

async function exportAll() {
  const list = allCards().filter(hasContent);
  if (!list.length) { say('Пока нечего экспортировать'); return; }

  const mime = state.exportFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = state.exportFormat === 'jpeg' ? 'jpg' : 'png';
  const rendered = [];
  let failed = 0;

  for (let i = 0; i < list.length; i++) {
    let blob = null;
    try {
      blob = await canvasToBlob(renderFull(list[i]), mime, 0.95);
    } catch (err) {
      console.error('не удалось отрисовать карточку для экспорта', i, err);
    }
    if (!blob) { failed++; continue; }
    const name = (i === 0 && list[i].kind === 'cover' ? '00-oblozhka' : String(i).padStart(2, '0') + '-kartochka') + '.' + ext;
    rendered.push({ name, blob });
  }
  if (!rendered.length) { say('Не удалось подготовить файлы'); return; }

  if (state.exportZip) {
    const files = await Promise.all(rendered.map(async r =>
      ({ name: r.name, data: new Uint8Array(await r.blob.arrayBuffer()) })));
    downloadBlob(new Blob([buildZip(files)], { type: 'application/zip' }), 'card-maker-export.zip');
  } else {
    for (const r of rendered) {
      downloadBlob(r.blob, r.name);
      await new Promise(res => setTimeout(res, 350));
    }
  }
  say(failed ? `Скачано: ${rendered.length}, не получилось: ${failed}` : 'Скачано: ' + rendered.length);
}

async function copyCurrent() {
  const card = allCards()[state.current];
  if (!card) return;
  try {
    const blob = await canvasToBlob(renderFull(card), 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    say('Карточка скопирована');
  } catch {
    say('Браузер не дал доступ к буферу — используй экспорт');
  }
}

async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) { await setPhoto(state.current, await item.getType(type)); return; }
    }
    const text = await navigator.clipboard.readText();
    if (text) { insertText(text); return; }
    say('В буфере пусто');
  } catch {
    say('Нажми ⌘V на клавиатуре — так браузер разрешает вставку');
  }
}

/* Вставляет разметку в место курсора, не полагаясь на команды браузера. */
function insertMarkup(markup) {
  pushUndo();
  const range = getCaretOffset(el.cardsText) || state.lastCaret || { start: 0, end: 0 };
  const chars = markupToChars(state.cardsText);
  const added = markupToChars(markup);
  chars.splice(range.start, range.end - range.start, ...added);
  state.cardsText = charsToMarkup(chars);
  setEditorValue(state.cardsText, false);
  const caret = range.start + added.length;
  setCaretOffset(el.cardsText, caret, caret);
  state.lastCaret = { start: caret, end: caret };
  onEditorInput();
}

function insertText(text) {
  insertMarkup(clipboardPlainToMarkup(text));
  say('Текст вставлен');
}

function onEditorInput() {
  pushUndo();   // снимок хватает СТАРЫЙ state.cardsText — пишем его до переприсвоения ниже
  state.cardsText = editorValue();
  syncCards(); buildPreviews(); saveProject();
  syncTypographyControls();
  revealActiveCard();
}

/* ------------------------------------------- к какой карточке применять настройки */

/*
 * Считает, какие карточки задевает выделение в поле ввода.
 * Возвращает индексы в state.cards; если поле не в фокусе — карточку,
 * выделенную в превью.
 */
function selectedCardIndexes() {
  if (state.focusZone === 'coverTitle') return { cover: 'title' };
  if (state.focusZone === 'coverBody') return { cover: 'body' };
  if (state.focusZone === 'preview') {
    return state.current > 0 ? [state.current - 1] : { cover: 'title' };
  }

  // фокус мог уйти на список или ползунок — берём последнее положение курсора
  const inEditor = el.cardsText.contains(document.activeElement) ||
                   document.activeElement === el.cardsText;
  const range = (inEditor ? editorSelection() : null) || state.lastCaret;
  if (!range) return state.current > 0 ? [state.current - 1] : { cover: 'title' };

  // считаем по тому же тексту, по которому вычислены смещения курсора
  const text = editorText(el.cardsText);
  const from = range.start, to = range.end;

  const touched = [];
  let cardIndex = -1;
  let offset = 0;
  for (const line of text.split('\n')) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    if (/^\/\/\s*\d*\s*[+-]?\s*$/.test(line.trim())) cardIndex++;
    // текст до первой метки //  parseCards() отбрасывает при сборке карточек,
    // поэтому курсор в нём не должен считаться попаданием в «карточку 1»
    // строка попадает в выделение (или в неё стоит каретка)
    const inside = from <= lineEnd && to >= lineStart;
    if (inside && cardIndex >= 0 && !touched.includes(cardIndex)) touched.push(cardIndex);
    offset = lineEnd + 1;
  }
  return touched;
}

/*
 * Пока пишешь текст пятой карточки, её превью само подкручивается в вид,
 * чтобы не искать его глазами и не листать вручную.
 */
function revealActiveCard() {
  if (state.focusZone !== 'editor') return;
  const idx = selectedCardIndexes();
  if (!Array.isArray(idx) || !idx.length) return;

  const target = idx[0] + 1;                  // 0 — обложка
  if (target === state.current) return;

  selectCard(target, { keepZone: true });

  const frame = el.previews.querySelector('.frame[data-index="' + target + '"]');
  if (!frame) return;
  const item = frame.closest('.preview-item') || frame;
  if (item.scrollIntoView) {
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/* Есть ли выделенный кусок текста в поле карточек. */
function hasEditorSelection() {
  const range = getCaretOffset(el.cardsText) || state.lastCaret;
  return Boolean(range && range.end > range.start);
}

/* Запоминает, что пользователь работает в поле карточек, и где там курсор. */
function rememberEditorFocus() {
  const inEditor = el.cardsText.contains(document.activeElement) ||
                   document.activeElement === el.cardsText;
  if (!inEditor) return false;
  const range = editorSelection();
  if (range) state.lastCaret = range;
  state.focusZone = 'editor';
  return true;
}

/* Стиль, который сейчас показывают контролы: активной карточки или обложки. */
function activeStyleTarget() {
  const idx = selectedCardIndexes();
  if (idx && idx.cover) return { kind: 'cover', field: idx.cover };
  if (!idx || !idx.length) return { kind: 'cover', field: 'title' };
  return { kind: 'card', indexes: idx };
}

function effectiveStyle(cardIndex) {
  const card = state.cards[cardIndex];
  if (!card) return null;
  return Object.assign(defaultTypography(card), card.style || {});
}

/* Показывает в панели типографики настройки активной карточки. */
function syncTypographyControls() {
  const target = activeStyleTarget();
  let style;
  if (target.kind === 'cover') {
    const base = defaultTypography(state.cover);
    base.weight = target.field === 'title' ? 'Bold' : 'Medium';
    base.size = target.field === 'title' ? state.coverTitleSize : state.coverBodySize;
    style = Object.assign(base, state.coverStyles[target.field]);
  } else {
    style = effectiveStyle(target.indexes[0]);
  }
  if (!style) return;
  el.fontWeight.value = style.weight;
  setSelectValue(el.fontSize, style.size);
  el.lineHeight.value = String(style.lineHeight);
  el.letterSpacing.value = String(style.letterSpacing);
  el.alignGroup.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.align === style.align);
  });
  el.typoScope.textContent = target.kind === 'cover'
    ? (target.field === 'title' ? 'заголовок обложки' : 'подзаголовок обложки')
    : (target.indexes.length > 1
        ? 'карточки ' + target.indexes.map(i => i + 1).join(', ')
        : 'карточка ' + (target.indexes[0] + 1));
}

/* Ставит значение в список, добавляя пункт, если такого кегля в нём нет. */
function setSelectValue(select, value) {
  const text = String(value);
  if (![...select.options].some(o => o.value === text)) {
    const option = document.createElement('option');
    option.value = text;
    option.textContent = text;
    select.appendChild(option);
  }
  select.value = text;
}

/* Записывает изменённую настройку туда, где стоит выделение. */
function applyStylePatch(patch) {
  pushUndo();
  const target = activeStyleTarget();
  if (target.kind === 'cover') {
    Object.assign(state.coverStyles[target.field], patch);
    // кегль обложки живёт в степперах, держим их в согласии
    if (patch.size) {
      if (target.field === 'title') {
        state.coverTitleSize = patch.size;
        el.coverTitleSize.textContent = String(patch.size);
      } else {
        state.coverBodySize = patch.size;
        el.coverBodySize.textContent = String(patch.size);
      }
    }
  } else {
    for (const i of target.indexes) {
      const key = state.cardIds[i];
      if (!key) continue;
      state.cardStylesById[key] = Object.assign({}, state.cardStylesById[key] || {}, patch);
    }
  }
  syncCards(); scheduleRender(); saveProject();
}

/* --------------------------------------------------- форматирование текста */

/*
 * Оборачивает выделенный текст в разметку, а если он уже обёрнут — снимает её
 * и возвращает как было. Работает так же, как ⌘B / ⌘I в текстовом редакторе.
 */
/*
 * Меняет оформление выделенного текста.
 * Работает по посимвольной модели, поэтому результат одинаков во всех
 * браузерах и не зависит от команд редактирования.
 *
 * patch: { bold: 'toggle' } | { italic: 'toggle' } | { size: 48 } | { size: null }
 */
function restyleSelection(patch) {
  el.cardsText.focus();
  let range = getCaretOffset(el.cardsText) || state.lastCaret;
  if (!range) return false;

  const chars = markupToChars(state.cardsText);
  let { start, end } = range;

  // без выделения берём слово под курсором
  if (start === end) {
    while (start > 0 && chars[start - 1] && /\S/.test(chars[start - 1].ch)) start--;
    while (end < chars.length && chars[end] && /\S/.test(chars[end].ch)) end++;
    if (start === end) return false;
  }

  const picked = chars.slice(start, end).filter(c => c.ch !== '\n');
  if (!picked.length) return false;
  pushUndo();

  if (patch.bold === 'toggle') {
    const value = !picked.every(c => c.bold);
    for (let i = start; i < end; i++) if (chars[i]) chars[i].bold = value;
  }
  if (patch.italic === 'toggle') {
    const value = !picked.every(c => c.italic);
    for (let i = start; i < end; i++) if (chars[i]) chars[i].italic = value;
  }
  if ('size' in patch) {
    for (let i = start; i < end; i++) if (chars[i]) chars[i].size = patch.size;
  }

  state.cardsText = charsToMarkup(chars);
  setEditorValue(state.cardsText, false);
  setCaretOffset(el.cardsText, start, end);
  state.lastCaret = { start, end };
  state.focusZone = 'editor';
  syncCards(); buildPreviews(); saveProject();
  syncTypographyControls();
  return true;
}

function toggleMarkup(mark) {
  restyleSelection(mark === '**' ? { bold: 'toggle' } : { italic: 'toggle' });
}

/* ------------------------------------------------- отправка в Telegram */

/*
 * Готовые карточки отдаются системному окну «Поделиться» — оттуда их можно
 * отправить в Telegram, если приложение установлено. Браузер не умеет класть
 * файлы в чат напрямую, поэтому это самый короткий честный путь.
 */
async function sendToTelegram() {
  const list = allCards().filter(hasContent);
  if (!list.length) { say('Пока нечего отправлять'); return; }

  const mime = state.exportFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = state.exportFormat === 'jpeg' ? 'jpg' : 'png';
  const files = [];
  for (let i = 0; i < list.length; i++) {
    let blob = null;
    try {
      blob = await canvasToBlob(renderFull(list[i]), mime, 0.95);
    } catch (err) {
      console.error('не удалось отрисовать карточку для отправки', i, err);
    }
    if (!blob) continue;
    const name = (i === 0 && list[i].kind === 'cover' ? '00-oblozhka' : String(i).padStart(2, '0') + '-kartochka') + '.' + ext;
    files.push(new File([blob], name, { type: mime }));
  }
  if (!files.length) { say('Не удалось подготовить файлы'); return; }

  if (navigator.canShare && navigator.canShare({ files }) && navigator.share) {
    try {
      await navigator.share({ files, title: 'Карточки' });
      say('Отправлено');
    } catch (err) {
      if (err && err.name !== 'AbortError') say('Отправка отменена');
    }
    return;
  }

  // окна «Поделиться» нет — скачиваем и открываем Telegram
  await exportAll();
  window.open('https://web.telegram.org/', '_blank', 'noopener');
  say('Браузер не умеет отправлять файлы напрямую — карточки скачаны, Telegram открыт');
}

/* ------------------------------------------------------------ инструкция */

const HELP = [
  ['Как устроено окно',
   'Слева — превью всех карточек, посередине — текст, справа — типографика, ' +
   'трансформация картинки и экспорт. Углы панелей можно тянуть, меняя их размер.'],
  ['Отмена действий',
   'Две стрелки в начале нижней панели (или ⌘Z / ⌘⇧Z) — отменить/повторить. ' +
   'Работает для текста, фото, дублирования и перестановки карточек, ' +
   'автоматической разбивки, очистки рабочей зоны — для всего, что меняет ' +
   'содержимое проекта. Быстрые правки подряд схлопываются в один шаг. Поля ' +
   'заголовка и подзаголовка обложки не затрагивает — там штатный ' +
   'браузерный undo.'],
  ['Обложка',
   'Заголовок и подзаголовок набираются в двух верхних полях. Кегль каждого ' +
   'меняется кнопками − и + справа от поля. Начертание, трекинг и выключку ' +
   'заголовка и подзаголовка можно настроить по отдельности: поставь курсор ' +
   'в нужное поле и меняй настройки справа.'],
  ['Карточки карусели',
   'Пишутся одним текстом в нижнем поле. Строка //1 начинает новую карточку: ' +
   'пока фотографии нет — она белая, добавишь фото — сама станет карточкой ' +
   'с фотографией сверху. Строка //2- оставит карточку белой навсегда. ' +
   'Если просто вставить большой кусок текста без меток // (абзацы разделены ' +
   'пустой строкой), кнопка «Разбить автоматически» над полем сама расставит ' +
   'метки — ровно один абзац на одну карточку, без склейки нескольких абзацев ' +
   'в одну и без разрезания абзаца на части. Если строка-заголовок (без точки ' +
   'на конце) отделена от своего текста пустой строкой — эта пустая строка ' +
   'не считается границей, заголовок с текстом всё равно попадут на одну ' +
   'карточку. Заменяет текущую раскладку, поэтому спрашивает подтверждение.'],
  ['Переполнение текста',
   'Если текста на карточке больше, чем помещается без наложения на фото ' +
   'или верхний край, в углу превью появляется жёлтый кружок с «!». ' +
   'Уменьши кегль или межстрочный интервал, либо вручную перенеси часть ' +
   'текста на другую карточку — «Разбить автоматически» тут не поможет, ' +
   'она режет только по абзацам, а не по тому, помещается текст или нет.'],
  ['Форматирование',
   'Выдели текст и нажми ⌘B или ⌘I — или кнопки B и I внизу. Форматирование ' +
   'сразу видно в поле. Повторное нажатие снимает его. Строка целиком жирная ' +
   'становится подзаголовком карточки и набирается крупным кеглем. ' +
   'Пустая строка — отступ в одну строку.'],
  ['Вставка из других программ',
   'Текст из Google Документов, Telegram и Word вставляется вместе с жирным ' +
   'и курсивом — форматирование не теряется.'],
  ['Фотографии',
   'Перетащи файл на нужное превью, либо выдели превью и нажми ⌘V, либо ' +
   'используй первую кнопку внизу. Колесо мыши на превью — масштаб, ' +
   'перетаскивание — сдвиг кадра. Точные значения — в блоке «Трансформация». ' +
   'Если перетащить или выбрать сразу несколько фото, они разложатся по ' +
   'карточкам по порядку, пропуская карточки без фото (//N-). Крестик ' +
   'в углу превью (появляется, если на карточке есть фото) убирает фото ' +
   'обратно — текст при этом не трогается.'],
  ['Дублирование карточки',
   'Кнопка со сложенными квадратами внизу копирует выбранную карточку ' +
   'карусели целиком — текст, фото, ручные настройки — и ставит копию ' +
   'сразу за оригиналом с новым номером в метке.'],
  ['Порядок карточек',
   'Значок «⠿» рядом с названием карточки (кроме обложки) — потяни за него ' +
   'и перетащи на другую карточку, чтобы поменять их местами. Текст, фото ' +
   'и настройки переезжают вместе с карточкой.'],
  ['Типографика',
   'Настройки применяются туда, где стоит курсор: к выбранной карточке или ' +
   'к полю обложки. Область действия написана зелёным рядом со словом ' +
   '«Типография». Если выделить текст сразу в нескольких карточках, ' +
   'настройка применится ко всем.'],
  ['Висячие предлоги',
   'Короткие слова — в, на, и, для — не остаются в конце строки: ' +
   'они автоматически переносятся вместе со следующим словом.'],
  ['Экспорт',
   'Кнопка Export справа или иконка со стрелкой внизу сохраняют все карточки. ' +
   'Формат файла — PNG или JPG, разрешение — 1×/2×/3× от 1080 пикселей. ' +
   'Галочка «Одним ZIP-архивом» — вместо файла за файлом скачивается один ' +
   'архив со всеми карточками. Кнопка с самолётиком отдаёт карточки ' +
   'в системное окно «Поделиться», откуда их можно отправить в Telegram. ' +
   '⌘C копирует выбранную карточку в буфер обмена.'],
  ['Шаблоны',
   'Иконка с сеткой внизу — логотипы проекта и переключение между проектами. ' +
   'Там же, внизу списка — «Сохранить проект в файл» и «Загрузить проект ' +
   'из файла»: весь текст и настройки (без фото) можно перенести на другой ' +
   'компьютер или сохранить как резервную копию. ' +
   'Иконка с карандашом — размер карточки и настройка затемнения на обложке.'],
];

function openHelp() {
  const body = document.getElementById('helpBody');
  body.innerHTML = '<h2>Инструкция</h2>' + HELP.map(([title, text]) =>
    '<section><h3>' + title + '</h3><p>' + text + '</p></section>').join('');
  document.getElementById('helpModal').hidden = false;
}

function closeHelp() {
  document.getElementById('helpModal').hidden = true;
}

/* ------------------------------------------------------------------ меню */

function closeMenu() { el.menu.classList.remove('open'); }

function openMenu(anchor, items) {
  el.menu.innerHTML = '';
  for (const item of items) {
    if (item.divider) { el.menu.appendChild(document.createElement('hr')); continue; }
    if (item.groupLabel) {
      const l = document.createElement('div');
      l.className = 'group-label';
      l.textContent = item.groupLabel;
      el.menu.appendChild(l);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.textContent = item.checked ? '✓' : '';
    b.appendChild(tick);
    b.appendChild(document.createTextNode(item.label));
    b.addEventListener('click', () => { closeMenu(); item.action(); });
    el.menu.appendChild(b);
  }
  placeMenu(anchor);
}

function placeMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  el.menu.classList.add('open');
  const width = el.menu.offsetWidth;
  const height = el.menu.offsetHeight;
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  let top = rect.top - height - 8;
  if (top < 12) top = rect.bottom + 8;
  el.menu.style.left = left + 'px';
  el.menu.style.top = top + 'px';
}

function formatMenu(anchor) {
  const items = Object.keys(FORMATS).map(name => ({
    label: name, checked: name === state.format,
    action: () => { state.format = name; scheduleRender(); saveProject(); say('Формат: ' + name); },
  }));
  items.push({ divider: true }, { groupLabel: 'Затемнение обложки' });
  openMenu(anchor, items);
  appendGradientSliders();
  placeMenu(anchor);
}

function appendGradientSliders() {
  const g = currentGradient();
  const rows = [
    { key: 'height', title: 'Высота', min: 5, max: 100 },
    { key: 'opacity', title: 'Плотность', min: 0, max: 100 },
    { key: 'softness', title: 'Плавность', min: 5, max: 100 },
  ];
  for (const row of rows) {
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    const head = document.createElement('div');
    head.className = 'slider-head';
    const name = document.createElement('span');
    name.textContent = row.title;
    const value = document.createElement('output');
    value.textContent = Math.round(g[row.key] * 100) + '%';
    head.append(name, value);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(row.min); input.max = String(row.max);
    input.value = String(Math.round(g[row.key] * 100));
    input.addEventListener('input', () => {
      const tpl = state.templates[state.templateName];
      tpl.gradient = Object.assign({}, currentGradient(), { [row.key]: Number(input.value) / 100 });
      value.textContent = input.value + '%';
      scheduleRender();
    });
    input.addEventListener('change', saveTemplates);
    wrap.append(head, input);
    el.menu.appendChild(wrap);
  }
}

let pendingAssetKind = null;

function templatesMenu(anchor) {
  const items = [{ groupLabel: 'Проект' }];
  for (const name of Object.keys(state.templates)) {
    items.push({
      label: name, checked: name === state.templateName,
      action: async () => {
        state.templateName = name;
        if (!state.assets[name]) await prepareAssets(name);
        scheduleRender(); saveProject();
      },
    });
  }
  items.push({ divider: true }, {
    label: 'Новый проект…',
    action: async () => {
      const name = prompt('Название проекта:');
      if (!name) return;
      if (state.templates[name]) {
        say('Проект «' + name + '» уже есть — выбери его в списке или введи другое имя');
        return;
      }
      state.templates[name] = { logo: null, logoDark: null, gradient: null };
      state.templateName = name;
      saveTemplates();
      await prepareAssets(name);
      scheduleRender();
    },
  });
  items.push({ divider: true }, { groupLabel: 'Файлы шаблона' },
    { label: 'Логотип светлый…', action: () => pickAsset('logo') },
    { label: 'Логотип тёмный…', action: () => pickAsset('logoDark') });

  const tpl = state.templates[state.templateName] || {};
  if (tpl.logo || tpl.logoDark) {
    items.push({
      label: 'Вернуть логотипы по умолчанию',
      action: async () => {
        state.templates[state.templateName] =
          { logo: null, logoDark: null, gradient: tpl.gradient || null };
        saveTemplates();
        await prepareAssets(state.templateName);
        scheduleRender();
        say('Вернул встроенные логотипы');
      },
    });
  }
  if (Object.keys(state.templates).length > 1) {
    items.push({
      label: 'Удалить этот проект',
      action: async () => {
        delete state.templates[state.templateName];
        delete state.assets[state.templateName];
        state.templateName = Object.keys(state.templates)[0];
        saveTemplates();
        if (!state.assets[state.templateName]) await prepareAssets(state.templateName);
        scheduleRender();
      },
    });
  }
  items.push({ divider: true }, { groupLabel: 'Резервная копия' },
    { label: 'Сохранить проект в файл…', action: exportProjectFile },
    { label: 'Загрузить проект из файла…', action: importProjectFile });
  openMenu(anchor, items);
}

function pickAsset(kind) {
  pendingAssetKind = kind;
  el.assetPicker.value = '';
  el.assetPicker.click();
}

/* --------------------------------------------------------------- отмена */

/*
 * Снимок состояния для отмены/повтора: всё, что реально меняют действия
 * пользователя — текст, стили, фото. Фото — просто ссылки на уже
 * загруженные Image, копирование снимка их не декодирует заново и почти
 * ничего не стоит по памяти; cardStylesById/coverStyles/transformsById —
 * маленькие плоские объекты, их клонируем по-настоящему, чтобы более
 * позднее изменение не задело сохранённый снимок задним числом.
 */
function snapshotState() {
  return {
    coverTitle: state.cover.title, coverBody: state.cover.body,
    coverImg: state.cover.img,
    coverZoom: state.cover.zoom, coverPanX: state.cover.panX,
    coverPanY: state.cover.panY, coverRotate: state.cover.rotate,
    coverTitleSize: state.coverTitleSize, coverBodySize: state.coverBodySize,
    cardsText: state.cardsText,
    coverStyles: JSON.parse(JSON.stringify(state.coverStyles)),
    cardStylesById: JSON.parse(JSON.stringify(state.cardStylesById)),
    transformsById: JSON.parse(JSON.stringify(state.transformsById)),
    photosById: Object.assign({}, state.photosById),
    current: state.current,
  };
}

function restoreSnapshot(snap) {
  state.cover.title = snap.coverTitle; state.cover.body = snap.coverBody;
  state.cover.img = snap.coverImg;
  state.cover.zoom = snap.coverZoom; state.cover.panX = snap.coverPanX;
  state.cover.panY = snap.coverPanY; state.cover.rotate = snap.coverRotate;
  state.coverTitleSize = snap.coverTitleSize; state.coverBodySize = snap.coverBodySize;
  state.cardsText = snap.cardsText;
  state.coverStyles = snap.coverStyles;
  state.cardStylesById = snap.cardStylesById;
  state.transformsById = snap.transformsById;
  state.photosById = snap.photosById;

  fillControls();
  syncCards();
  buildPreviews();
  syncTypographyControls();
  saveProject();
  selectCard(Math.min(snap.current, state.cards.length), { keepZone: true });
}

const UNDO_LIMIT = 100;
const UNDO_COALESCE_MS = 600;   // быстрые повторы одного и того же действия — один шаг отмены
let lastUndoPushAt = 0;

/*
 * Запоминает состояние ДО изменения — вызывается первой строкой в каждой
 * функции, которая меняет текст/стили/фото. Быстрые повторы (печать,
 * перетаскивание ползунка, серия кликов подряд) схлопываются в один шаг —
 * иначе на каждую букву была бы отдельная отмена, как и в обычных редакторах.
 */
function pushUndo() {
  const now = Date.now();
  if (now - lastUndoPushAt < UNDO_COALESCE_MS) return;
  lastUndoPushAt = now;
  state.undoStack.push(snapshotState());
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
  state.redoStack.length = 0;
  syncUndoButtons();
}

function undo() {
  if (!state.undoStack.length) { say('Нечего отменять'); return; }
  state.redoStack.push(snapshotState());
  restoreSnapshot(state.undoStack.pop());
  lastUndoPushAt = 0;   // следующее действие должно снова создать свой шаг
  syncUndoButtons();
  say('Отменено');
}

function redo() {
  if (!state.redoStack.length) { say('Нечего повторить'); return; }
  state.undoStack.push(snapshotState());
  restoreSnapshot(state.redoStack.pop());
  lastUndoPushAt = 0;
  syncUndoButtons();
  say('Повторено');
}

function syncUndoButtons() {
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  if (btnUndo) btnUndo.disabled = !state.undoStack.length;
  if (btnRedo) btnRedo.disabled = !state.redoStack.length;
}

/* --------------------------------------------------------------- очистка */

function clearAll() {
  pushUndo();
  state.cover.title = ''; state.cover.body = '';
  state.cover.img = null; state.cover.zoom = 1; state.cover.panX = 0; state.cover.panY = 0;
  state.cardsText = '';
  state.photosById = {};
  state.cards = [];
  state.cardIds = [];
  state.cardStylesById = {};
  state.transformsById = {};
  state.coverStyles = { title: {}, body: {} };
  state.focusZone = 'editor';
  state.lastCaret = null;
  state.current = 0;
  el.coverTitle.value = '';
  el.coverBody.value = '';
  setEditorValue('', false);
  syncCards(); buildPreviews(); saveProject();
  say('Рабочая зона очищена');
}

/*
 * Разбивает вставленный текст на карточки: пустая строка — граница абзаца,
 * каждый абзац становится ровно одной карточкой — один в один, без попыток
 * упаковать несколько абзацев в одну карточку или растащить длинный абзац
 * на несколько.
 *
 * Исключение — заголовок: если накопленная карточка сейчас состоит ровно
 * из одной строки и та не заканчивается точкой, это заголовок («Шоколад» —
 * Джоан Харрис», «Зона мастер-классов»), а не законченный абзац. Пустая
 * строка сразу после такого заголовка — просто отступ перед текстом, а не
 * граница карточки, поэтому она пропускается, и следующий абзац
 * приклеивается к заголовку в одну карточку. Если же заголовок с текстом
 * уже были на соседних строках без пустой строки между ними — они и так
 * в одном абзаце, это исключение просто не срабатывает.
 *
 * Длинный абзац может не поместиться на карточку целиком — тогда сработает
 * индикатор переполнения (см. renderCard), и его можно будет разбить вручную.
 * Существующие метки //N в тексте не сохраняются — функция предполагается
 * для только что вставленного текста, а не для правки готовой раскладки.
 */
function autoSplitText() {
  const isHeadingOnly = block => block.length === 1 && !block[0].trim().endsWith('.');

  const paragraphs = [];
  let current = [];
  for (const line of state.cardsText.split('\n')) {
    if (/^\/\/\s*\d*\s*[+-]?\s*$/.test(line.trim())) continue;   // старые метки не переносим
    if (!line.trim()) {
      if (current.length && !isHeadingOnly(current)) { paragraphs.push(current); current = []; }
      continue;
    }
    current.push(line);
  }
  if (current.length) paragraphs.push(current);
  if (!paragraphs.length) { say('Сначала добавь текст, который нужно разбить'); return; }

  if (!confirm('Текущая раскладка на карточки будет заменена — метки //N расставятся заново, по одному абзацу на карточку. Продолжить?')) return;
  pushUndo();

  state.cardsText = paragraphs
    .map((lines, i) => '//' + (i + 1) + '\n' + lines.join('\n'))
    .join('\n\n');
  setEditorValue(state.cardsText, false);
  syncCards(); buildPreviews(); saveProject();
  say('Разбито на карточек: ' + paragraphs.length);
}

/* --------------------------------------------------------------- события */

function wireEvents() {
  wirePreviewsBulkDrop();

  el.coverTitle.addEventListener('input', () => {
    pushUndo();   // снимок хватает СТАРЫЙ title — пишем его до переприсвоения ниже
    state.cover.title = el.coverTitle.value;
    scheduleRender(); saveProject();
  });
  el.coverBody.addEventListener('input', () => {
    pushUndo();
    state.cover.body = el.coverBody.value;
    scheduleRender(); saveProject();
  });

  document.querySelectorAll('.stepper').forEach(stepper => {
    stepper.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = Number(btn.dataset.step);
        const isTitle = stepper.dataset.for === 'coverTitle';
        const key = isTitle ? 'coverTitleSize' : 'coverBodySize';
        state[key] = Math.max(8, Math.min(300, state[key] + delta));
        (isTitle ? el.coverTitleSize : el.coverBodySize).textContent = String(state[key]);
        syncCards(); scheduleRender(); saveProject();
      });
    });
  });

  el.cardsText.addEventListener('input', onEditorInput);
  ['click', 'keyup', 'focus'].forEach(ev =>
    el.cardsText.addEventListener(ev, () => {
      rememberEditorFocus();
      syncTypographyControls();
      revealActiveCard();
    }));
  document.addEventListener('selectionchange', () => {
    if (!rememberEditorFocus()) return;
    syncTypographyControls();
    revealActiveCard();
  });
  el.coverTitle.addEventListener('focus', () => { state.focusZone = 'coverTitle'; syncTypographyControls(); });
  el.coverBody.addEventListener('focus', () => { state.focusZone = 'coverBody'; syncTypographyControls(); });

  // вставка из Google Docs, Telegram и Word — с сохранением форматирования
  // межстрочное, трекинг и выключка — свойства карточки целиком
  const applyStyle = () => {
    applyStylePatch({
      lineHeight: Math.max(80, Math.min(250, Number(el.lineHeight.value) || 122)),
      letterSpacing: Math.max(-10, Math.min(50, Number(el.letterSpacing.value) || 0)),
    });
  };
  [el.lineHeight, el.letterSpacing].forEach(node => node.addEventListener('input', applyStyle));

  // кегль и начертание: если в поле есть выделение — только для него
  el.fontSize.addEventListener('change', () => {
    const size = Math.max(8, Math.min(300, Number(el.fontSize.value) || 36));
    if (state.focusZone === 'editor' && hasEditorSelection()) restyleSelection({ size });
    else applyStylePatch({ size });
  });

  el.fontWeight.addEventListener('change', () => {
    const bold = el.fontWeight.value === 'Bold';
    if (state.focusZone === 'editor' && hasEditorSelection()) {
      const range = getCaretOffset(el.cardsText) || state.lastCaret;
      const chars = markupToChars(state.cardsText);
      const picked = chars.slice(range.start, range.end).filter(c => c.ch !== '\n');
      if (picked.length && picked.every(c => c.bold) === bold) return;
      restyleSelection({ bold: 'toggle' });
    } else {
      applyStylePatch({ weight: el.fontWeight.value });
    }
  });

  el.alignGroup.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      el.alignGroup.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyStylePatch({ align: btn.dataset.align });
    });
  });

  el.exportFormat.addEventListener('change', () => {
    state.exportFormat = el.exportFormat.value;
    saveProject();
  });
  el.exportScale.addEventListener('change', () => {
    state.exportScale = Number(el.exportScale.value) || 1;
    saveProject();
  });
  el.exportZip.addEventListener('change', () => {
    state.exportZip = el.exportZip.checked;
    saveProject();
  });

  const applyTransform = () => {
    const card = allCards()[state.current];
    if (!card) return;
    card.zoom = 1 + Number(el.rngScale.value) / 100;
    card.panX = Number(el.rngOffsetX.value);
    card.panY = Number(el.rngOffsetY.value);
    card.rotate = Number(el.rngRotate.value);
    commitTransform(state.current);
    paintTransformOutputs();
    scheduleRender();
  };
  [el.rngScale, el.rngOffsetX, el.rngOffsetY, el.rngRotate]
    .forEach(node => node.addEventListener('input', applyTransform));

  document.getElementById('btnAutoSplit').addEventListener('click', autoSplitText);
  document.getElementById('btnBold').addEventListener('click', () => toggleMarkup('**'));
  document.getElementById('btnItalic').addEventListener('click', () => toggleMarkup('_'));

  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);
  document.getElementById('btnExportMain').addEventListener('click', exportAll);
  document.getElementById('btnExportBar').addEventListener('click', exportAll);
  document.getElementById('btnCopy').addEventListener('click', copyCurrent);
  document.getElementById('btnDuplicate').addEventListener('click', () => {
    if (state.current <= 0) { say('Выбери карточку карусели, чтобы её продублировать'); return; }
    duplicateCard(state.current - 1);
  });
  document.getElementById('btnPaste').addEventListener('click', pasteFromClipboard);
  document.getElementById('btnClear').addEventListener('click', clearAll);
  document.getElementById('btnTelegram').addEventListener('click', sendToTelegram);
  document.getElementById('btnHelp').addEventListener('click', openHelp);
  document.getElementById('helpClose').addEventListener('click', closeHelp);
  document.getElementById('helpModal').addEventListener('click', e => {
    if (e.target.id === 'helpModal') closeHelp();
  });
  document.getElementById('btnSelect').addEventListener('click', () => {
    el.filePicker.value = '';
    el.filePicker.click();
  });
  document.getElementById('btnFormat').addEventListener('click', e => {
    const open = el.menu.classList.contains('open');
    closeMenu();
    if (!open) formatMenu(e.currentTarget);
  });
  document.getElementById('btnTemplates').addEventListener('click', e => {
    const open = el.menu.classList.contains('open');
    closeMenu();
    if (!open) templatesMenu(e.currentTarget);
  });

  el.filePicker.addEventListener('change', async () => {
    const files = [...el.filePicker.files];
    if (!files.length) return;
    if (files.length === 1) { await setPhoto(state.current, files[0]); return; }
    const n = await distributePhotos(files, Math.max(1, state.current));
    say('Разложено фото по карточкам: ' + n);
  });

  el.assetPicker.addEventListener('change', () => {
    const file = el.assetPicker.files[0];
    if (!file || !pendingAssetKind) return;
    const reader = new FileReader();
    reader.onload = async () => {
      state.templates[state.templateName][pendingAssetKind] = reader.result;
      saveTemplates();
      await prepareAssets(state.templateName);
      scheduleRender();
      say('Загружено: ' + (pendingAssetKind === 'logo' ? 'светлый логотип' : 'тёмный логотип'));
      pendingAssetKind = null;
    };
    reader.readAsDataURL(file);
  });

  /*
   * Вставка обрабатывается в одном месте, иначе текст попадал бы в поле
   * дважды: сначала от обработчика поля, потом от обработчика окна.
   */
  window.addEventListener('paste', async e => {
    const data = e.clipboardData;
    if (!data) return;

    // картинка из буфера — в выбранную карточку
    const file = [...(data.items || [])]
      .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
      .map(it => it.getAsFile())[0];
    if (file) { e.preventDefault(); await setPhoto(state.current, file); return; }

    const target = e.target;
    // поля обложки вставляют текст сами
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    const html = data.getData('text/html');
    const plain = data.getData('text/plain');
    if (!html && !plain) return;
    e.preventDefault();
    const markup = html ? clipboardHtmlToMarkup(html) : clipboardPlainToMarkup(plain);
    insertMarkup(markup);
    say(html || markup !== plain ? 'Вставлено с форматированием' : 'Текст вставлен');
  });

  window.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const inField = document.activeElement &&
      (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    if (e.key === 's') { e.preventDefault(); exportAll(); }
    // если что-то выделено текстом на странице (например, в окне «Инструкция») —
    // ⌘C должен копировать этот текст, а не карточку
    const sel = window.getSelection();
    const hasTextSelection = Boolean(sel && sel.toString().length);
    if (e.key === 'c' && !inField && !hasTextSelection) { e.preventDefault(); copyCurrent(); }
    // отмена/повтор и форматирование — не в полях обложки, там свой нативный undo
    // (текстовые input не трогаем программной перезаписью, поэтому он и так работает)
    if (inField) return;
    if (e.key === 'b' || e.key === 'и') { e.preventDefault(); toggleMarkup('**'); }
    if (e.key === 'i' || e.key === 'ш') { e.preventDefault(); toggleMarkup('_'); }
    if (e.key === 'z' || e.key === 'я') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    if ((e.key === 'y' || e.key === 'н') && !e.shiftKey) { e.preventDefault(); redo(); }
  });

  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());
  document.addEventListener('click', e => {
    if (!el.menu.contains(e.target) && !e.target.closest('.bar button')) closeMenu();
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenu(); closeHelp(); }
  });
  window.addEventListener('resize', () => closeMenu());
}

/* ------------------------------------------------------ размеры панелей */

const STORE_PANELS = 'cardmaker.panels.v1';

/* Пользователь тянет угол панели — запоминаем размер до следующего раза. */
function setupPanelResize() {
  const panels = [...document.querySelectorAll('.panel')];
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_PANELS) || '{}'); } catch { saved = {}; }

  panels.forEach((panel, i) => {
    const size = saved[i];
    if (size) {
      if (size.w) panel.style.width = size.w + 'px';
      if (size.h) panel.style.height = size.h + 'px';
    }
  });

  if (typeof ResizeObserver === 'undefined') return;
  let timer = null;
  const observer = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const data = {};
      panels.forEach((panel, i) => {
        data[i] = { w: Math.round(panel.offsetWidth), h: Math.round(panel.offsetHeight) };
      });
      try { localStorage.setItem(STORE_PANELS, JSON.stringify(data)); } catch { /* не критично */ }
      scheduleRender();
    }, 300);
  });
  panels.forEach(panel => observer.observe(panel));
}

/* ---------------------------------------------------------------- запуск */

function fillControls() {
  el.coverTitle.value = state.cover.title;
  el.coverBody.value = state.cover.body;
  el.coverTitleSize.textContent = String(state.coverTitleSize);
  el.coverBodySize.textContent = String(state.coverBodySize);
  setEditorValue(state.cardsText, false);
  el.exportFormat.value = state.exportFormat;
  el.exportScale.value = String(state.exportScale);
  el.exportZip.checked = state.exportZip;
  syncTransformControls();
}

async function start() {
  paintIcons();
  loadTemplates();
  if (!loadProject()) state.cardsText = SAMPLE;
  await prepareAssets(state.templateName);
  fillControls();
  wireEvents();
  syncCards();
  buildPreviews();
  syncTypographyControls();
  setupPanelResize();
  syncUndoButtons();

  try {
    await Promise.all([
      document.fonts.load('700 60px CardFont'),
      document.fonts.load('500 45px CardFont'),
      document.fonts.load('italic 600 36px CardFont'),
    ]);
    await document.fonts.ready;
  } catch { /* если шрифт не подхватился, рисуем системным */ }
  state.fontsReady = true;
  renderAll();

  // офлайн-доступ: не критично, если недоступно (file://, старый браузер) —
  // страница и так работает, просто без кеша на случай отсутствия сети
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => { /* не критично */ });
  }
}

start();
