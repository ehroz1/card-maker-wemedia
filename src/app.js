/* Card Maker — интерфейс. Всё считается локально в браузере. */

const STORE_TEMPLATES = 'cardmaker.templates.v2';
const STORE_DRAFTS = 'cardmaker.drafts.v1';
// до черновиков проект был один на браузер — при первом запуске он переносится в черновики
const STORE_PROJECT_LEGACY = 'cardmaker.project.v3';
const STORE_THEME = 'cardmaker.theme.v1';
const MAX_DRAFTS = 40;
const ZOOM_MIN = 1, ZOOM_MAX = 2.5;
const FIT_MIN_RATIO = 0.7;    // «Уместить» не уменьшает кегль ниже 70% от макета
const UPSCALE_WARN = 1.25;    // фото растягивается больше чем на четверть — может выйти мыльным
const SELECTION_SIZES = [28, 32, 34, 36, 38, 40, 42, 44, 48, 52, 54, 60, 64, 68, 72, 80, 90];

const FORMAT_INFO = {
  '1080×1350': { name: 'Пост 4:5', short: '4:5', desc: 'Основной формат карусели в ленте Instagram.' },
  '1080×1080': { name: 'Квадрат 1:1', short: '1:1', desc: 'Квадратные карточки — для ленты и репостов.' },
  '1080×1920': { name: 'Stories 9:16', short: '9:16', desc: 'Вертикальный формат для Stories и обложек Reels.' },
};

const SAMPLE_COVER = {
  title: 'Как плавание изменило мою жизнь',
  body: 'Лаура Саламат — о пяти заплывах и 14 километрах',
};

const SAMPLE = `//1
_Лаура Саламат, Enterprise Architect — сооснователь сообщества IT-архитекторов Казахстана_

**Заголовок**

**Я занимаюсь плаванием** два с половиной года. За это время приняла участие в пяти заплывах и преодолела дистанцию в 14 километров.

//2
**Заголовок**

В бассейн я пришла ради _красоты_ и хорошей осанки. Но довольно быстро стало интереснее не то, как выглядит мое тело, а то, на что оно становится способно.`;

const TRANSFORM_KEYS = ['zoom', 'panX', 'panY', 'rotate', 'grayscale', 'brightness', 'contrast'];

const state = {
  screen: 'home',       // home | editor
  draftId: null,        // открытый черновик (см. «черновики»)
  draftName: '',        // имя, заданное вручную; пустое — берётся из обложки
  draftCreatedAt: 0,
  cover: { kind: 'cover', title: '', body: '', img: null, usePhoto: true,
           zoom: 1, panX: 0, panY: 0, rotate: 0,
           grayscale: false, brightness: 100, contrast: 100, style: null },
  coverTitleSize: 60,
  coverBodySize: 45,
  cardsText: '',
  // фото или видео (HTMLImageElement либо HTMLVideoElement) карточки, её
  // ручной стиль и трансформация хранятся по стабильному ключу карточки
  // (см. cardKeys), а не по позиции — иначе вставка, удаление или
  // перестановка карточки молча переносили бы их на соседнюю
  photosById: {},
  cardStylesById: {},
  transformsById: {},
  cardIds: [],          // ключи карточек state.cards, посчитанные последним syncCards()
  cards: [],            // разобранные карточки (пересобираются из текста)
  format: DEFAULT_FORMAT,
  exportFormat: 'png',
  exportScale: 1,       // множитель разрешения при экспорте (1×/2×/3×)
  exportMode: 'zip',    // что делает ⌘S: zip — одним архивом, files — файлами по одному
  coverStyles: { title: {}, body: {} },   // заголовок и подзаголовок обложки — отдельно
  coverTarget: 'title', // что правит блок «Типографика» на обложке
  templateName: null,
  templates: {},
  assets: {},
  current: 0,           // 0 — обложка, дальше карточки
  tab: 'slide',         // вкладка правой панели: slide | text | project
  overflow: [],         // по индексу allCards(): не помещается ли текст (по последней отрисовке)
  fontsReady: false,
  undoStack: [],
  redoStack: [],
  // фото и видео уже открывавшихся в этой вкладке черновиков — по id черновика.
  // В localStorage медиа не сохраняются (слишком большие), но пока вкладка
  // открыта, можно уйти к списку проектов и вернуться, не потеряв их
  sessionMedia: {},
};

const el = {};
['status', 'filePicker', 'assetPicker', 'exportProgress', 'exportProgressBar', 'cardsText',
 'home', 'editor', 'draftsSection', 'draftsRow', 'formatGrid', 'docName', 'docFormat',
 'exportPop', 'slidesList', 'stage', 'stageInner', 'stageCanvas', 'stageOverlay',
 'warnings', 'slideCounter', 'tabSlide', 'tabText', 'tabProject']
  .forEach(id => { el[id] = document.getElementById(id); });

/* ------------------------------------------------------------- мелочи */

let statusTimer = null;
function say(text) {
  el.status.textContent = text;
  el.status.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.status.classList.remove('show'), 3200);
}

function iconSvg(name) {
  return (typeof ICONS !== 'undefined' && ICONS[name]) || '';
}

/* Статичные значки из разметки: <span data-icon="plus"> → инлайн-SVG. */
function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => {
    const svg = iconSvg(node.dataset.icon);
    if (svg && !node.dataset.painted) {
      node.innerHTML = svg;
      node.dataset.painted = '1';
    }
  });
}

/* Короткий конструктор DOM-узлов для форм, которые собираются в коде. */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'icon') node.innerHTML = iconSvg(value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* Кнопка со значком и подписью (подпись необязательна). */
function btn(cls, icon, label, onclick, title) {
  const b = h('button', { type: 'button', class: cls, title, onclick });
  if (icon) b.append(h('span', { 'data-icon': icon, 'data-painted': '1', icon }));
  if (label) b.append(document.createTextNode(label));
  return b;
}

function iconBtn(icon, title, onclick, extra = '') {
  return h('button', { type: 'button', class: 'icon-btn ' + extra, title, 'aria-label': title, icon, onclick });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* Текст без разметки (**, _, кегль) — для подписей и имени черновика. */
function plainText(markup) {
  return markupToChars(markup).map(c => c.ch).join('').replace(/\s+/g, ' ').trim();
}

/*
 * Имя файла для скачивания из названия проекта — латиницей: кириллицу
 * в атрибуте download Chromium местами молча заменяет на «download»,
 * поэтому как и у слайдов (00-oblozhka), имена файлов только ASCII.
 */
const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
function fileSlug(text, fallback) {
  const slug = [...String(text || '').toLowerCase()].map(ch => (ch in TRANSLIT ? TRANSLIT[ch] : ch)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return slug || fallback;
}

function pluralRu(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function formatAgo(ts) {
  const diff = Math.max(0, Date.now() - ts) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) { const m = Math.round(diff / 60); return m + ' ' + pluralRu(m, 'минуту', 'минуты', 'минут') + ' назад'; }
  if (diff < 86400) { const hr = Math.round(diff / 3600); return hr + ' ' + pluralRu(hr, 'час', 'часа', 'часов') + ' назад'; }
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/* ----------------------------------------------------------------- тема */
/*
 * Тёмная тема — переключаемая, с запоминанием выбора. Пока пользователь
 * ничего не выбрал, следует системной настройке через CSS (@media
 * prefers-color-scheme) — атрибут data-theme на <html> тогда не ставится.
 * Явный выбор сохраняется в localStorage и перекрывает системную тему через
 * :root[data-theme=…]; применяется ещё до отрисовки маленьким скриптом
 * в <head> index.template.html, чтобы не мелькала не та тема.
 * Кнопок темы две (стартовый экран и редактор) — обе с классом .theme-btn.
 */
function systemPrefersDark() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
function isDarkActive() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : systemPrefersDark();
}
function syncThemeButton() {
  const dark = isDarkActive();
  document.querySelectorAll('.theme-btn').forEach(button => {
    button.title = dark ? 'Светлая тема' : 'Тёмная тема';
    button.innerHTML = iconSvg(dark ? 'sun' : 'moon');
  });
}
function toggleTheme() {
  const next = isDarkActive() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(STORE_THEME, next); } catch { /* приватный режим — просто не запомнится */ }
  syncThemeButton();
}

/* Режим «только превью»: прячет список слайдов и панель настроек. */
function toggleFocusMode(force) {
  const on = el.editor.classList.toggle('focus', force);
  document.getElementById('btnFocus').classList.toggle('active', on);
  requestAnimationFrame(renderStage);
}
/* ------------------------------------------------ установка на телефон */
/*
 * Приложение уже полноценный PWA (manifest.webmanifest + service-worker.js,
 * см. CLAUDE.md) — Android/Chrome сам предлагает установку через системное
 * UI, но по умолчанию хочет своего повода (не сразу при первом заходе) и
 * многие просто не замечают этой возможности. iOS вообще не имеет
 * программного API установки — там единственный путь: Поделиться → «На
 * экран «Домой»», и без подсказки почти никто об этом не знает. Баннер
 * ниже — единая точка входа для обоих случаев: на Android перехватывает
 * `beforeinstallprompt` и показывает свою кнопку «Установить», на iOS —
 * просто текстовую инструкцию (кнопки там нет и быть не может). Не
 * показывается повторно, если уже установлено (display-mode: standalone)
 * или если его один раз закрыли (запоминается в localStorage).
 */
const STORE_INSTALL_DISMISSED = 'cardmaker.installDismissed.v1';
let deferredInstallPrompt = null;

function isStandaloneDisplay() {
  return Boolean(
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone   // старое свойство Safari на iOS
  );
}

/* iPadOS с версии 13 представляется как обычный Mac (platform === 'MacIntel'),
   отличить от настоящего Mac можно только по наличию тачскрина. */
function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function hideInstallBanner() {
  document.getElementById('installBanner').hidden = true;
}

function dismissInstallBanner() {
  hideInstallBanner();
  try { localStorage.setItem(STORE_INSTALL_DISMISSED, '1'); } catch { /* не критично */ }
}

function showInstallBanner(mode) {
  const banner = document.getElementById('installBanner');
  const text = document.getElementById('installBannerText');
  const action = document.getElementById('installBannerAction');
  if (mode === 'ios') {
    text.textContent = 'Установи на телефон: нажми «Поделиться» внизу браузера → «На экран «Домой»».';
    action.hidden = true;
  } else {
    text.textContent = 'Установи это приложение на телефон — иконка на рабочем столе, работает офлайн.';
    action.hidden = false;
  }
  banner.hidden = false;
}

function wireInstallBanner() {
  let dismissed = false;
  try { dismissed = localStorage.getItem(STORE_INSTALL_DISMISSED) === '1'; } catch { /* не критично */ }
  if (dismissed || isStandaloneDisplay()) return;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();   // гасим стандартный мини-баннер браузера — показываем свой, единообразный
    deferredInstallPrompt = e;
    showInstallBanner('android');
  });

  if (isIosDevice()) showInstallBanner('ios');

  document.getElementById('installBannerAction').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    hideInstallBanner();
  });
  document.getElementById('installBannerClose').addEventListener('click', dismissInstallBanner);
  // приложение реально установили (через наш баннер или системный путь) — прятать больше незачем
  window.addEventListener('appinstalled', hideInstallBanner);
}

/* ------------------------------------------------------ шаблоны бренда */
/*
 * Шаблон бренда (меню «Проект → Шаблон бренда») — логотипы, затемнение
 * обложки и кегль/стиль обложки. Шаблоны общие для всех черновиков, каждый
 * черновик помнит, какой из них выбран (templateName).
 */
function loadTemplates() {
  try { state.templates = JSON.parse(localStorage.getItem(STORE_TEMPLATES) || '{}'); }
  catch { state.templates = {}; }
  if (!Object.keys(state.templates).length) {
    state.templates = { 'we-pr-обычный-пост': { logo: null, logoDark: null, gradient: null,
      coverTitleSize: 60, coverBodySize: 45, coverStyles: { title: {}, body: {} } } };
  }
  state.templateName = Object.keys(state.templates)[0];
}

/* Переносит текущий кегль/стиль обложки в активный шаблон, чтобы при
 * переключении на другой шаблон (см. templatesMenu) он восстанавливался. */
function syncTemplateDesign() {
  const tpl = state.templates[state.templateName];
  if (!tpl) return;
  tpl.coverTitleSize = state.coverTitleSize;
  tpl.coverBodySize = state.coverBodySize;
  tpl.coverStyles = JSON.parse(JSON.stringify(state.coverStyles));
  saveTemplates();
}

/* Достаёт кегль/стиль обложки из шаблона в state (при переключении шаблона). */
function applyTemplateDesign(name) {
  const tpl = state.templates[name] || {};
  state.coverTitleSize = tpl.coverTitleSize || 60;
  state.coverBodySize = tpl.coverBodySize || 45;
  state.coverStyles = tpl.coverStyles
    ? JSON.parse(JSON.stringify(tpl.coverStyles)) : { title: {}, body: {} };
  syncCards();
}

function saveTemplates() {
  try { localStorage.setItem(STORE_TEMPLATES, JSON.stringify(state.templates)); }
  catch { say('Не хватает места в браузере — логотип не сохранён'); }
}

/* ----------------------------------------------------------- черновики */
/*
 * Каждый проект — черновик в localStorage (STORE_DRAFTS): текст, настройки
 * и ручные стили карточек, без фото и видео. Список черновиков читается
 * заново перед каждой записью, а не держится в памяти, — так две открытые
 * вкладки с разными проектами не затирают черновики друг друга.
 * Раньше проект был один на браузер (STORE_PROJECT_LEGACY) — при первом
 * запуске он становится первым черновиком, старый ключ не трогаем.
 */
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function readDrafts() {
  let list = null;
  try { list = JSON.parse(localStorage.getItem(STORE_DRAFTS) || 'null'); } catch { list = null; }
  if (Array.isArray(list)) return list.filter(d => d && d.id && d.data);

  const drafts = [];
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(STORE_PROJECT_LEGACY) || 'null'); } catch { legacy = null; }
  if (legacy && typeof legacy.cardsText === 'string') {
    const now = Date.now();
    drafts.push({ id: newId(), name: '', createdAt: now, updatedAt: now, data: legacy });
  }
  writeDrafts(drafts);
  return drafts;
}

function writeDrafts(list) {
  try { localStorage.setItem(STORE_DRAFTS, JSON.stringify(list.slice(0, MAX_DRAFTS))); return true; }
  catch { return false; }
}

/* Имя черновика, если его не задали вручную: заголовок обложки или первая строка текста. */
function autoDraftName(data) {
  const cover = plainText(data.coverTitle || '') || plainText(data.coverBody || '');
  if (cover) return cover.slice(0, 60);
  for (const line of String(data.cardsText || '').split('\n')) {
    if (MARKER_RE.test(line.trim())) continue;
    const text = plainText(line);
    if (text) return text.slice(0, 60);
  }
  return 'Без названия';
}

function draftDisplayName(draft) {
  return draft.name || autoDraftName(draft.data);
}

/* Всё, что сохраняется в черновик и в файл проекта. */
function projectData() {
  return {
    coverTitle: state.cover.title, coverBody: state.cover.body,
    coverTitleSize: state.coverTitleSize, coverBodySize: state.coverBodySize,
    cardsText: state.cardsText, format: state.format,
    exportFormat: state.exportFormat, exportScale: state.exportScale, exportMode: state.exportMode,
    cardStylesById: state.cardStylesById, coverStyles: state.coverStyles,
    templateName: state.templateName,
  };
}

let draftSaveWarned = false;
function saveProject() {
  if (!state.draftId) return;
  const now = Date.now();
  const list = readDrafts().filter(d => d.id !== state.draftId);
  list.unshift({ id: state.draftId, name: state.draftName, createdAt: state.draftCreatedAt || now,
                 updatedAt: now, data: projectData() });
  if (!writeDrafts(list) && !draftSaveWarned) {
    draftSaveWarned = true;   // один раз, а не на каждую букву
    say('Не хватает места в браузере — черновик не сохраняется');
  }
}

/* Переносит сохранённый объект проекта (из черновика или из файла) в state. */
function applyProjectData(d) {
  state.cover.title = d.coverTitle || '';
  state.cover.body = d.coverBody || '';
  state.coverTitleSize = d.coverTitleSize || 60;
  state.coverBodySize = d.coverBodySize || 45;
  state.cardsText = d.cardsText || '';
  state.format = FORMATS[d.format] ? d.format : DEFAULT_FORMAT;
  if (d.exportFormat) state.exportFormat = d.exportFormat;
  if (d.exportScale && [1, 2, 3].includes(Number(d.exportScale))) state.exportScale = Number(d.exportScale);
  // у проектов старой версии вместо exportMode была галочка exportZip
  if (d.exportMode === 'zip' || d.exportMode === 'files') state.exportMode = d.exportMode;
  else if (d.exportZip === false) state.exportMode = 'files';
  state.cardStylesById = (d.cardStylesById && typeof d.cardStylesById === 'object') ? d.cardStylesById : {};
  state.coverStyles = Object.assign({ title: {}, body: {} }, d.coverStyles || {});
  if (d.templateName && state.templates[d.templateName]) state.templateName = d.templateName;
}

/* Чистое состояние проекта — перед открытием черновика или созданием нового. */
function resetProjectState() {
  Object.assign(state.cover, { title: '', body: '', img: null, zoom: 1, panX: 0, panY: 0, rotate: 0,
    grayscale: false, brightness: 100, contrast: 100 });
  state.cardsText = '';
  state.photosById = {};
  state.cardStylesById = {};
  state.transformsById = {};
  state.coverStyles = { title: {}, body: {} };
  state.coverTarget = 'title';
  state.format = DEFAULT_FORMAT;
  state.exportMode = 'zip';
  state.current = 0;
  state.overflow = [];
  state.undoStack = [];
  state.redoStack = [];
}

function stashSessionMedia() {
  if (!state.draftId) return;
  const coverTransform = {};
  TRANSFORM_KEYS.forEach(k => { coverTransform[k] = state.cover[k]; });
  state.sessionMedia[state.draftId] = {
    coverImg: state.cover.img, coverTransform,
    photosById: state.photosById, transformsById: state.transformsById,
  };
}

function restoreSessionMedia(id) {
  const m = state.sessionMedia[id];
  if (!m) return;
  state.cover.img = m.coverImg;
  Object.assign(state.cover, m.coverTransform);
  state.photosById = m.photosById;
  state.transformsById = m.transformsById;
}

function hasAnyMedia() {
  if (state.cover.img || Object.values(state.photosById).some(Boolean)) return true;
  return Object.entries(state.sessionMedia).some(([id, m]) =>
    id !== state.draftId && (m.coverImg || Object.values(m.photosById).some(Boolean)));
}

async function openDraft(id) {
  const draft = readDrafts().find(d => d.id === id);
  if (!draft) { say('Черновик не найден'); renderHome(); return; }
  stashSessionMedia();
  resetProjectState();
  state.draftId = draft.id;
  state.draftName = draft.name || '';
  state.draftCreatedAt = draft.createdAt || draft.updatedAt || Date.now();
  applyProjectData(draft.data);
  restoreSessionMedia(draft.id);
  if (!state.assets[state.templateName]) await prepareAssets(state.templateName);
  showEditor();
}

async function createDraft(format, withSample) {
  stashSessionMedia();
  resetProjectState();
  state.draftId = newId();
  state.draftName = '';
  state.draftCreatedAt = Date.now();
  state.format = format;
  applyTemplateDesign(state.templateName);   // кегль и стиль обложки — из шаблона бренда
  if (withSample) {
    state.cover.title = SAMPLE_COVER.title;
    state.cover.body = SAMPLE_COVER.body;
    state.cardsText = SAMPLE;
  } else {
    state.cardsText = '//1\n';
  }
  if (!state.assets[state.templateName]) await prepareAssets(state.templateName);
  saveProject();
  showEditor();
  if (!withSample) say('Пустой проект: обложка и одна карточка');
}

function deleteDraft(id) {
  writeDrafts(readDrafts().filter(d => d.id !== id));
  delete state.sessionMedia[id];
  renderHome();
}

/* Сохраняет проект (без фото — как и черновик) отдельным файлом. */
function exportProjectFile() {
  const blob = new Blob([JSON.stringify(projectData(), null, 2)], { type: 'application/json' });
  const name = fileSlug(state.draftName || autoDraftName(projectData()), 'card-maker-project');
  downloadBlob(blob, name + '.json');
  say('Проект сохранён в файл');
}

/* Открывает проект из файла, сохранённого exportProjectFile(), как новый черновик. */
function importProjectFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let d = null;
      try { d = JSON.parse(reader.result); } catch { d = null; }
      if (!d || typeof d !== 'object' || typeof d.cardsText !== 'string') {
        say('Файл не похож на проект Card Maker');
        return;
      }
      stashSessionMedia();
      resetProjectState();
      state.draftId = newId();
      state.draftName = file.name.replace(/\.json$/i, '');
      state.draftCreatedAt = Date.now();
      applyProjectData(d);
      if (!state.assets[state.templateName]) await prepareAssets(state.templateName);
      saveProject();
      showEditor();
      say('Проект открыт — фото и видео нужно добавить заново');
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
      grayscale: t.grayscale || false,
      brightness: t.brightness || 100,
      contrast: t.contrast || 100,
      style: state.cardStylesById[key] || {},
    };
  });
  state.cover.style = { size: state.coverBodySize, headingSize: state.coverTitleSize };
  state.cover.titleStyle = Object.assign({}, state.coverStyles.title);
  state.cover.bodyStyle = Object.assign({}, state.coverStyles.body);
  if (state.current > state.cards.length) state.current = state.cards.length;
  state.overflow.length = state.cards.length + 1;
}

/* Записывает текущий zoom/pan/rotate карточки под её позицией в storage по ключу. */
function commitTransform(index) {
  if (index <= 0) return;              // у обложки трансформация хранится прямо в state.cover
  const key = state.cardIds[index - 1];
  const card = state.cards[index - 1];
  if (!key || !card) return;
  state.transformsById[key] = {
    zoom: card.zoom, panX: card.panX, panY: card.panY, rotate: card.rotate,
    grayscale: card.grayscale, brightness: card.brightness, contrast: card.contrast,
  };
}

function allCards() {
  return [state.cover].concat(state.cards);
}

function cardLabel(i) {
  return i === 0 ? 'Обложка' : 'Карточка ' + i;
}

function hasPhoto(card) {
  return Boolean(card && card.usePhoto && card.img);
}

/* Можно ли вообще поставить фото на этот слайд (карточка //N- — нельзя). */
function canHavePhoto(card) {
  return Boolean(card && (card.kind === 'cover' || card.usePhoto));
}

/* -------------------------------------------------- блоки текста карточек */
/*
 * Весь текст карточек — одна разметка (state.cardsText) с метками //N.
 * Вкладка «Весь текст» правит её целиком, форма слайда — только блок своей
 * карточки. Блок начинается строкой-меткой и идёт до следующей метки —
 * ровно так же, как его видит parseCards(). Если перед первой меткой есть
 * непустой текст, parseCards считает его отдельной карточкой без метки —
 * здесь это тоже блок (marker: null), иначе номера блоков разошлись бы
 * с номерами карточек. Пустые строки перед первым блоком — префикс.
 * joinBlocks(splitBlocks(t)) === t для любого текста.
 */
const MARKER_RE = /^\/\/\s*(\d+)?\s*([+-])?\s*$/;

function splitBlocks(text) {
  const lines = String(text || '').split('\n');
  const prefix = [];
  const blocks = [];
  let i = 0;
  while (i < lines.length && !lines[i].trim()) prefix.push(lines[i++]);
  let current = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (MARKER_RE.test(line.trim())) {
      current = { marker: line, body: [] };
      blocks.push(current);
    } else {
      if (!current) { current = { marker: null, body: [] }; blocks.push(current); }
      current.body.push(line);
    }
  }
  return { prefix, blocks };
}

function joinBlocks({ prefix, blocks }) {
  const out = prefix.slice();
  for (const b of blocks) {
    if (b.marker !== null) out.push(b.marker);
    out.push(...b.body);
  }
  return out.join('\n');
}

function maxMarkerNumber(blocks) {
  let max = 0;
  for (const b of blocks) {
    const m = b.marker && b.marker.trim().match(MARKER_RE);
    if (m && m[1]) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/* Пустые строки в конце блока — разделитель перед следующей карточкой в общем тексте. */
function trailingBlankCount(body) {
  let n = 0;
  while (n < body.length && !body[body.length - 1 - n].trim()) n++;
  return n;
}

/* Между карточками в общем тексте — пустая строка, чтобы его было удобно читать. */
function tidySeparators(blocks) {
  blocks.forEach((b, i) => {
    if (i < blocks.length - 1 && !trailingBlankCount(b.body)) b.body.push('');
  });
}

/* Текст карточки без метки и без хвостовых пустых строк — то, что видно в форме. */
function cardBody(cardIndex) {
  const b = splitBlocks(state.cardsText).blocks[cardIndex];
  if (!b) return '';
  return b.body.slice(0, b.body.length - trailingBlankCount(b.body)).join('\n');
}

function setCardBody(cardIndex, markup) {
  const parts = splitBlocks(state.cardsText);
  const b = parts.blocks[cardIndex];
  if (!b) return;
  const tail = b.body.slice(b.body.length - trailingBlankCount(b.body));
  b.body = (markup ? markup.split('\n') : []).concat(tail);
  state.cardsText = joinBlocks(parts);
}

/*
 * Переносит фото/стиль/трансформацию, если у карточек на тех же позициях
 * поменялись ключи (см. cardKeys) — например, метка //3 стала //3-.
 */
function remapCardKeys(oldKeys, newKeys) {
  for (const store of [state.photosById, state.cardStylesById, state.transformsById]) {
    const moved = [];
    oldKeys.forEach((key, i) => {
      const next = newKeys[i];
      if (next !== undefined && next !== key && key in store) { moved.push([next, store[key]]); delete store[key]; }
    });
    for (const [key, value] of moved) store[key] = value;
  }
}

/* После любой правки структуры: пересобрать карточки, интерфейс и черновик. */
function commitCardsText() {
  syncCards();
  refreshEditor();
  saveProject();
}

/* Новая пустая карточка сразу после слайда afterIndex (0 — после обложки). */
function addCard(afterIndex = state.current) {
  pushUndo();
  const parts = splitBlocks(state.cardsText);
  const pos = clamp(afterIndex, 0, parts.blocks.length);
  const num = maxMarkerNumber(parts.blocks) + 1;
  parts.blocks.splice(pos, 0, { marker: '//' + num, body: [''] });
  tidySeparators(parts.blocks);
  state.cardsText = joinBlocks(parts);
  syncCards();
  state.current = pos + 1;
  commitCardsText();
  setTab('slide');
  const editor = document.getElementById('cardEditor');
  if (editor) editor.focus();
}

/*
 * Дублирует карточку: копия её блока сразу за ней, с новым, ещё не занятым
 * номером в метке — чтобы у копии был свой стабильный ключ. Вместе с
 * текстом переносятся фото, ручной стиль и трансформация.
 */
async function duplicateCard(cardIndex) {
  const parts = splitBlocks(state.cardsText);
  const src = parts.blocks[cardIndex];
  if (!src) return;
  pushUndo();
  const m = src.marker && src.marker.trim().match(MARKER_RE);
  const sign = (m && m[2] === '-') ? '-' : '';
  const copy = { marker: '//' + (maxMarkerNumber(parts.blocks) + 1) + sign, body: src.body.slice() };
  parts.blocks.splice(cardIndex + 1, 0, copy);
  tidySeparators(parts.blocks);

  const oldKey = state.cardIds[cardIndex];
  state.cardsText = joinBlocks(parts);
  syncCards();
  const newKey = state.cardIds[cardIndex + 1];
  if (oldKey && newKey && oldKey !== newKey) {
    if (state.photosById[oldKey]) {
      try { state.photosById[newKey] = await cloneMediaForDuplicate(state.photosById[oldKey]); }
      catch (err) { say('Не удалось скопировать видео: ' + err.message); }
    }
    if (state.cardStylesById[oldKey]) state.cardStylesById[newKey] = Object.assign({}, state.cardStylesById[oldKey]);
    if (state.transformsById[oldKey]) state.transformsById[newKey] = Object.assign({}, state.transformsById[oldKey]);
  }
  state.current = cardIndex + 2;   // +1 за обложку, +1 — это уже сама копия
  commitCardsText();
  say('Карточка продублирована');
}

/*
 * Переставляет карточку: переставляется её блок в тексте. Фото/стиль/
 * трансформация переезжают сами — они привязаны к метке, а не к позиции.
 */
function moveCard(from, to) {
  const parts = splitBlocks(state.cardsText);
  if (from === to || from < 0 || to < 0 || from >= parts.blocks.length || to >= parts.blocks.length) return;
  pushUndo();
  parts.blocks.forEach((b, i) => { b.key = state.cardIds[i]; });
  const [moved] = parts.blocks.splice(from, 1);
  parts.blocks.splice(to, 0, moved);
  // карточка без метки может быть только первой — при перестановке даём ей
  // метку, а её фото и стиль переносим на новый ключ
  parts.blocks.forEach((b, i) => {
    if (b.marker === null && i > 0) b.marker = '//' + (maxMarkerNumber(parts.blocks) + 1);
  });
  tidySeparators(parts.blocks);
  state.cardsText = joinBlocks(parts);
  syncCards();
  remapCardKeys(parts.blocks.map(b => b.key), state.cardIds);
  state.current = to + 1;
  commitCardsText();
}

function deleteCard(cardIndex) {
  const parts = splitBlocks(state.cardsText);
  if (!parts.blocks[cardIndex]) return;
  pushUndo();
  const key = state.cardIds[cardIndex];
  parts.blocks.splice(cardIndex, 1);
  tidySeparators(parts.blocks);
  if (key) {
    delete state.photosById[key];
    delete state.cardStylesById[key];
    delete state.transformsById[key];
  }
  state.cardsText = joinBlocks(parts);
  state.current = Math.min(state.current, parts.blocks.length);
  commitCardsText();
  say('Карточка удалена — вернуть можно через ⌘Z');
}

/* «Фото на карточке»: метка //N (фото можно) ↔ //N- (всегда белая). */
function setCardUsePhoto(cardIndex, usePhoto) {
  const parts = splitBlocks(state.cardsText);
  const b = parts.blocks[cardIndex];
  if (!b) return;
  pushUndo();
  const m = b.marker && b.marker.trim().match(MARKER_RE);
  const num = (m && m[1]) || String(maxMarkerNumber(parts.blocks) + 1);
  b.marker = '//' + num + (usePhoto ? '' : '-');
  const oldKeys = state.cardIds.slice();
  state.cardsText = joinBlocks(parts);
  syncCards();
  remapCardKeys(oldKeys, state.cardIds);
  commitCardsText();
}

/* Очищает все слайды текущего проекта (сам черновик остаётся). */
function clearAll() {
  if (!confirm('Очистить обложку и все карточки? Вернуть можно через ⌘Z.')) return;
  pushUndo();
  Object.assign(state.cover, { title: '', body: '', img: null, zoom: 1, panX: 0, panY: 0, rotate: 0,
    grayscale: false, brightness: 100, contrast: 100 });
  state.cardsText = '//1\n';
  state.photosById = {};
  state.cardStylesById = {};
  state.transformsById = {};
  state.current = 0;
  commitCardsText();
  say('Слайды очищены');
}

/*
 * Копия медиа для дублированной карточки. Фото — одна и та же декодированная
 * картинка, ссылку можно смело шарить между двумя ключами. Видео — нет: это
 * DOM-элемент с одним currentTime на двоих, поэтому у копии должен быть свой
 * элемент (тот же источник), иначе перемотка или экспорт одной карточки
 * будет двигать и другую.
 */
function cloneMediaForDuplicate(media) {
  if (!(media instanceof HTMLVideoElement)) return Promise.resolve(media);
  return new Promise((resolve, reject) => {
    const clone = document.createElement('video');
    clone.muted = media.muted; clone.playsInline = true; clone.preload = 'auto';
    clone.trimStart = media.trimStart; clone.trimEnd = media.trimEnd;
    clone.durationUnknown = media.durationUnknown;
    clone.onloadeddata = () => { clone.currentTime = clone.trimStart || 0; resolve(clone); };
    clone.onerror = () => reject(new Error('не удалось скопировать видео'));
    wirePreviewLoop(clone);
    clone.src = media.currentSrc || media.src;
  });
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

function isVideoFile(file) {
  return file.type.startsWith('video/');
}

/* Годится ли файл (или DataTransferItem — у него тоже есть .type) в качестве медиа карточки. */
function isMediaFile(file) {
  return file.type.startsWith('image/') || isVideoFile(file);
}

/*
 * Готовит видео как медиа карточки: ждёт метаданные и первый декодированный
 * кадр, выставляет обрезку по умолчанию на весь ролик (video.trimStart/
 * trimEnd — обычные свойства, повешенные прямо на элемент, отдельного
 * хранилища под них не заводим). Источник — object URL, а не data URL как
 * у фото: видео не грузится целиком в память строкой base64, браузер
 * стримит его из Blob сам. Элемент НЕ немой — звук в предпросмотре (кнопка
 * «▶» на карточке, «▶ Просмотр» в окне обрезки) теперь слышен, раз он есть
 * и в экспорте (см. exportVideoCard). Немым видео становится только на
 * время самой записи экспорта — чтобы не звучало из колонок при экспорте
 * нескольких видео разом — и возвращается обратно сразу после.
 */
/*
 * Общий слушатель для обеих копий видео-элемента (fileToVideo и
 * cloneMediaForDuplicate) — зацикливает проигрывание предпросмотра внутри
 * выбранного промежутка (video.trimStart/trimEnd), пока video._previewPlaying.
 * На экспорт не влияет — там свой отдельный слушатель timeupdate в
 * exportVideoCard, а stopAllVideoPreviews() перед экспортом гасит эту петлю.
 */
function wirePreviewLoop(video) {
  video.addEventListener('timeupdate', () => {
    if (!video._previewPlaying) return;
    const end = video.trimEnd ?? video.duration;
    if (isFinite(end) && video.currentTime >= end - 0.02) {
      video.currentTime = video.trimStart || 0;
    }
  });
}

function fileToVideo(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (fn === reject) URL.revokeObjectURL(video.src);
      fn(arg);
    };
    video.onloadedmetadata = () => {
      video.trimStart = 0;
      // изредка браузер не знает длительность заранее (не дошита обложка
      // контейнера) — считаем это минутным роликом, чем совсем не давать обрезать
      video.trimEnd = isFinite(video.duration) ? video.duration : 60;
      video.durationUnknown = !isFinite(video.duration);
    };
    // canplay иногда срабатывает раньше loadeddata (и наоборот, в зависимости
    // от браузера/кодека) — берём что подоспеет первым, лишь бы кадр был готов
    video.onloadeddata = () => finish(resolve, video);
    video.oncanplay = () => finish(resolve, video);
    video.onerror = () => finish(reject, new Error('не удалось прочитать видео — неподдерживаемый формат или кодек'));
    // некоторые кодеки (например HEVC/H.265 из iPhone) не дают ни одного из
    // событий выше в браузерах без их поддержки — без таймаута файл бы завис
    // молча, без ошибки и без результата
    const timer = setTimeout(
      () => finish(reject, new Error('видео долго не загружается — возможно, браузер не поддерживает его формат')),
      20000
    );
    wirePreviewLoop(video);
    video.src = URL.createObjectURL(file);
  });
}

/*
 * Ищет, не используется ли уже точно такое же фото на другой карточке —
 * сравнением data: URI (fileToImage читает файл через FileReader.readAsDataURL,
 * так что одинаковые байты всегда дают одинаковую строку). Только для фото:
 * у видео свой object URL на каждую загрузку (см. fileToVideo), сравнивать их
 * между собой бессмысленно. Возвращает индекс в allCards() карточки-совпадения
 * или null.
 */
function findDuplicatePhotoOwner(index, src) {
  if (index !== 0 && state.cover.img instanceof HTMLImageElement && state.cover.img.src === src) return 0;
  for (let i = 0; i < state.cardIds.length; i++) {
    if (index === i + 1) continue;
    const img = state.photosById[state.cardIds[i]];
    if (img instanceof HTMLImageElement && img.src === src) return i + 1;
  }
  return null;
}

async function setPhoto(index, file, { skipUndo = false } = {}) {
  try {
    const media = isVideoFile(file) ? await fileToVideo(file) : await fileToImage(file);
    if (!skipUndo) pushUndo();
    if (index === 0) {
      state.cover.img = media;
      state.cover.zoom = 1; state.cover.panX = 0; state.cover.panY = 0; state.cover.rotate = 0;
      state.cover.grayscale = false; state.cover.brightness = 100; state.cover.contrast = 100;
    } else {
      const key = state.cardIds[index - 1];
      if (key === undefined) return;
      state.photosById[key] = media;
      delete state.transformsById[key];   // новое фото/видео — трансформация и фильтры сбрасываются
      const card = state.cards[index - 1];
      if (card) {
        card.img = media; card.zoom = 1; card.panX = 0; card.panY = 0; card.rotate = 0;
        card.grayscale = false; card.brightness = 100; card.contrast = 100;
      }
    }
    renderSlidesList();
    selectSlide(index, { force: true });
    scheduleRender();
    let statusText = media instanceof HTMLVideoElement ? 'Видео добавлено' : 'Фото добавлено';
    if (!(media instanceof HTMLVideoElement)) {
      const dupIndex = findDuplicatePhotoOwner(index, media.src);
      if (dupIndex !== null) statusText += ' — уже используется: ' + cardLabel(dupIndex).toLowerCase();
    }
    say(statusText);
    if (media instanceof HTMLVideoElement) {
      // спрашиваем обрезку сразу при загрузке, а не откладываем до экспорта —
      // «Отмена» тут просто оставляет ролик целиком (обрезка по умолчанию),
      // а не отменяет саму загрузку видео
      const card = allCards()[index];
      if (card) {
        await askVideoTrim([{ card, index }], {
          title: 'Обрезка видео',
          hint: 'Укажи начало и конец нужного фрагмента — остальное обрежется при экспорте. Потом это можно поменять кнопкой «Обрезать».',
          confirmLabel: 'Готово',
        });
      }
    }
  } catch (err) {
    say('Не получилось открыть файл: ' + err.message);
  }
}

/* Убирает фото/видео с карточки — на случай, если передумали. Текст не трогает. */
function removePhoto(index) {
  const card = allCards()[index];
  if (!card || !card.img) return;
  const wasVideo = card.img instanceof HTMLVideoElement;
  if (wasVideo) { card.img._previewPlaying = false; card.img.pause(); }
  pushUndo();
  if (index === 0) {
    state.cover.img = null;
    state.cover.zoom = 1; state.cover.panX = 0; state.cover.panY = 0; state.cover.rotate = 0;
    state.cover.grayscale = false; state.cover.brightness = 100; state.cover.contrast = 100;
  } else {
    const key = state.cardIds[index - 1];
    if (key === undefined) return;
    delete state.photosById[key];
    delete state.transformsById[key];
    card.img = null; card.zoom = 1; card.panX = 0; card.panY = 0; card.rotate = 0;
    card.grayscale = false; card.brightness = 100; card.contrast = 100;
  }
  refreshEditor();
  say(wasVideo ? 'Видео убрано' : 'Фото убрано');
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

/* ---------------------------------------------------------- отрисовка */
/*
 * Превью рисуются тем же renderCard(), что и экспорт, — видно ровно то, что
 * получится. Большое превью (сцена) — текущий слайд под размер окна,
 * миниатюры слева — все слайды. Попутно запоминается overflow каждого
 * слайда (текст не помещается) — для предупреждения под сценой и точки
 * у миниатюры.
 */
let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAll, 50);
}

function renderAll() {
  if (!state.fontsReady || state.screen !== 'editor') return;
  renderStage();
  renderThumbs();
  renderWarnings();
  updateSlidesMeta();
}

function paintCard(canvas, card, index, cssWidth) {
  const [W, H] = FORMATS[state.format];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssWidth * dpr * H / W));
  const scale = canvas.width / W;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  try {
    const fixed = renderCard(ctx, card, [W, H], currentAssets(), currentGradient());
    // сдвиг кадра renderCard ограничивает границами фото — запоминаем исправленный
    card.panX = fixed.panX; card.panY = fixed.panY;
    commitTransform(index);
    state.overflow[index] = Boolean(fixed.overflow);
  } catch (err) {
    console.error('не удалось отрисовать слайд', index, err);
  }
}

function renderStage() {
  if (!state.fontsReady || state.screen !== 'editor') return;
  const card = allCards()[state.current];
  if (!card) return;
  const [W, H] = FORMATS[state.format];
  const cs = getComputedStyle(el.stage);
  const availW = el.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = el.stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const fit = Math.min(Math.max(availW, 120) / W, Math.max(availH, 120) / H);
  const cssW = Math.round(W * fit);
  el.stageCanvas.style.width = cssW + 'px';
  el.stageCanvas.style.height = Math.round(H * fit) + 'px';
  paintCard(el.stageCanvas, card, state.current, cssW);
  el.stageInner.classList.toggle('has-photo', hasPhoto(card));
  renderStageOverlay(card);
  el.slideCounter.textContent = (state.current + 1) + ' / ' + allCards().length;
  document.getElementById('btnPrev').disabled = state.current <= 0;
  document.getElementById('btnNext').disabled = state.current >= allCards().length - 1;
}

function renderThumbs() {
  const list = allCards();
  el.slidesList.querySelectorAll('.slide-item').forEach(item => {
    const i = Number(item.dataset.index);
    const canvas = item.querySelector('canvas');
    if (list[i] && canvas) paintCard(canvas, list[i], i, canvas.clientWidth || 160);
  });
}

/*
 * Поверх сцены: кнопка «Фото или видео» на пустом месте под фото, а у видео —
 * «смотреть/пауза» и «обрезать». Разметка пересобирается, только когда
 * меняется то, что в ней показано, — иначе во время проигрывания видео
 * (отрисовка ~25 раз в секунду) кнопки бы мигали.
 */
let overlaySignature = '';
function renderStageOverlay(card) {
  const isVideo = hasPhoto(card) && card.img instanceof HTMLVideoElement;
  const empty = canHavePhoto(card) && !card.img;
  const sig = [state.current, empty, isVideo, isVideo && card.img.paused, card.kind].join('|');
  if (sig === overlaySignature) return;
  overlaySignature = sig;
  el.stageOverlay.innerHTML = '';
  const index = state.current;
  if (empty) {
    const hint = btn('slot-hint', 'image', 'Фото или видео', () => pickMediaFor(index));
    // у карточки фото встаёт полосой сверху — туда и кнопку, чтобы не закрывать текст
    if (card.kind !== 'cover') hint.style.top = '22%';
    el.stageOverlay.append(hint);
  }
  if (isVideo) {
    const playing = !card.img.paused;
    el.stageOverlay.append(h('div', { class: 'media-tools' },
      btn('video', playing ? 'pause' : 'play', playing ? 'Пауза' : 'Смотреть', () => toggleVideoPreviewPlayback(index)),
      btn('', 'scissors', 'Обрезать', () => openTrimFor(index))));
  }
}

/* Во сколько раз фото растягивается при экспорте (больше 1 — пикселей не хватает). */
function photoUpscale(card) {
  if (!hasPhoto(card)) return 0;
  const img = card.img;
  const iw = img.videoWidth || img.naturalWidth || img.width;
  const ih = img.videoHeight || img.naturalHeight || img.height;
  if (!iw || !ih) return 0;
  const [W, H] = FORMATS[state.format];
  // обложка — фото на весь слайд; у карточки фото полосой во всю ширину
  const need = card.kind === 'cover' ? Math.max(W / iw, H / ih) : W / iw;
  return need * Math.max(card.zoom || 1, 1) * state.exportScale;
}

function renderWarnings() {
  const card = allCards()[state.current];
  el.warnings.innerHTML = '';
  if (!card) return;
  const warn = (text, action) => {
    const node = h('span', { class: 'warn', icon: 'warning' });
    node.append(document.createTextNode(text));
    if (action) node.append(btn('btn btn-sm', 'magic-wand', action.label, action.run));
    el.warnings.append(node);
  };
  if (state.overflow[state.current]) {
    warn('Текст не помещается', { label: 'Уместить', run: () => autoFit(state.current) });
  }
  if (card.img instanceof HTMLImageElement && hasPhoto(card)) {
    const dup = findDuplicatePhotoOwner(state.current, card.img.src);
    if (dup !== null) warn('Это фото уже есть: ' + cardLabel(dup).toLowerCase());
  }
  if (photoUpscale(card) > UPSCALE_WARN) warn('Фото мелковато — может выйти мыльным');
  if (!el.warnings.children.length) {
    const ok = h('span', { class: 'ok', icon: 'check' });
    ok.append(document.createTextNode('Всё помещается'));
    el.warnings.append(ok);
  }
}

/*
 * «Уместить»: уменьшает кегль слайда шаг за шагом, пока текст не перестанет
 * вылезать, но не ниже FIT_MIN_RATIO от макета. Примеряется на невидимом
 * холсте тем же renderCard(), так что результат совпадает с экспортом.
 */
function autoFit(index) {
  const card = allCards()[index];
  if (!card) return;
  const [W, H] = FORMATS[state.format];
  const ctx = document.createElement('canvas').getContext('2d');
  const fits = c => !renderCard(ctx, c, [W, H], currentAssets(), currentGradient()).overflow;

  if (card.kind === 'cover') {
    const t0 = state.coverTitleSize, b0 = state.coverBodySize;
    const minT = Math.round(LAYOUTS.cover.titleSize * FIT_MIN_RATIO);
    const minB = Math.round(LAYOUTS.cover.bodySize * FIT_MIN_RATIO);
    for (let k = 1; k <= 60; k++) {
      const t = Math.max(minT, Math.round(t0 * (1 - k * 0.01)));
      const b = Math.max(minB, Math.round(b0 * (1 - k * 0.01)));
      if (fits(Object.assign({}, card, { style: { size: b, headingSize: t } }))) {
        pushUndo();
        state.coverTitleSize = t;
        state.coverBodySize = b;
        syncTemplateDesign();
        afterStyleChange(true);
        say('Кегль обложки: заголовок ' + t + ', подзаголовок ' + b);
        return;
      }
      if (t === minT && b === minB) break;
    }
  } else {
    const key = state.cardIds[index - 1];
    const style = Object.assign(defaultTypography(card), card.style || {});
    const min = Math.round(defaultTypography(card).size * FIT_MIN_RATIO);
    for (let s = style.size - 1; s >= min; s--) {
      if (fits(Object.assign({}, card, { style: Object.assign({}, card.style, { size: s }) }))) {
        pushUndo();
        state.cardStylesById[key] = Object.assign({}, state.cardStylesById[key] || {}, { size: s });
        afterStyleChange(true);
        say('Кегль карточки уменьшен до ' + s);
        return;
      }
    }
  }
  say('Даже при ' + Math.round(FIT_MIN_RATIO * 100) + '% кегля не помещается — сократи текст или перенеси часть на другую карточку');
}

/* Возвращает масштаб/сдвиг/поворот слайда к исходным — фильтры не трогает. */
function resetTransform(index = state.current) {
  const card = allCards()[index];
  if (!card || !card.img) return;
  pushUndo();
  card.zoom = 1; card.panX = 0; card.panY = 0; card.rotate = 0;
  commitTransform(index);
  renderAll();
  syncTransformInputs();
  say('Кадр сброшен');
}

/* ------------------------------------------------ превью видео: play */
/*
 * «Смотреть» проигрывает именно обрезанный фрагмент (trimStart..trimEnd)
 * по кругу прямо на сцене. Пока хоть одно видео играет, сцена
 * перерисовывается в цикле requestAnimationFrame (~25 кадров/с), а не через
 * обычный отложенный scheduleRender; как только всё на паузе, цикл
 * останавливается сам.
 */
let previewPlayRaf = null;
let previewPlayLastTs = 0;
function ensurePreviewPlayLoop() {
  if (previewPlayRaf) return;
  const tick = ts => {
    const cards = allCards();
    const playing = cards.map((c, i) => (c.img instanceof HTMLVideoElement && c.img._previewPlaying && !c.img.paused) ? i : -1)
      .filter(i => i >= 0);
    if (!playing.length) { previewPlayRaf = null; renderAll(); return; }
    if (ts - previewPlayLastTs >= 40) {
      previewPlayLastTs = ts;
      if (playing.includes(state.current)) renderStage();
      for (const i of playing) {
        const canvas = el.slidesList.querySelector(`.slide-item[data-index="${i}"] canvas`);
        if (canvas) paintCard(canvas, cards[i], i, canvas.clientWidth || 160);
      }
    }
    previewPlayRaf = requestAnimationFrame(tick);
  };
  previewPlayRaf = requestAnimationFrame(tick);
}

function toggleVideoPreviewPlayback(index) {
  const card = allCards()[index];
  if (!card || !(card.img instanceof HTMLVideoElement)) return;
  const video = card.img;
  if (video.paused) {
    const start = video.trimStart || 0;
    const end = video.trimEnd ?? video.duration;
    if (video.currentTime < start || video.currentTime >= end) video.currentTime = start;
    video._previewPlaying = true;
    video.play().then(() => {
      overlaySignature = '';
      renderStage();
      ensurePreviewPlayLoop();
    }).catch(() => say('Не получилось запустить видео'));
  } else {
    video._previewPlaying = false;
    video.pause();
    overlaySignature = '';
    renderStage();
  }
}

/* Останавливает все проигрываемые видео — перед экспортом и при уходе из проекта. */
function stopAllVideoPreviews() {
  allCards().forEach(card => {
    if (!(card.img instanceof HTMLVideoElement)) return;
    card.img._previewPlaying = false;
    card.img.pause();
  });
  overlaySignature = '';
}

function openTrimFor(index) {
  const card = allCards()[index];
  if (!card || !(card.img instanceof HTMLVideoElement)) return;
  askVideoTrim([{ card, index }], {
    title: 'Обрезка видео',
    hint: 'Укажи начало и конец нужного фрагмента — остальное обрежется при экспорте.',
    confirmLabel: 'Готово',
  }).then(() => { renderSlideForm(); renderAll(); });
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

/* Полоска прогресса под кнопкой Export — общая доля готовых карточек, плюс
   для видео (единственного, что реально занимает время) — доля записанного
   внутри его собственной доли. */
function showExportProgress() {
  el.exportProgress.hidden = false;
  updateExportProgress(0);
}
function updateExportProgress(frac) {
  el.exportProgressBar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
}
function hideExportProgress() {
  el.exportProgress.hidden = true;
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

/* Ждёт, пока видео долистает до нужного момента (используется и на экспорте, и при копировании). */
function seekTo(video, t) {
  return new Promise(resolve => {
    if (Math.abs(video.currentTime - t) < 0.01) { resolve(); return; }
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = t;
  });
}

/*
 * Сколько видео-карточек пишутся одновременно при экспорте (см. exportSlides).
 * Запись видео идёт в реальном времени (см. exportVideoCard) — параллельная
 * запись нескольких карточек не ускоряет запись КАЖДОЙ из них, зато
 * несколько независимых карточек пишутся одновременно вместо по очереди, и
 * общее время экспорта карусели с видео падает примерно в число раз, равное
 * этому пределу. Не делаем это число неограниченным — десяток одновременных
 * MediaRecorder на слабом устройстве скорее уронит кадры или упадёт по
 * памяти, чем ускорит дело; ограничиваем и числом ядер (грубая оценка
 * мощности устройства), и жёстким потолком.
 */
const VIDEO_EXPORT_CONCURRENCY = Math.max(
  2,
  Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2))
);

/*
 * Кандидаты MediaRecorder в порядке предпочтения: настоящий MP4 первым (его
 * поддерживает Safari — MediaRecorder может писать video/mp4 с 14.1, и, как
 * выяснилось, современный Chrome/Edge тоже), иначе откат на WebM
 * (стороннего кодировщика вроде ffmpeg.wasm сознательно нет — тянуть в
 * проект тяжёлую WASM-библиотеку ради этого значит нарушить принцип «один
 * файл, без зависимостей», см. CLAUDE.md). Отдельный список для варианта
 * со звуком: конкретные явные строки кодека для AAC (`mp4a.40.2`/`aac`)
 * `MediaRecorder.isTypeSupported()` не распознаёт, зато распознаёт голый
 * `video/mp4` — браузер сам выбирает подходящую звуковую дорожку внутри.
 */
const VIDEO_EXPORT_CANDIDATES = [
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mime: 'video/mp4;codecs=h264', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];
const VIDEO_EXPORT_CANDIDATES_WITH_AUDIO = [
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];

// сколько запись должна идти после события start, прежде чем её можно
// остановить без потери кадров (см. exportVideoCard)
const STOP_GRACE_MS = 300;

/*
 * Пишет обрезанный фрагмент видео карточки: тот же renderCard(), что рисует
 * статичные карточки, вызывается на каждом кадре, пока видео играет от
 * video.trimStart до video.trimEnd, — так текст, лого и градиент горят
 * поверх картинки кадр за кадром так же, как на фото-экспорте, просто не
 * за один снимок, а живой записью canvas.captureStream() через
 * MediaRecorder. Звук берём не через Web Audio (сложнее и не нужно), а
 * напрямую с video.captureStream().getAudioTracks() и добавляем её к
 * видео-дорожке с канваса в один MediaStream перед записью. Порядок здесь
 * важен: дорожку берём ДО того, как приглушаем элемент для локального
 * проигрывания — в Chrome/Firefox это не имело бы значения (там muted не
 * трогает сырой поток), а в Safari звук в итоговом файле оказывался пустым
 * именно из-за этого — WebKit, похоже, завязывает содержимое дорожки на
 * состояние .muted в момент захвата, а не только на вывод в колонки.
 * Элемент также на время записи временно вставляется в DOM (невидимо,
 * off-screen) — по тем же причинам: как минимум в части версий Safari
 * captureStream() ненадёжно отдаёт звук для элемента, ни разу не
 * подключённого к документу. Если у браузера нет captureStream() на <video>
 * или у ролика нет своей звуковой дорожки — пишем как раньше, без звука.
 * onProgress(0..1), если передан, получает долю уже записанного фрагмента —
 * для полоски прогресса.
 */
async function exportVideoCard(card, index, onProgress) {
  if (!HTMLCanvasElement.prototype.captureStream || !window.MediaRecorder) {
    throw new Error('браузер не умеет записывать видео с canvas');
  }

  const video = card.img;
  video._previewPlaying = false;   // на случай, если играл предпросмотр именно этой карточки
  const [W, H] = FORMATS[state.format];
  const scale = state.exportScale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const assets = currentAssets();
  const gradient = currentGradient();

  const duration = video.durationUnknown ? 60 : (video.duration || 0);
  const start = Math.max(0, Math.min(video.trimStart || 0, duration));
  const end = Math.max(start + 0.1, Math.min(video.trimEnd ?? duration, duration));

  // видео на этот момент точно отсоединено от DOM (оно там бывает только
  // временно, внутри окна обрезки) — подключаем незаметно на время записи,
  // см. комментарий к функции
  const attachedHere = !video.isConnected;
  if (attachedHere) {
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.width = '2px';
    video.style.height = '2px';
    document.body.appendChild(video);
  }

  try {
    let audioTracks = [];
    const captureAudio = video.captureStream || video.mozCaptureStream;
    if (captureAudio) {
      try { audioTracks = captureAudio.call(video).getAudioTracks(); }
      catch { /* какой-то браузер отказал — просто пишем без звука */ }
    }
    const hasAudio = audioTracks.length > 0;

    const wasMuted = video.muted;
    video.muted = true;   // дорожку уже взяли — теперь можно смело приглушить локальный вывод
    await seekTo(video, start);

    const canvasStream = canvas.captureStream(30);
    const combinedStream = hasAudio
      ? new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
      : canvasStream;

    const candidates = hasAudio ? VIDEO_EXPORT_CANDIDATES_WITH_AUDIO : VIDEO_EXPORT_CANDIDATES;
    const picked = candidates.find(c => MediaRecorder.isTypeSupported(c.mime));
    if (!picked) throw new Error('браузер не поддерживает запись видео');

    const recorder = new MediaRecorder(combinedStream, { mimeType: picked.mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

    /*
     * Кодировщик (особенно MP4) поднимается не мгновенно: событие start
     * приходит через 0,3–1 с после первого кадра на холсте. Проверено в
     * Chromium: кадры, нарисованные за это время, не теряются, отсчёт ролика
     * идёт от первого кадра — поэтому видео запускается сразу, без ожидания.
     * Но если вызвать recorder.stop() раньше, чем пришёл start, файл
     * получается пустым (0 байт), а если сразу после start — из него
     * пропадают кадры, ещё не дошедшие до кодировщика (остаётся один). Так и
     * терялись короткие ролики. Поэтому, если ролик доиграл раньше,
     * остановка откладывается до STOP_GRACE_MS после onstart, а до тех пор
     * на холст продолжает подаваться последний кадр. Рисовать первый кадр
     * заранее, до start(), нельзя: отсчёт пошёл бы от него, и всё ожидание
     * кодировщика попало бы в начало файла застывшей картинкой.
     */
    const blob = await new Promise((resolve, reject) => {
      let raf = null;
      let startedAt = null;   // когда пришло событие start — кодировщик реально пишет
      let ended = false;      // ролик доиграл до конца обрезки, новых кадров видео не будет
      let stopped = false;
      const hardStopAt = performance.now() + 5 * 60 * 1000;   // защита от зависания на странных файлах
      const stop = () => {
        if (!ended) {
          ended = true;
          video.removeEventListener('timeupdate', onTick);
          video.pause();
        }
        const ready = startedAt !== null && performance.now() - startedAt >= STOP_GRACE_MS;
        if (!ready && performance.now() < hardStopAt) return;   // цикл draw позовёт ещё раз
        stopped = true;
        cancelAnimationFrame(raf);
        if (recorder.state !== 'inactive') recorder.stop();
      };
      const onTick = () => {
        if (onProgress) onProgress(Math.max(0, Math.min(1, (video.currentTime - start) / (end - start))));
        if (video.currentTime >= end) stop();
      };
      const draw = () => {
        try { renderCard(ctx, card, [W, H], assets, gradient); } catch { /* попробуем на следующем кадре */ }
        if (ended || video.currentTime >= end || video.ended || performance.now() > hardStopAt) stop();
        if (!stopped) raf = requestAnimationFrame(draw);
      };
      recorder.onstart = () => { startedAt = performance.now(); };
      recorder.onstop = () => {
        video.muted = wasMuted;
        if (onProgress) onProgress(1);
        resolve(new Blob(chunks, { type: picked.mime.split(';')[0] }));
      };
      recorder.onerror = e => { video.muted = wasMuted; reject(e.error || new Error('ошибка записи видео')); };
      video.addEventListener('timeupdate', onTick);
      recorder.start(1000);
      video.play().then(() => { raf = requestAnimationFrame(draw); }).catch(reject);
    });
    return { blob, ext: picked.ext };
  } finally {
    if (attachedHere) video.remove();
  }
}

function formatSeconds(s) {
  s = Math.max(0, Math.round(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/*
 * Окно обрезки видео — общее и для «спросить сразу при загрузке» (см.
 * setPhoto), и для кнопки «Обрезать» (переоткрыть в любой момент), и для
 * пачки видео разом (сейчас нигде не используется как обязательный шаг перед
 * экспортом — экспорт просто берёт то, что уже лежит в video.trimStart/
 * trimEnd). Значения меняются «вживую»: перетаскивание ползунков и правка
 * полей сразу пишут в video.trimStart/trimEnd (а не в черновик), поэтому
 * кнопка «Просмотр» в самом окне сразу проигрывает то, что реально выберется.
 * Оригинальные значения запоминаются на случай «Отмена» — тогда откатываем
 * их обратно. Возвращает true при «Готово/Экспортировать», false при отмене.
 */
function askVideoTrim(videoCards, opts = {}) {
  const {
    title = 'Обрезка видео',
    hint = 'Для каждого видео на карточке укажи начало и конец нужного фрагмента.',
    confirmLabel = 'Готово',
  } = opts;
  return new Promise(resolve => {
    const modal = document.getElementById('videoTrimModal');
    const body = document.getElementById('videoTrimBody');
    const cancelBtn = document.getElementById('videoTrimCancel');
    const confirmBtn = document.getElementById('videoTrimConfirm');
    document.getElementById('videoTrimTitle').textContent = title;
    document.getElementById('videoTrimHint').textContent = hint;
    confirmBtn.textContent = confirmLabel;
    body.innerHTML = '';

    videoCards.forEach(({ card, index }) => {
      const video = card.img;
      const duration = video.durationUnknown ? 60 : (video.duration || 0);
      const originalStart = video.trimStart || 0;
      const originalEnd = video.trimEnd ?? duration;

      const row = document.createElement('div');
      row.className = 'video-trim-row';

      const label = document.createElement('p');
      label.className = 'section-label';
      label.textContent = cardLabel(index) +
        (video.durationUnknown ? ' — длительность не определилась, показана минута' : ' — ' + formatSeconds(duration));
      row.appendChild(label);

      const videoWrap = document.createElement('div');
      videoWrap.className = 'vt-video-wrap';
      video.controls = false;
      videoWrap.appendChild(video);   // тот же элемент, что рисуется на канвасе — просто временно виден
      row.appendChild(videoWrap);

      const scrubber = document.createElement('div');
      scrubber.className = 'vt-scrubber';
      const fill = document.createElement('div'); fill.className = 'vt-fill';
      const startHandle = document.createElement('button');
      startHandle.type = 'button'; startHandle.className = 'vt-handle vt-handle-start';
      startHandle.setAttribute('aria-label', 'Начало фрагмента');
      const endHandle = document.createElement('button');
      endHandle.type = 'button'; endHandle.className = 'vt-handle vt-handle-end';
      endHandle.setAttribute('aria-label', 'Конец фрагмента');
      scrubber.append(fill, startHandle, endHandle);
      row.appendChild(scrubber);

      const fields = document.createElement('div');
      fields.className = 'vt-fields';
      const makeField = (title2, value) => {
        const wrap = document.createElement('label');
        wrap.append(document.createTextNode(title2));
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = String(duration);
        input.step = '0.1';
        input.value = String(Math.round(value * 10) / 10);
        wrap.appendChild(input);
        fields.appendChild(wrap);
        return input;
      };
      const startInput = makeField('Начало, сек', originalStart);
      const endInput = makeField('Конец, сек', originalEnd);

      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'btn btn-outline btn-sm vt-preview-btn';
      previewBtn.textContent = '▶ Просмотр';
      fields.appendChild(previewBtn);
      row.appendChild(fields);
      body.appendChild(row);

      const pct = t => duration > 0 ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0;
      const layout = () => {
        fill.style.left = pct(video.trimStart) + '%';
        fill.style.right = (100 - pct(video.trimEnd)) + '%';
        startHandle.style.left = pct(video.trimStart) + '%';
        endHandle.style.left = pct(video.trimEnd) + '%';
      };
      const setStart = t => {
        t = Math.max(0, Math.min(t, video.trimEnd - 0.1));
        video.trimStart = Math.round(t * 10) / 10;
        startInput.value = String(video.trimStart);
        layout();
      };
      const setEnd = t => {
        t = Math.min(duration, Math.max(t, video.trimStart + 0.1));
        video.trimEnd = Math.round(t * 10) / 10;
        endInput.value = String(video.trimEnd);
        layout();
      };
      layout();

      const wireDrag = (handle, isStart) => {
        handle.addEventListener('pointerdown', e => {
          e.preventDefault();
          handle.setPointerCapture(e.pointerId);
          const onMove = ev => {
            const rect = scrubber.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            const t = frac * duration;
            if (isStart) setStart(t); else setEnd(t);
            video.currentTime = isStart ? video.trimStart : video.trimEnd;
          };
          const onUp = () => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
          };
          handle.addEventListener('pointermove', onMove);
          handle.addEventListener('pointerup', onUp);
        });
      };
      wireDrag(startHandle, true);
      wireDrag(endHandle, false);

      startInput.addEventListener('input', () => {
        setStart(Number(startInput.value) || 0);
        video.currentTime = video.trimStart;
      });
      endInput.addEventListener('input', () => {
        setEnd(Number(endInput.value) || duration);
        video.currentTime = video.trimEnd;
      });

      previewBtn.addEventListener('click', () => {
        if (video.paused) {
          video._previewPlaying = true;
          video.currentTime = video.trimStart;
          video.play().then(() => { previewBtn.textContent = '⏸ Стоп'; })
            .catch(() => say('Не получилось запустить просмотр'));
        } else {
          video._previewPlaying = false;
          video.pause();
          previewBtn.textContent = '▶ Просмотр';
        }
      });

      row._data = { video, originalStart, originalEnd };
    });

    const finish = ok => {
      modal.hidden = true;
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      modal.removeEventListener('click', onBackdrop);
      [...body.children].forEach(row => {
        const { video, originalStart, originalEnd } = row._data;
        video._previewPlaying = false;
        video.pause();
        video.remove();   // возвращаем элемент в закадровое состояние — он и так рисуется в канвас превью
        if (!ok) { video.trimStart = originalStart; video.trimEnd = originalEnd; }
      });
      scheduleRender();
      resolve(ok);
    };
    const onCancel = () => finish(false);
    const onConfirm = () => finish(true);
    const onBackdrop = e => { if (e.target === modal) finish(false); };

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('click', onBackdrop);
    modal.hidden = false;
  });
}


/*
 * Экспорт слайдов: mode 'zip' — одним архивом, 'files' — файлами по одному;
 * onlyIndex — только один слайд (всегда отдельным файлом). Фото-слайды
 * готовятся все сразу (Promise.all — рендер на канвасе быстрый). Видео
 * пишутся в реальном времени (см. exportVideoCard), поэтому единственный
 * способ ускорить их суммарно — писать по VIDEO_EXPORT_CONCURRENCY штук
 * одновременно: общее время стремится к самому длинному ролику в группе,
 * а не к сумме всех. Полоска прогресса — доля готовности по всем слайдам
 * (progress[i] на каждый), видео заполняет свою долю постепенно.
 * Пустые слайды (без текста и фото) пропускаются. Номер в имени файла —
 * позиция слайда в карусели, а не в списке экспорта.
 */
async function exportSlides(mode, onlyIndex = null) {
  const cards = allCards();
  const entries = (onlyIndex === null ? cards.map((card, index) => ({ card, index }))
                                      : [{ card: cards[onlyIndex], index: onlyIndex }])
    .filter(e => e.card && hasContent(e.card));
  if (!entries.length) { say('Пока нечего экспортировать'); return; }
  if (onlyIndex === null) { state.exportMode = mode; saveProject(); }

  stopAllVideoPreviews();   // иначе петля предпросмотра мешала бы записи
  renderStage();

  const mime = state.exportFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  const photoExt = state.exportFormat === 'jpeg' ? 'jpg' : 'png';
  const slots = new Array(entries.length).fill(null);
  const progress = new Array(entries.length).fill(0);
  let failed = 0;
  showExportProgress();

  const updateTotal = () => {
    updateExportProgress(progress.reduce((a, b) => a + b, 0) / entries.length);
  };
  const nameFor = (index, ext) =>
    (index === 0 ? '00-oblozhka' : String(index).padStart(2, '0') + '-kartochka') + '.' + ext;

  const photoJobs = entries.map(({ card, index }, i) => {
    if (card.img instanceof HTMLVideoElement && hasPhoto(card)) return null;
    return (async () => {
      try {
        const blob = await canvasToBlob(renderFull(card), mime, 0.95);
        slots[i] = { name: nameFor(index, photoExt), blob };
      } catch (err) {
        console.error('не удалось подготовить слайд для экспорта', index, err);
        failed++;
      }
      progress[i] = 1;
      updateTotal();
    })();
  }).filter(Boolean);

  const videoJobs = entries
    .map((e, i) => ((e.card.img instanceof HTMLVideoElement && hasPhoto(e.card)) ? i : -1))
    .filter(i => i >= 0);
  if (videoJobs.length) {
    say(videoJobs.length === 1
      ? 'Записываю видео…'
      : `Записываю видео (${videoJobs.length} шт., до ${Math.min(VIDEO_EXPORT_CONCURRENCY, videoJobs.length)} одновременно)…`);
  }
  let cursor = 0;
  const videoWorker = async () => {
    while (cursor < videoJobs.length) {
      const i = videoJobs[cursor++];
      const { card, index } = entries[i];
      try {
        const result = await exportVideoCard(card, index, p => { progress[i] = p; updateTotal(); });
        slots[i] = { name: nameFor(index, result.ext), blob: result.blob };
      } catch (err) {
        console.error('не удалось подготовить слайд для экспорта', index, err);
        failed++;
      }
      progress[i] = 1;
      updateTotal();
    }
  };
  const videoWorkers = Array.from({ length: Math.min(VIDEO_EXPORT_CONCURRENCY, videoJobs.length) }, videoWorker);

  await Promise.all([...photoJobs, ...videoWorkers]);
  hideExportProgress();

  const rendered = slots.filter(Boolean);
  if (!rendered.length) { say('Не удалось подготовить файлы'); return; }

  if (mode === 'zip' && rendered.length > 1) {
    const files = await Promise.all(rendered.map(async r =>
      ({ name: r.name, data: new Uint8Array(await r.blob.arrayBuffer()) })));
    const base = fileSlug(state.draftName || autoDraftName(projectData()), 'card-maker');
    downloadBlob(new Blob([buildZip(files)], { type: 'application/zip' }), base + '.zip');
  } else {
    for (const r of rendered) {
      downloadBlob(r.blob, r.name);
      await new Promise(res => setTimeout(res, 350));
    }
  }
  closeExportPop();
  say(failed ? `Скачано: ${rendered.length}, не получилось: ${failed}` : 'Скачано: ' + rendered.length);
}

/* ------------------------------------------------- окошко «Экспорт» */

function openExportPop() {
  syncExportPop();
  el.exportPop.hidden = false;
}

function closeExportPop() {
  el.exportPop.hidden = true;
}

function syncExportPop() {
  document.querySelectorAll('#segExportFormat button').forEach(b =>
    b.classList.toggle('on', b.dataset.value === state.exportFormat));
  document.querySelectorAll('#segExportScale button').forEach(b =>
    b.classList.toggle('on', Number(b.dataset.value) === state.exportScale));
  const [W, H] = FORMATS[state.format];
  const s = state.exportScale;
  const videos = allCards().filter(c => hasPhoto(c) && c.img instanceof HTMLVideoElement).length;
  document.getElementById('exportNote').textContent = `${W * s}×${H * s} px` +
    (videos ? ` · видео (${videos}) — в MP4 или WEBM` : '');
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
  await exportSlides('files');
  window.open('https://web.telegram.org/', '_blank', 'noopener');
  say('Браузер не умеет отправлять файлы напрямую — карточки скачаны, Telegram открыт');
}

/* ------------------------------------------------------ правка текста */
/*
 * Полей с разметкой два: «Весь текст» (всё state.cardsText) и текст текущей
 * карточки на вкладке «Слайд» (#cardEditor — только её блок, без метки).
 * binding описывает, откуда поле берёт разметку и куда её возвращает, —
 * вставка из буфера, ⌘B/⌘I и кегль выделения работают одинаково в обоих.
 * Пока в поле печатают, его содержимое не перерисовывается из state (иначе
 * прыгал бы курсор) — только превью; при переключении слайда или вкладки
 * поле собирается заново из разметки.
 */
function wholeBinding() {
  return { kind: 'whole', el: el.cardsText, get: () => state.cardsText, set: m => { state.cardsText = m; } };
}

function cardBinding() {
  const node = document.getElementById('cardEditor');
  const cardIndex = state.current - 1;
  if (!node || cardIndex < 0) return null;
  return { kind: 'card', el: node, get: () => cardBody(cardIndex), set: m => setCardBody(cardIndex, m) };
}

/* Поле, в котором находится узел (курсор, событие вставки), или null. */
function bindingFor(node) {
  if (!node) return null;
  if (el.cardsText.contains(node)) return wholeBinding();
  const card = document.getElementById('cardEditor');
  if (card && card.contains(node)) return cardBinding();
  return null;
}

// последнее выделение в поле — нужно, когда фокус ушёл на кнопку или список кеглей
let lastCaret = null;   // { kind, start, end }
let lastBindingKind = null;

function rememberCaret() {
  const sel = window.getSelection();
  const node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const binding = bindingFor(node);
  if (!binding) return null;
  const range = getCaretOffset(binding.el);
  if (range) lastCaret = { kind: binding.kind, start: range.start, end: range.end };
  lastBindingKind = binding.kind;
  return binding;
}

function activeBinding() {
  const focused = bindingFor(document.activeElement);
  if (focused) return focused;
  if (lastBindingKind === 'whole' && state.tab === 'text') return wholeBinding();
  if (lastBindingKind === 'card' && state.tab === 'slide') return cardBinding();
  return null;
}

function caretFor(binding) {
  return getCaretOffset(binding.el) ||
    (lastCaret && lastCaret.kind === binding.kind ? { start: lastCaret.start, end: lastCaret.end } : null);
}

/* Текст поменялся в одном из полей: карточки, превью, черновик — но не само поле. */
function afterTextEdit() {
  syncCards();
  renderSlidesList();
  scheduleRender();
  saveProject();
  syncDocName();
}

function onEditorInput(binding) {
  pushUndo();   // снимок берёт СТАРЫЙ текст — до записи ниже
  binding.set(htmlToMarkup(binding.el));
  afterTextEdit();
  if (binding.kind === 'whole') followCaretCard();
}

/* Вставляет разметку в место курсора, не полагаясь на команды браузера. */
function insertMarkup(binding, markup) {
  pushUndo();
  const range = caretFor(binding) || { start: 0, end: 0 };
  const chars = markupToChars(binding.get());
  const added = markupToChars(markup);
  chars.splice(range.start, range.end - range.start, ...added);
  binding.set(charsToMarkup(chars));
  binding.el.innerHTML = markupToHtml(binding.get());
  const caret = range.start + added.length;
  setCaretOffset(binding.el, caret, caret);
  lastCaret = { kind: binding.kind, start: caret, end: caret };
  afterTextEdit();
}

/*
 * Меняет оформление выделенного текста (без выделения — слова под
 * курсором). Работает по посимвольной модели, поэтому результат одинаков
 * во всех браузерах и не зависит от команд редактирования.
 * patch: { bold: 'toggle' } | { italic: 'toggle' } | { size: 48 } | { size: null }
 */
function restyleSelection(binding, patch) {
  if (!binding) { say('Поставь курсор в текст'); return false; }
  const range = caretFor(binding);
  if (!range) { say('Выдели текст, который нужно оформить'); return false; }

  const chars = markupToChars(binding.get());
  let { start, end } = range;
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

  binding.set(charsToMarkup(chars));
  binding.el.innerHTML = markupToHtml(binding.get());
  binding.el.focus();
  setCaretOffset(binding.el, start, end);
  lastCaret = { kind: binding.kind, start, end };
  afterTextEdit();
  return true;
}

function toggleMarkup(mark) {
  restyleSelection(activeBinding(), mark === '**' ? { bold: 'toggle' } : { italic: 'toggle' });
}

/* Панель над полем: Ж, К и кегль выделенного. */
function wireTextToolbar(toolbar, getBinding) {
  // mousedown не отдаёт фокус кнопке — выделение в поле остаётся живым
  toolbar.querySelectorAll('button[data-cmd]').forEach(b =>
    b.addEventListener('mousedown', e => e.preventDefault()));
  toolbar.querySelector('[data-cmd="bold"]').addEventListener('click', () =>
    restyleSelection(getBinding(), { bold: 'toggle' }));
  toolbar.querySelector('[data-cmd="italic"]').addEventListener('click', () =>
    restyleSelection(getBinding(), { italic: 'toggle' }));
  const size = toolbar.querySelector('[data-cmd="size"]');
  fillSizePick(size);
  size.addEventListener('change', () => {
    const value = size.value;
    size.value = '';
    if (!value) return;
    restyleSelection(getBinding(), { size: value === 'reset' ? null : Number(value) });
  });
}

function fillSizePick(select) {
  select.innerHTML = '';
  select.append(h('option', { value: '', text: 'Кегль выделения' }),
    h('option', { value: 'reset', text: 'Как у карточки' }),
    ...SELECTION_SIZES.map(s => h('option', { value: String(s), text: String(s) })));
}

/*
 * Пока пишешь в «Весь текст», выбранным становится слайд, в котором стоит
 * курсор, — его превью сразу на сцене. Номер карточки считается по тем же
 * блокам, что и splitBlocks(): строка-метка начинает новую карточку, текст
 * до первой метки — отдельная карточка без метки.
 */
function followCaretCard() {
  const range = getCaretOffset(el.cardsText);
  if (!range) return;
  const text = editorText(el.cardsText);
  let offset = 0;
  let index = -1;
  for (const line of text.split('\n')) {
    const isMarker = MARKER_RE.test(line.trim());
    if (isMarker || (index === -1 && line.trim())) index++;
    if (range.start <= offset + line.length) break;
    offset += line.length + 1;
  }
  const slide = Math.max(0, index) + 1;
  if (index >= 0 && slide !== state.current && slide <= state.cards.length) selectSlide(slide);
}

/* ----------------------------------------------- разбивка на карточки */

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
  commitCardsText();
  say('Разбито на карточек: ' + paragraphs.length);
}

/* ==================================================== стартовый экран */

function templateGradient(name) {
  return Object.assign({}, GRADIENT_DEFAULTS, (state.templates[name] || {}).gradient || {});
}

/* Обложка из сохранённых данных проекта — для миниатюры черновика. */
function coverFromData(d) {
  const styles = d.coverStyles || {};
  return {
    kind: 'cover', title: d.coverTitle || '', body: d.coverBody || '', img: null, usePhoto: true,
    zoom: 1, panX: 0, panY: 0, rotate: 0, grayscale: false, brightness: 100, contrast: 100,
    style: { size: d.coverBodySize || 45, headingSize: d.coverTitleSize || 60 },
    titleStyle: Object.assign({}, styles.title), bodyStyle: Object.assign({}, styles.body),
  };
}

/* Что показать на миниатюре черновика: обложку, а если она пустая — первую карточку. */
function previewCardFromData(d) {
  if ((d.coverTitle || '').trim() || (d.coverBody || '').trim()) return coverFromData(d);
  const first = parseCards(d.cardsText || '')[0];
  if (!first) return coverFromData(d);
  return { kind: 'card', lines: first.lines, usePhoto: first.usePhoto, img: null,
           zoom: 1, panX: 0, panY: 0, rotate: 0, grayscale: false, brightness: 100, contrast: 100, style: {} };
}

/* Рисует слайд, вписанный в рамку boxW×boxH (CSS-пиксели). */
function paintPreview(canvas, card, format, boxW, boxH, templateName) {
  const [W, H] = FORMATS[format] || FORMATS[DEFAULT_FORMAT];
  const fit = Math.min(boxW / W, boxH / H);
  const cssW = Math.round(W * fit), cssH = Math.round(H * fit);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  if (!state.fontsReady) return;
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / W;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const assets = state.assets[templateName] || currentAssets();
  try { renderCard(ctx, card, [W, H], assets, templateGradient(templateName)); } catch { /* превью не критично */ }
}

function renderHome() {
  const drafts = readDrafts();
  el.draftsSection.hidden = !drafts.length;
  el.draftsRow.innerHTML = '';
  for (const d of drafts) {
    const canvas = h('canvas');
    const count = parseCards(d.data.cardsText || '').length + 1;
    const format = FORMATS[d.data.format] ? d.data.format : DEFAULT_FORMAT;
    const del = iconBtn('trash', 'Удалить черновик', e => {
      e.stopPropagation();
      if (confirm('Удалить черновик «' + draftDisplayName(d) + '»? Вернуть его будет нельзя.')) deleteDraft(d.id);
    }, 'sm danger del');
    const card = h('div', { class: 'draft', tabindex: '0', role: 'button', 'aria-label': 'Открыть ' + draftDisplayName(d),
        onclick: () => openDraft(d.id),
        onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDraft(d.id); } } },
      h('div', { class: 'thumb' }, canvas),
      h('div', { class: 'name', text: draftDisplayName(d) }),
      h('div', { class: 'meta', text: `${count} ${pluralRu(count, 'слайд', 'слайда', 'слайдов')} · ${(FORMAT_INFO[format] || {}).short || format} · ${formatAgo(d.updatedAt)}` }),
      del);
    el.draftsRow.append(card);
    paintPreview(canvas, previewCardFromData(d.data), format, 176, 150, d.data.templateName || state.templateName);
  }

  el.formatGrid.innerHTML = '';
  for (const [format, info] of Object.entries(FORMAT_INFO)) {
    const canvas = h('canvas');
    const stack = h('div', { class: 'stack' }, h('div', { class: 'behind b2' }), h('div', { class: 'behind b1' }), canvas);
    const tile = h('div', { class: 'format-tile' },
      h('div', { class: 'well' }, stack),
      h('div', { class: 't-name' }, info.name, h('span', { class: 'chip', text: format })),
      h('p', { class: 't-desc', text: info.desc }),
      h('div', { class: 't-actions' },
        btn('btn btn-primary', null, 'Начать с примером', () => createDraft(format, true)),
        btn('btn btn-outline', null, 'Пустой', () => createDraft(format, false))));
    el.formatGrid.append(tile);
    const sample = coverFromData({ coverTitle: SAMPLE_COVER.title, coverBody: SAMPLE_COVER.body,
      coverTitleSize: (state.templates[state.templateName] || {}).coverTitleSize,
      coverBodySize: (state.templates[state.templateName] || {}).coverBodySize });
    paintPreview(canvas, sample, format, 190, 236, state.templateName);
  }
}

function showHome() {
  state.screen = 'home';
  el.editor.hidden = true;
  el.home.hidden = false;
  closeExportPop();
  renderHome();
  window.scrollTo(0, 0);
}

/* «← Проекты»: фото и видео остаются в памяти вкладки (см. stashSessionMedia). */
function goHome() {
  stopAllVideoPreviews();
  saveProject();
  stashSessionMedia();
  state.draftId = null;
  showHome();
}

/* ============================================================ редактор */

function showEditor() {
  state.screen = 'editor';
  el.home.hidden = true;
  el.editor.hidden = false;
  el.editor.classList.remove('focus');
  document.getElementById('btnFocus').classList.remove('active');
  syncCards();
  state.current = clamp(state.current, 0, state.cards.length);
  lastCaret = null;
  lastBindingKind = null;
  setTab('slide');
  refreshEditor();
  window.scrollTo(0, 0);
}

/* Перерисовать весь редактор после смены структуры, отмены, открытия черновика. */
function refreshEditor() {
  if (state.screen !== 'editor') return;
  state.current = clamp(state.current, 0, state.cards.length);
  renderSlidesList(true);
  if (state.tab === 'slide') renderSlideForm();
  else if (state.tab === 'text') {
    if (document.activeElement !== el.cardsText) el.cardsText.innerHTML = state.cardsText ? markupToHtml(state.cardsText) : '';
  } else renderProjectForm();
  syncDocName();
  syncDocHeader();
  syncUndoButtons();
  overlaySignature = '';
  renderAll();
}

function syncDocName() {
  if (state.screen !== 'editor') return;
  if (document.activeElement !== el.docName) el.docName.value = state.draftName;
  el.docName.placeholder = autoDraftName(projectData());
}

function syncDocHeader() {
  const info = FORMAT_INFO[state.format];
  el.docFormat.textContent = (info ? info.name + ' · ' : '') + state.format;
}

function setTab(name) {
  state.tab = name;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  el.tabSlide.hidden = name !== 'slide';
  el.tabText.hidden = name !== 'text';
  el.tabProject.hidden = name !== 'project';
  if (name === 'slide') renderSlideForm();
  if (name === 'text') el.cardsText.innerHTML = state.cardsText ? markupToHtml(state.cardsText) : '';
  if (name === 'project') renderProjectForm();
}

/* ----------------------------------------------------- список слайдов */

function slideLabel(card, i) {
  if (i === 0) return 'Обложка';
  const first = (card.lines || []).find(l => l.trim());
  return first ? plainText(first) : 'Пустая карточка';
}

let slidesSignature = '';
function renderSlidesList(force = false) {
  const list = allCards();
  const sig = state.format + '|' + state.cardIds.join(',');
  if (force || sig !== slidesSignature) {
    slidesSignature = sig;
    el.slidesList.innerHTML = '';
    list.forEach((card, i) => el.slidesList.append(buildSlideItem(i, list.length)));
    if (state.fontsReady && state.screen === 'editor') renderThumbs();
  }
  updateSlidesMeta();
}

function buildSlideItem(i, total) {
  const cardIndex = i - 1;
  const stop = fn => e => { e.stopPropagation(); fn(); };
  const thumb = h('div', { class: 'thumb' }, h('canvas'),
    h('span', { class: 'video-badge', icon: 'film-strip', hidden: true, title: 'Видео' }));
  if (i > 0) {
    thumb.append(h('div', { class: 'tools' },
      iconBtn('arrow-up', 'Выше', stop(() => moveCard(cardIndex, cardIndex - 1)), i === 1 ? 'sm hidden-tool' : 'sm'),
      iconBtn('arrow-down', 'Ниже', stop(() => moveCard(cardIndex, cardIndex + 1)), i === total - 1 ? 'sm hidden-tool' : 'sm'),
      iconBtn('copy', 'Дублировать', stop(() => duplicateCard(cardIndex)), 'sm'),
      iconBtn('trash', 'Удалить', stop(() => deleteCard(cardIndex)), 'sm danger')));
    thumb.querySelectorAll('.hidden-tool').forEach(b => { b.disabled = true; });
  }
  const item = h('div', { class: 'slide-item', 'data-index': String(i), tabindex: '0', role: 'button',
      onclick: () => selectSlide(i),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSlide(i); } } },
    thumb,
    h('div', { class: 'cap' },
      h('span', { class: 'num', text: String(i + 1) }),
      h('span', { class: 'label' }),
      h('span', { class: 'warn-dot', hidden: true, title: 'Текст не помещается' })));

  // перетаскивание: карточку — на место другой карточки; файл — на любой слайд
  if (i > 0) {
    item.draggable = true;
    item.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-card-index', String(cardIndex));
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
  }
  item.addEventListener('dragover', e => {
    const types = [...e.dataTransfer.types];
    if (types.includes('Files') || (i > 0 && types.includes('text/x-card-index'))) {
      e.preventDefault();
      item.classList.add('drag-over');
    }
  });
  item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
  item.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    item.classList.remove('drag-over');
    const from = e.dataTransfer.getData('text/x-card-index');
    if (from !== '' && i > 0) { moveCard(Number(from), cardIndex); return; }
    await dropMedia([...(e.dataTransfer.files || [])], i);
  });
  return item;
}

function updateSlidesMeta() {
  const list = allCards();
  el.slidesList.querySelectorAll('.slide-item').forEach(item => {
    const i = Number(item.dataset.index);
    const card = list[i];
    if (!card) return;
    item.classList.toggle('on', i === state.current);
    item.querySelector('.warn-dot').hidden = !state.overflow[i];
    item.querySelector('.video-badge').hidden = !(hasPhoto(card) && card.img instanceof HTMLVideoElement);
    const label = item.querySelector('.label');
    label.textContent = slideLabel(card, i);
    label.classList.toggle('muted', i > 0 && !(card.lines || []).some(l => l.trim()));
  });
}

function selectSlide(index, { force = false } = {}) {
  const next = clamp(index, 0, allCards().length - 1);
  const changed = next !== state.current;
  state.current = next;
  updateSlidesMeta();
  const item = el.slidesList.querySelector(`.slide-item[data-index="${next}"]`);
  if (item && changed && item.scrollIntoView) item.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  if (state.tab === 'slide' && (changed || force)) renderSlideForm();
  overlaySignature = '';
  renderStage();
  renderWarnings();
}

/* ------------------------------------------------------ медиа: файлы */

let pendingMediaIndex = null;
function pickMediaFor(index) {
  pendingMediaIndex = index;
  el.filePicker.value = '';
  el.filePicker.click();
}

/* Файлы, брошенные на слайд: один — на этот слайд, несколько — по порядку дальше. */
async function dropMedia(files, index) {
  const media = files.filter(isMediaFile);
  if (!media.length) return;
  if (media.length === 1) {
    const card = allCards()[index];
    if (!canHavePhoto(card)) { say('На этой карточке фото выключено — включи «Фото на карточке»'); return; }
    await setPhoto(index, media[0]);
  } else {
    const n = await distributePhotos(media, Math.max(1, index));
    say('Разложено по карточкам: ' + n);
  }
}

/* --------------------------------------------- сцена: жесты и перетаскивание */

function wireStage() {
  const canvas = el.stageCanvas;
  let pinch = null;

  canvas.addEventListener('pointerdown', e => {
    if (pinch) return;
    const index = state.current;
    const card = allCards()[index];
    if (!hasPhoto(card)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
    pushUndo();
    const sx = e.clientX, sy = e.clientY;
    const ox = card.panX, oy = card.panY;
    const ratio = FORMATS[state.format][0] / canvas.clientWidth;
    const move = ev => {
      if (pinch) return;
      card.panX = ox - (ev.clientX - sx) * ratio;
      card.panY = oy - (ev.clientY - sy) * ratio;
      commitTransform(index);
      renderStage();
    };
    const up = ev => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      try { canvas.releasePointerCapture(ev.pointerId); } catch { /* не критично */ }
      scheduleRender();
      syncTransformInputs();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  });

  // щипок двумя пальцами — масштаб
  canvas.addEventListener('touchstart', e => {
    const card = allCards()[state.current];
    if (e.touches.length !== 2 || !hasPhoto(card)) return;
    const [a, b] = e.touches;
    pushUndo();
    pinch = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom: card.zoom };
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const card = allCards()[state.current];
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    card.zoom = clamp(pinch.zoom * (dist / pinch.dist), ZOOM_MIN, ZOOM_MAX);
    commitTransform(state.current);
    renderStage();
  }, { passive: false });
  canvas.addEventListener('touchend', e => {
    if (pinch && e.touches.length < 2) { pinch = null; scheduleRender(); syncTransformInputs(); }
  }, { passive: true });

  canvas.addEventListener('wheel', e => {
    const card = allCards()[state.current];
    if (!hasPhoto(card)) return;
    e.preventDefault();
    pushUndo();
    card.zoom = clamp(card.zoom + (e.deltaY > 0 ? -0.05 : 0.05), ZOOM_MIN, ZOOM_MAX);
    commitTransform(state.current);
    renderStage();
    scheduleRender();
    syncTransformInputs();
  }, { passive: false });

  el.stage.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    el.stageInner.classList.add('drop');
  });
  el.stage.addEventListener('dragleave', () => el.stageInner.classList.remove('drop'));
  el.stage.addEventListener('drop', async e => {
    e.preventDefault();
    el.stageInner.classList.remove('drop');
    await dropMedia([...(e.dataTransfer.files || [])], state.current);
  });

  if (typeof ResizeObserver !== 'undefined') {
    let timer = null;
    new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { renderStage(); renderThumbs(); }, 60);
    }).observe(el.stage);
  } else {
    window.addEventListener('resize', () => renderAll());
  }
}

/* ======================================================= форма слайда */

function field(label, control, hint) {
  return h('div', { class: 'field' },
    typeof label === 'string' ? h('label', { text: label }) : label,
    control,
    hint ? h('p', { class: 'hint', text: hint }) : null);
}

function section(title, action, ...children) {
  return h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h3', { text: title }), action || null), ...children);
}

function rangeRow(label, { min, max, value, unit = '', onInput, key }) {
  const output = h('output', { text: value + unit });
  const input = h('input', { type: 'range', min: String(min), max: String(max), value: String(value), 'aria-label': label });
  if (key) input.dataset.tkey = key;
  input.addEventListener('input', () => {
    output.textContent = input.value + unit;
    onInput(Number(input.value));
  });
  return h('div', { class: 'range-row' }, h('span', { text: label }), input, output);
}

function segControl(options, value, onPick, cls = '') {
  const seg = h('div', { class: 'seg ' + cls });
  for (const o of options) {
    const b = h('button', { type: 'button', class: o.value === value ? 'on' : '', title: o.title,
      'aria-label': o.title || o.label, onclick: () => onPick(o.value) });
    if (o.icon) b.innerHTML = iconSvg(o.icon);
    if (o.label) b.append(document.createTextNode(o.label));
    seg.append(b);
  }
  return seg;
}

function renderSlideForm() {
  const root = el.tabSlide;
  root.innerHTML = '';
  const index = state.current;
  const card = allCards()[index];
  if (!card) return;
  const total = allCards().length;
  const [W, H] = FORMATS[state.format];
  root.append(h('div', { class: 'form-head', id: 'slideForm' },
    h('p', { class: 'eyebrow', text: `Слайд ${index + 1} из ${total} · ${W}×${H}` }),
    h('h2', { text: cardLabel(index) })));

  if (card.kind === 'cover') buildCoverFields(root);
  else buildCardFields(root, index, card);
  if (canHavePhoto(card)) root.append(buildMediaSection(index, card));
  if (hasPhoto(card)) root.append(buildTransformSection(index, card));
  root.append(buildTypographySection(index, card));
  if (index > 0) root.append(buildCardActions(index, total));
}

function buildCoverFields(root) {
  const onCoverText = () => { scheduleRender(); saveProject(); syncDocName(); };
  const title = h('input', { type: 'text', value: state.cover.title, placeholder: 'Заголовок обложки' });
  title.addEventListener('input', () => { pushUndo(); state.cover.title = title.value; onCoverText(); });
  const body = h('input', { type: 'text', value: state.cover.body, placeholder: 'Подзаголовок' });
  body.addEventListener('input', () => { pushUndo(); state.cover.body = body.value; onCoverText(); });
  root.append(field('Заголовок', title, 'Набирается прописными буквами'), field('Подзаголовок', body));
}

function buildCardFields(root, index, card) {
  const cardIndex = index - 1;
  const toolbar = h('div', { class: 'text-toolbar' },
    h('button', { type: 'button', class: 'icon-btn sm', 'data-cmd': 'bold', title: 'Жирный (⌘B)', icon: 'text-b' }),
    h('button', { type: 'button', class: 'icon-btn sm', 'data-cmd': 'italic', title: 'Курсив (⌘I)', icon: 'text-italic' }),
    h('select', { class: 'size-pick', 'data-cmd': 'size', 'aria-label': 'Кегль выделенного текста' }));
  const editor = h('div', { id: 'cardEditor', class: 'rich-editor', contenteditable: 'true', spellcheck: 'true',
    role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Текст карточки',
    'data-placeholder': 'Текст карточки. Выдели слово и нажми ⌘B — жирный, ⌘I — курсив.' });
  const body = cardBody(cardIndex);
  editor.innerHTML = body ? markupToHtml(body) : '';
  editor.addEventListener('input', () => { const b = cardBinding(); if (b) onEditorInput(b); });
  ['keyup', 'mouseup', 'focus'].forEach(ev => editor.addEventListener(ev, rememberCaret));
  wireTextToolbar(toolbar, cardBinding);

  const label = h('label', { text: 'Текст' });
  root.append(h('div', { class: 'field' }, label, toolbar, editor,
    h('p', { class: 'hint', text: 'Строка целиком жирная — подзаголовок · пустая строка — отступ' })));

  const toggle = h('input', { type: 'checkbox', checked: card.usePhoto,
    onchange: e => setCardUsePhoto(cardIndex, e.target.checked) });
  root.append(field(h('label', { class: 'toggle' }, toggle, 'Фото на карточке'), null,
    card.usePhoto ? 'С фото — фото полосой сверху, без фото — белая карточка с текстом по центру'
                  : 'Карточка всегда белая, текст по центру'));
}

function describeMedia(media) {
  if (!media) return 'Файл не выбран';
  if (media instanceof HTMLVideoElement) {
    const duration = media.durationUnknown ? null : media.duration;
    const part = (media.trimEnd ?? duration ?? 0) - (media.trimStart || 0);
    return 'Видео · фрагмент ' + formatSeconds(part) + (duration ? ' из ' + formatSeconds(duration) : '');
  }
  return 'Фото ' + (media.naturalWidth || media.width) + '×' + (media.naturalHeight || media.height);
}

function drawMediaThumb(canvas, media) {
  const size = 68;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d');
  try {
    const c = coverCrop(media, canvas.width, canvas.height, 1, 0, 0);
    ctx.drawImage(media, c.dx, c.dy, c.drawW, c.drawH);
  } catch { /* кадр видео может быть ещё не готов */ }
}

function buildMediaSection(index, card) {
  const media = card.img;
  const isVideo = media instanceof HTMLVideoElement;
  const thumb = h('div', { class: 'mthumb' });
  if (media) {
    const c = h('canvas');
    drawMediaThumb(c, media);
    thumb.append(c);
    if (isVideo) thumb.append(h('span', { class: 'video-badge', icon: 'film-strip' }));
  }
  const actions = h('div', { class: 'mactions' });
  if (!media) {
    actions.append(btn('btn btn-primary btn-sm', 'upload-simple', 'Загрузить', () => pickMediaFor(index)));
  } else {
    actions.append(btn('btn btn-outline btn-sm', 'upload-simple', 'Заменить', () => pickMediaFor(index)));
    if (isVideo) actions.append(btn('btn btn-outline btn-sm', 'scissors', 'Обрезать', () => openTrimFor(index)));
    actions.append(btn('btn btn-danger btn-sm', 'trash', 'Убрать', () => removePhoto(index)));
  }
  const box = h('div', { class: 'media-box' }, thumb,
    h('div', { class: 'mbody' }, h('span', { class: 'mname', text: describeMedia(media) }), actions));
  box.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    box.classList.add('drop');
  });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    box.classList.remove('drop');
    await dropMedia([...(e.dataTransfer.files || [])], index);
  });
  return section('Фото или видео', null, box,
    h('p', { class: 'hint', text: 'Файл можно перетащить прямо на превью или вставить через ⌘V' }));
}

/* Ползунки кадра: как значение в ползунке ↔ поле слайда. */
const TRANSFORM_UI = [
  { key: 'zoom', label: 'Масштаб', min: 0, max: 150, unit: '%',
    get: c => Math.round(((c.zoom || 1) - 1) * 100), set: (c, v) => { c.zoom = 1 + v / 100; } },
  { key: 'panX', label: 'Влево-вправо', min: -800, max: 800, unit: '',
    get: c => Math.round(c.panX || 0), set: (c, v) => { c.panX = v; } },
  { key: 'panY', label: 'Вверх-вниз', min: -800, max: 800, unit: '',
    get: c => Math.round(c.panY || 0), set: (c, v) => { c.panY = v; } },
  { key: 'rotate', label: 'Поворот', min: -180, max: 180, unit: '°',
    get: c => Math.round(c.rotate || 0), set: (c, v) => { c.rotate = v; } },
  { key: 'brightness', label: 'Яркость', min: 50, max: 150, unit: '%',
    get: c => Math.round(c.brightness || 100), set: (c, v) => { c.brightness = v; } },
  { key: 'contrast', label: 'Контраст', min: 50, max: 150, unit: '%',
    get: c => Math.round(c.contrast || 100), set: (c, v) => { c.contrast = v; } },
];

function buildTransformSection(index, card) {
  const onChange = () => { commitTransform(index); renderStage(); scheduleRender(); };
  const rows = TRANSFORM_UI.map(t => rangeRow(t.label, {
    min: t.min, max: t.max, value: t.get(card), unit: t.unit, key: t.key,
    onInput: v => { pushUndo(); t.set(card, v); onChange(); },
  }));
  const gray = h('input', { type: 'checkbox', checked: Boolean(card.grayscale),
    onchange: e => { pushUndo(); card.grayscale = e.target.checked; onChange(); } });
  rows.splice(4, 0, h('label', { class: 'toggle' }, gray, 'Чёрно-белое'));
  return section('Кадр', btn('btn btn-ghost btn-sm', null, 'Сбросить', () => resetTransform(index)),
    ...rows,
    h('p', { class: 'hint', text: 'Кадр можно двигать мышью или пальцем прямо на превью, колесо или щипок — масштаб' }));
}

/* После перетаскивания/колеса на сцене — подтянуть значения ползунков кадра. */
function syncTransformInputs() {
  const card = allCards()[state.current];
  if (!card || state.tab !== 'slide') return;
  el.tabSlide.querySelectorAll('input[data-tkey]').forEach(input => {
    const t = TRANSFORM_UI.find(x => x.key === input.dataset.tkey);
    if (!t) return;
    input.value = String(t.get(card));
    const out = input.parentNode.querySelector('output');
    if (out) out.textContent = input.value + t.unit;
  });
}

/* ---------------------------------------------------------- типографика */

function styleTarget(index) {
  return index === 0 ? { kind: 'cover', field: state.coverTarget } : { kind: 'card', index };
}

function targetStyle(target) {
  if (target.kind === 'cover') {
    const base = defaultTypography(state.cover);
    base.weight = target.field === 'title' ? LAYOUTS.cover.titleWeight : LAYOUTS.cover.bodyWeight;
    base.size = target.field === 'title' ? state.coverTitleSize : state.coverBodySize;
    const own = Object.assign({}, state.coverStyles[target.field]);
    delete own.size;
    return Object.assign(base, own);
  }
  const card = state.cards[target.index - 1];
  return Object.assign(defaultTypography(card), card.style || {});
}

function afterStyleChange(rebuildForm) {
  syncCards();
  if (rebuildForm && state.tab === 'slide') renderSlideForm();
  scheduleRender();
  saveProject();
}

/* Записывает изменённую настройку типографики в обложку или карточку. */
function applyStylePatch(target, patch, rebuildForm = false) {
  pushUndo();
  if (target.kind === 'cover') {
    const f = target.field;
    const next = Object.assign({}, state.coverStyles[f], patch);
    if (patch.size) {
      // кегль обложки живёт отдельно (coverTitleSize/coverBodySize) — он же уходит в шаблон бренда
      if (f === 'title') state.coverTitleSize = patch.size; else state.coverBodySize = patch.size;
      delete next.size;
    }
    state.coverStyles[f] = next;
    syncTemplateDesign();
  } else {
    const key = state.cardIds[target.index - 1];
    if (!key) return;
    state.cardStylesById[key] = Object.assign({}, state.cardStylesById[key] || {}, patch);
  }
  afterStyleChange(rebuildForm);
}

function resetTypography(target) {
  pushUndo();
  if (target.kind === 'cover') {
    state.coverStyles[target.field] = {};
    if (target.field === 'title') state.coverTitleSize = LAYOUTS.cover.titleSize;
    else state.coverBodySize = LAYOUTS.cover.bodySize;
    syncTemplateDesign();
  } else {
    delete state.cardStylesById[state.cardIds[target.index - 1]];
  }
  afterStyleChange(true);
  say('Типографика как в макете');
}

function buildTypographySection(index) {
  const target = styleTarget(index);
  const style = targetStyle(target);
  const children = [];
  if (target.kind === 'cover') {
    children.push(segControl([
      { value: 'title', label: 'Заголовок' }, { value: 'body', label: 'Подзаголовок' },
    ], state.coverTarget, v => { state.coverTarget = v; renderSlideForm(); }));
  }
  children.push(
    segControl([{ value: 'Medium', label: 'Обычный' }, { value: 'Bold', label: 'Жирный' }], style.weight,
      v => applyStylePatch(target, { weight: v }, true)),
    rangeRow('Кегль', { min: 16, max: 140, value: style.size,
      onInput: v => applyStylePatch(target, { size: v }) }),
    rangeRow('Интерлиньяж', { min: 80, max: 250, value: style.lineHeight, unit: '%',
      onInput: v => applyStylePatch(target, { lineHeight: v }) }),
    rangeRow('Трекинг', { min: -10, max: 50, value: style.letterSpacing, unit: '%',
      onInput: v => applyStylePatch(target, { letterSpacing: v }) }),
    segControl([
      { value: 'left', icon: 'text-align-left', title: 'По левому краю' },
      { value: 'center', icon: 'text-align-center', title: 'По центру' },
      { value: 'justify', icon: 'text-align-justify', title: 'По ширине' },
      { value: 'right', icon: 'text-align-right', title: 'По правому краю' },
    ], style.align, v => applyStylePatch(target, { align: v }, true), 'align-seg'));
  return section('Типографика', btn('btn btn-ghost btn-sm', null, 'Как в макете', () => resetTypography(target)),
    ...children);
}

function buildCardActions(index, total) {
  const cardIndex = index - 1;
  const up = btn('btn btn-outline btn-sm', 'arrow-up', 'Выше', () => moveCard(cardIndex, cardIndex - 1));
  const down = btn('btn btn-outline btn-sm', 'arrow-down', 'Ниже', () => moveCard(cardIndex, cardIndex + 1));
  up.disabled = index <= 1;
  down.disabled = index >= total - 1;
  return section('Карточка', null, h('div', { class: 'row-actions' }, up, down,
    btn('btn btn-outline btn-sm', 'copy', 'Дублировать', () => duplicateCard(cardIndex)),
    btn('btn btn-danger btn-sm', 'trash', 'Удалить', () => deleteCard(cardIndex))));
}

/* ====================================================== вкладка «Проект» */

function setFormat(format) {
  if (!FORMATS[format] || format === state.format) return;
  state.format = format;
  saveProject();
  syncDocHeader();
  renderSlidesList(true);
  renderProjectForm();
  overlaySignature = '';
  renderAll();
  say('Формат: ' + (FORMAT_INFO[format] ? FORMAT_INFO[format].name + ' · ' : '') + format);
}

async function switchTemplate(name) {
  if (!state.templates[name]) return;
  state.templateName = name;
  applyTemplateDesign(name);
  if (!state.assets[name]) await prepareAssets(name);
  saveProject();
  refreshEditor();
}

async function newTemplate() {
  const name = (prompt('Название шаблона:') || '').trim();
  if (!name) return;
  if (state.templates[name]) { say('Шаблон «' + name + '» уже есть'); return; }
  // новый шаблон стартует с текущего дизайна обложки
  state.templates[name] = { logo: null, logoDark: null, gradient: null,
    coverTitleSize: state.coverTitleSize, coverBodySize: state.coverBodySize,
    coverStyles: JSON.parse(JSON.stringify(state.coverStyles)) };
  saveTemplates();
  await switchTemplate(name);
}

function renameTemplate() {
  const oldName = state.templateName;
  const name = (prompt('Новое название шаблона:', oldName) || '').trim();
  if (!name || name === oldName) return;
  if (state.templates[name]) { say('Шаблон «' + name + '» уже есть'); return; }
  state.templates[name] = state.templates[oldName];
  delete state.templates[oldName];
  if (state.assets[oldName]) { state.assets[name] = state.assets[oldName]; delete state.assets[oldName]; }
  state.templateName = name;
  saveTemplates();
  saveProject();
  renderProjectForm();
}

async function deleteTemplate() {
  const name = state.templateName;
  if (Object.keys(state.templates).length < 2) return;
  if (!confirm('Удалить шаблон «' + name + '»? Проекты с ним переключатся на другой шаблон.')) return;
  delete state.templates[name];
  delete state.assets[name];
  saveTemplates();
  await switchTemplate(Object.keys(state.templates)[0]);
}

let pendingAssetKind = null;
function pickAsset(kind) {
  pendingAssetKind = kind;
  el.assetPicker.value = '';
  el.assetPicker.click();
}

async function resetLogos() {
  const tpl = state.templates[state.templateName] || {};
  state.templates[state.templateName] = Object.assign({}, tpl, { logo: null, logoDark: null });
  saveTemplates();
  await prepareAssets(state.templateName);
  renderProjectForm();
  renderAll();
  say('Вернул встроенные логотипы');
}

function renderProjectForm() {
  const root = el.tabProject;
  root.innerHTML = '';
  const tpl = state.templates[state.templateName] || {};
  const B = (typeof BUNDLED_BRAND !== 'undefined') ? BUNDLED_BRAND : {};
  const [W, H] = FORMATS[state.format];

  root.append(h('div', { class: 'form-head' },
    h('p', { class: 'eyebrow', text: 'Для всего проекта' }), h('h2', { text: 'Проект' })));

  root.append(field('Формат',
    segControl(Object.keys(FORMATS).map(f => ({ value: f, label: FORMAT_INFO[f] ? FORMAT_INFO[f].short : f })),
      state.format, setFormat),
    `${W}×${H} px — макет карточек тот же, меняется только высота`));

  const select = h('select', { 'aria-label': 'Шаблон бренда', onchange: e => switchTemplate(e.target.value) },
    ...Object.keys(state.templates).map(name => h('option', { value: name, text: name })));
  select.value = state.templateName;
  const tplActions = h('div', { class: 'row-actions' },
    btn('btn btn-outline btn-sm', 'plus', 'Новый', newTemplate),
    btn('btn btn-outline btn-sm', null, 'Переименовать', renameTemplate));
  if (Object.keys(state.templates).length > 1) {
    tplActions.append(btn('btn btn-danger btn-sm', 'trash', 'Удалить', deleteTemplate));
  }
  root.append(section('Шаблон бренда', null, h('div', { class: 'field' }, select), tplActions,
    h('p', { class: 'hint', text: 'Логотипы, затемнение и кегль обложки хранятся в шаблоне — они общие для всех проектов с этим шаблоном.' })));

  const logoRow = (kind, name, where, darkBg) => {
    const src = tpl[kind] || B[kind];
    const prev = h('div', { class: 'logo-prev' + (darkBg ? ' dark-bg' : '') }, src ? h('img', { src, alt: '' }) : null);
    return h('div', { class: 'logo-row' }, prev,
      h('div', { class: 'body' },
        h('span', { class: 'name', text: name }),
        h('span', { class: 'hint', text: where + (tpl[kind] ? ' · свой файл' : ' · встроенный') }),
        h('div', { class: 'actions' }, btn('btn btn-outline btn-sm', 'upload-simple', 'Загрузить…', () => pickAsset(kind)))));
  };
  root.append(section('Логотипы', (tpl.logo || tpl.logoDark) ? btn('btn btn-ghost btn-sm', null, 'Вернуть встроенные', resetLogos) : null,
    logoRow('logo', 'Светлый', 'на обложке и фото', true),
    logoRow('logoDark', 'Тёмный', 'на белых карточках', false)));

  const g = currentGradient();
  const gradientRow = (key, label, min) => rangeRow(label, { min, max: 100, value: Math.round(g[key] * 100), unit: '%',
    onInput: v => {
      const t = state.templates[state.templateName];
      t.gradient = Object.assign({}, currentGradient(), { [key]: v / 100 });
      clearTimeout(gradientSaveTimer);
      gradientSaveTimer = setTimeout(saveTemplates, 400);
      scheduleRender();
    } });
  root.append(section('Затемнение обложки', btn('btn btn-ghost btn-sm', null, 'Как было', () => {
    state.templates[state.templateName].gradient = null;
    saveTemplates();
    renderProjectForm();
    renderAll();
  }),
    gradientRow('height', 'Высота', 5), gradientRow('opacity', 'Плотность', 0), gradientRow('softness', 'Плавность', 5),
    h('p', { class: 'hint', text: 'Тёмная полоса под текстом обложки — чтобы белый текст читался на любом фото.' })));

  root.append(section('Файл проекта', null,
    h('div', { class: 'row-actions' },
      btn('btn btn-outline btn-sm', 'file-arrow-down', 'Сохранить в файл', exportProjectFile),
      btn('btn btn-outline btn-sm', 'file-arrow-up', 'Открыть из файла', importProjectFile)),
    h('p', { class: 'hint', text: 'Текст и настройки, без фото и видео — чтобы перенести проект на другой компьютер.' })));

  root.append(section('Очистка', null,
    h('div', { class: 'row-actions' }, btn('btn btn-danger btn-sm', 'trash', 'Очистить все слайды', clearAll))));
}
let gradientSaveTimer = null;

/* ------------------------------------------------------------ инструкция */

const HELP = [
  ['Проекты',
   'На стартовом экране — черновики («Продолжить работу») и новый проект: выбери формат ' +
   '(пост 4:5, квадрат 1:1 или Stories 9:16) и начни с примера или с пустого проекта. ' +
   'Черновики сохраняются в этом браузере сами, после каждой правки. Фото и видео в ' +
   'черновик не сохраняются: пока вкладка открыта, они остаются на месте, после ' +
   'перезагрузки их нужно добавить заново.'],
  ['Как устроен редактор',
   'Слева — все слайды: обложка и карточки. По центру — большое превью выбранного слайда, ' +
   'справа — его настройки. Под превью — проверка: «Текст не помещается», «Фото мелковато», ' +
   '«Это фото уже есть на другой карточке». Кнопка «Уместить» сама уменьшает кегль, пока ' +
   'текст не поместится (не меньше 70% от макета). Точка у миниатюры — на этом слайде ' +
   'текст не помещается.'],
  ['Текст: по карточкам или целиком',
   'Вкладка «Слайд» — поля только выбранного слайда: заголовок и подзаголовок обложки или ' +
   'текст карточки. Вкладка «Весь текст» — все карточки одним полем, как раньше: карточка ' +
   'начинается строкой //1, //2… Удобно, чтобы вставить длинный текст из Google Документов ' +
   'и нажать «Разбить на карточки» — каждый абзац станет карточкой (заголовок без точки ' +
   'в конце приклеивается к следующему абзацу). Оба способа правят один и тот же текст — ' +
   'можно переключаться как удобно. Пока пишешь во «Весь текст», превью показывает ту ' +
   'карточку, где стоит курсор.'],
  ['Форматирование',
   'Выдели текст и нажми ⌘B или ⌘I — или кнопки над полем. Список «Кегль выделения» ' +
   'меняет размер только выделенного куска. Строка целиком жирная становится подзаголовком ' +
   'и набирается крупнее. Пустая строка — отступ. Текст из Google Документов, Telegram ' +
   'и Word вставляется вместе с жирным и курсивом.'],
  ['Карточки',
   '«+ Карточка» под списком слайдов добавляет пустую карточку после выбранной. ' +
   'На миниатюре — кнопки «выше», «ниже», «дублировать», «удалить», а карточки можно ' +
   'перетаскивать. Галочка «Фото на карточке» в форме: с фото — фото полосой сверху, ' +
   'без фото — белая карточка с текстом по центру (в тексте это метка //2-).'],
  ['Фото и видео',
   'Перетащи файл на превью или на миниатюру, нажми «Фото или видео» на пустом месте ' +
   'или «Загрузить» в форме, либо вставь ⌘V. Несколько файлов разом раскладываются по ' +
   'карточкам по порядку. Кадр двигается мышью или пальцем прямо на превью, колесо или ' +
   'щипок — масштаб; точные значения, поворот, ч/б, яркость и контраст — в блоке «Кадр». ' +
   'После загрузки видео открывается окно обрезки; «Смотреть» на превью проигрывает ' +
   'выбранный фрагмент со звуком.'],
  ['Типографика',
   'Блок «Типографика» в форме меняет начертание, кегль, интерлиньяж, трекинг и выключку ' +
   'выбранного слайда. У обложки заголовок и подзаголовок настраиваются отдельно. ' +
   '«Как в макете» возвращает всё по умолчанию. Короткие предлоги — в, на, и, для — ' +
   'никогда не остаются в конце строки.'],
  ['Проект',
   'Вкладка «Проект»: формат, шаблон бренда (логотипы, затемнение и кегль обложки — ' +
   'общие для всех проектов с этим шаблоном), сохранение проекта в файл и открытие из ' +
   'файла — чтобы перенести его на другой компьютер.'],
  ['Экспорт',
   'Кнопка «Экспорт» справа сверху: PNG или JPG, размер 1×/2×/3× от 1080 пикселей, все ' +
   'слайды одним ZIP, по одному или только текущий. Там же — скопировать текущий слайд ' +
   'в буфер и отправить карточки в Telegram. Слайды с видео выгружаются в MP4 (или WEBM, ' +
   'если браузер не умеет MP4) со звуком; несколько видео пишутся одновременно.'],
  ['Горячие клавиши',
   '⌘Z — отменить, ⌘⇧Z (или ⌘Y) — повторить, ⌘S — экспорт всех слайдов, ⌘C — скопировать ' +
   'слайд, PageUp/PageDown — соседний слайд, Esc — закрыть окно или вернуть панели. ' +
   'В полях заголовка и подзаголовка ⌘Z работает как обычно, по буквам.'],
  ['Тема и установка',
   'Кнопка с луной — тёмная тема интерфейса (на сами карточки не влияет). На телефоне ' +
   'приложение можно поставить на экран «Домой» — появится подсказка; после установки ' +
   'оно работает и без интернета.'],
];

function openHelp() {
  const body = document.getElementById('helpBody');
  body.innerHTML = '';
  for (const [title, text] of HELP) body.append(h('h3', { text: title }), h('p', { text }));
  document.getElementById('helpModal').hidden = false;
}

function closeHelp() {
  document.getElementById('helpModal').hidden = true;
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
    coverGrayscale: state.cover.grayscale, coverBrightness: state.cover.brightness,
    coverContrast: state.cover.contrast,
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
  state.cover.grayscale = snap.coverGrayscale ?? false;
  state.cover.brightness = snap.coverBrightness ?? 100;
  state.cover.contrast = snap.coverContrast ?? 100;
  state.coverTitleSize = snap.coverTitleSize; state.coverBodySize = snap.coverBodySize;
  state.cardsText = snap.cardsText;
  state.coverStyles = snap.coverStyles;
  state.cardStylesById = snap.cardStylesById;
  state.transformsById = snap.transformsById;
  state.photosById = snap.photosById;

  syncCards();
  state.current = Math.min(snap.current, state.cards.length);
  syncTemplateDesign();
  refreshEditor();
  saveProject();
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

/* --------------------------------------------------------------- события */

function isTypingTarget(node) {
  return Boolean(node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' ||
    node.tagName === 'SELECT' || node.isContentEditable));
}

function wireEvents() {
  document.querySelectorAll('.theme-btn').forEach(b => b.addEventListener('click', toggleTheme));
  document.getElementById('btnHelpHome').addEventListener('click', openHelp);
  document.getElementById('btnHelp').addEventListener('click', openHelp);
  document.getElementById('helpClose').addEventListener('click', closeHelp);
  document.getElementById('helpModal').addEventListener('click', e => {
    if (e.target.id === 'helpModal') closeHelp();
  });
  document.getElementById('btnImportProject').addEventListener('click', importProjectFile);

  // --- верхняя панель редактора
  document.getElementById('btnHome').addEventListener('click', goHome);
  el.docName.addEventListener('input', () => { state.draftName = el.docName.value.trim(); saveProject(); });
  el.docName.addEventListener('keydown', e => { if (e.key === 'Enter') el.docName.blur(); });
  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);
  document.getElementById('btnFocus').addEventListener('click', () => toggleFocusMode());

  document.getElementById('btnExport').addEventListener('click', e => {
    e.stopPropagation();
    if (el.exportPop.hidden) openExportPop(); else closeExportPop();
  });
  el.exportPop.addEventListener('click', e => e.stopPropagation());
  document.querySelectorAll('#segExportFormat button').forEach(b => b.addEventListener('click', () => {
    state.exportFormat = b.dataset.value; saveProject(); syncExportPop();
  }));
  document.querySelectorAll('#segExportScale button').forEach(b => b.addEventListener('click', () => {
    state.exportScale = Number(b.dataset.value) || 1; saveProject(); syncExportPop(); renderWarnings();
  }));
  document.getElementById('btnExportZip').addEventListener('click', () => exportSlides('zip'));
  document.getElementById('btnExportFiles').addEventListener('click', () => exportSlides('files'));
  document.getElementById('btnExportOne').addEventListener('click', () => exportSlides('files', state.current));
  document.getElementById('btnCopySlide').addEventListener('click', () => { closeExportPop(); copyCurrent(); });
  document.getElementById('btnTelegram').addEventListener('click', () => { closeExportPop(); sendToTelegram(); });
  document.addEventListener('click', () => { if (!el.exportPop.hidden) closeExportPop(); });

  // --- слайды и сцена
  document.getElementById('btnAddCard').addEventListener('click', () => addCard(state.current));
  document.getElementById('btnPrev').addEventListener('click', () => selectSlide(state.current - 1));
  document.getElementById('btnNext').addEventListener('click', () => selectSlide(state.current + 1));

  // --- правая панель
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  el.cardsText.addEventListener('input', () => onEditorInput(wholeBinding()));
  ['keyup', 'mouseup', 'focus'].forEach(ev => el.cardsText.addEventListener(ev, () => {
    rememberCaret();
    followCaretCard();
  }));
  wireTextToolbar(document.querySelector('#tabText .text-toolbar'), wholeBinding);
  document.getElementById('btnAutoSplit').addEventListener('click', autoSplitText);
  document.addEventListener('selectionchange', rememberCaret);

  // --- файлы
  el.filePicker.addEventListener('change', async () => {
    const files = [...el.filePicker.files];
    const index = pendingMediaIndex ?? state.current;
    pendingMediaIndex = null;
    if (!files.length) return;
    if (files.length === 1) { await setPhoto(index, files[0]); return; }
    const n = await distributePhotos(files, Math.max(1, index));
    say('Разложено по карточкам: ' + n);
  });

  el.assetPicker.addEventListener('change', () => {
    const file = el.assetPicker.files[0];
    const kind = pendingAssetKind;
    pendingAssetKind = null;
    if (!file || !kind) return;
    const reader = new FileReader();
    reader.onload = async () => {
      state.templates[state.templateName][kind] = reader.result;
      saveTemplates();
      await prepareAssets(state.templateName);
      renderProjectForm();
      renderAll();
      say('Загружено: ' + (kind === 'logo' ? 'светлый логотип' : 'тёмный логотип'));
    };
    reader.readAsDataURL(file);
  });

  /*
   * Вставка обрабатывается в одном месте: текст — в то поле с разметкой, где
   * курсор (с жирным и курсивом из Google Документов/Telegram/Word), фото
   * или видео из буфера — на выбранный слайд. Обычные поля (заголовок
   * обложки, имя проекта) вставляют текст сами.
   */
  window.addEventListener('paste', async e => {
    if (state.screen !== 'editor') return;
    const data = e.clipboardData;
    if (!data) return;
    const file = [...(data.items || [])]
      .filter(it => it.kind === 'file' && isMediaFile(it))
      .map(it => it.getAsFile())[0];
    if (file) {
      e.preventDefault();
      await dropMedia([file], state.current);
      return;
    }
    const binding = bindingFor(e.target);
    if (!binding) return;
    const html = data.getData('text/html');
    const plain = data.getData('text/plain');
    if (!html && !plain) return;
    e.preventDefault();
    const markup = html ? clipboardHtmlToMarkup(html) : clipboardPlainToMarkup(plain);
    insertMarkup(binding, markup);
    say(html || markup !== plain ? 'Вставлено с форматированием' : 'Текст вставлен');
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeExportPop();
      closeHelp();
      if (el.editor.classList.contains('focus')) toggleFocusMode(false);
      return;
    }
    if (state.screen !== 'editor') return;
    const target = document.activeElement;
    const inPlainField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

    if (!(e.metaKey || e.ctrlKey)) {
      if (!isTypingTarget(target) && (e.key === 'PageDown' || e.key === 'PageUp')) {
        e.preventDefault();
        selectSlide(state.current + (e.key === 'PageDown' ? 1 : -1));
      }
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 's' || key === 'ы') { e.preventDefault(); exportSlides(state.exportMode); return; }
    // если что-то выделено текстом (например, в инструкции) — ⌘C копирует текст, а не слайд
    const sel = window.getSelection();
    const hasTextSelection = Boolean(sel && sel.toString().length);
    if ((key === 'c' || key === 'с') && !isTypingTarget(target) && !hasTextSelection) {
      e.preventDefault(); copyCurrent(); return;
    }
    // в полях заголовка/имени — свой, браузерный undo
    if (inPlainField) return;
    if (key === 'b' || key === 'и') { if (bindingFor(target)) { e.preventDefault(); toggleMarkup('**'); } return; }
    if (key === 'i' || key === 'ш') { if (bindingFor(target)) { e.preventDefault(); toggleMarkup('_'); } return; }
    if (key === 'z' || key === 'я') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((key === 'y' || key === 'н') && !e.shiftKey) { e.preventDefault(); redo(); }
  });

  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  /*
   * Фото и видео нигде не сохраняются (черновик хранит только текст и
   * настройки), поэтому закрытие вкладки теряет их безвозвратно. Текст
   * переживёт закрытие — предупреждаем только когда есть медиа.
   */
  window.addEventListener('beforeunload', e => {
    if (!hasAnyMedia()) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

/* ---------------------------------------------------------------- запуск */

async function start() {
  paintIcons();
  syncThemeButton();
  // пока тема не выбрана вручную, значок следует за системной темой вживую
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemThemeChange = () => { if (!document.documentElement.dataset.theme) syncThemeButton(); };
    if (mq.addEventListener) mq.addEventListener('change', onSystemThemeChange);
    else if (mq.addListener) mq.addListener(onSystemThemeChange);   // старый Safari
  }
  loadTemplates();
  // новый проект берёт шаблон бренда, с которым работали последним
  const drafts = readDrafts();
  if (drafts[0] && state.templates[drafts[0].data.templateName]) state.templateName = drafts[0].data.templateName;
  applyTemplateDesign(state.templateName);

  wireEvents();
  wireStage();
  wireInstallBanner();
  showHome();

  const names = new Set([state.templateName, ...drafts.map(d => d.data.templateName).filter(n => state.templates[n])]);
  await Promise.all([...names].map(prepareAssets));
  try {
    await Promise.all([
      document.fonts.load('700 60px CardFont'),
      document.fonts.load('500 45px CardFont'),
      document.fonts.load('italic 600 36px CardFont'),
    ]);
    await document.fonts.ready;
  } catch { /* если шрифт не подхватился, рисуем системным */ }
  state.fontsReady = true;
  if (state.screen === 'home') renderHome(); else renderAll();

  // офлайн-доступ: не критично, если недоступно (file://, старый браузер)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => { /* не критично */ });
  }
}

start();
