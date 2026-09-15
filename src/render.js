/*
 * Ядро отрисовки карточек на Canvas.
 * Все размеры вёрстки — в LAYOUTS, сняты пиксельным замером с макетов.
 */

const FORMATS = {
  '1080×1350': [1080, 1350],
  '1080×1080': [1080, 1080],
  '1080×1920': [1080, 1920],
};
const DEFAULT_FORMAT = '1080×1350';

const REF_HEIGHT = 1350;      // высота, под которую сняты отступы
const EDGE_GUARD = 24;        // страховка от переполнения текстом
const LOGO_GAP = 20;          // отступ между низом логотипа и первой строкой текста
const WRAP_TOLERANCE = 1.005; // допуск переноса (разница метрик макета и браузера)
const ASCENT_RATIO = 0.94;    // метрика Raleway: верх строки от базовой линии
const HEADING_SCALE = 1.5;    // строка целиком жирная крупнее обычной в полтора раза

const INK = '#202020';
const WHITE = '#ffffff';

const FAMILY = 'CardFont';
const WEIGHTS = { Medium: 500, Bold: 700 };
const ITALIC_WEIGHT = 600;    // начертание SemiBold Italic

const LAYOUTS = {
  // Обложка: фото на всю карточку, белый текст снизу
  cover: {
    marginX: 88, marginBottom: 230,
    logo: { left: 88, top: 185, w: 140, h: 95 }, logoVariant: 'light',
    lineHeight: 1.0, gapTitleBody: 10,
    titleSize: 60, bodySize: 45,
    titleUpper: true, bodyUpper: false,
    titleWeight: 'Bold', bodyWeight: 'Medium',
    titleColor: WHITE, bodyColor: WHITE,
    useGradient: true, anchor: 'bottom',
    photoMode: 'full',
  },
  // Карточка с фото: фото полосой сверху, чёрный текст на белом.
  // Текстовый блок прижат к низу с постоянным отступом и растёт вверх.
  cardPhoto: {
    marginX: 76, marginBottom: 85,
    // полоса фотографии подстраивается под объём текста
    photoHeight: 467, photoMinHeight: 240, photoMaxHeight: 1180,
    gapPhotoText: 85,
    logo: { left: 76, top: 75, w: 140, h: 95 }, logoVariant: 'light',
    lineHeight: 1.22,
    headingSize: 54, bodySize: 36,
    textColor: INK, bg: WHITE,
    useGradient: false, anchor: 'bottom',
    photoMode: 'band',
  },
  // Карточка без фото: белый фон, текстовый блок по центру
  cardPlain: {
    marginX: 76, marginBottom: 85,
    logo: { left: 76, top: 75, w: 140, h: 95 }, logoVariant: 'dark',
    lineHeight: 1.22,
    headingSize: 60, bodySize: 38,
    textColor: INK, bg: WHITE,
    useGradient: false, anchor: 'center',
    photoMode: 'none',
  },
};

function layoutFor(card) {
  if (card.kind === 'cover') return LAYOUTS.cover;
  return (card.usePhoto && card.img) ? LAYOUTS.cardPhoto : LAYOUTS.cardPlain;
}

/* Настройки типографики по умолчанию для карточки. */
function defaultTypography(card) {
  const L = layoutFor(card);
  return {
    weight: 'Medium',
    size: card.kind === 'cover' ? L.bodySize : L.bodySize,
    headingSize: card.kind === 'cover' ? L.titleSize : L.headingSize,
    lineHeight: Math.round(L.lineHeight * 100),
    letterSpacing: 0,
    align: 'left',
  };
}

function scaleV(value, height) {
  return height === REF_HEIGHT ? value : Math.round(value * height / REF_HEIGHT);
}

/* --------------------------------------------------------------- разметка */

/*
 * Разбирает текст карточек.
 *   //1+  начинает карточку с фотографией
 *   //2-  начинает карточку без фотографии
 * Внутри: пустая строка = отступ, **жирный**, _курсив_.
 */
function parseCards(text) {
  const cards = [];
  let current = null;
  for (const rawLine of String(text || '').split('\n')) {
    const marker = rawLine.trim().match(/^\/\/\s*(\d+)?\s*([+-])?\s*$/);
    if (marker) {
      // "//1" — шаблон выбирается сам: без фото плоский, с фото — с фотографией.
      // "//1-" запрещает фото, "//1+" то же, что и без знака.
      // marker хранит саму метку — по ней в app.js собирается стабильный
      // ключ карточки, чтобы фото и настройки не переезжали на другую
      // карточку при вставке/удалении карточек выше по тексту.
      current = { usePhoto: marker[2] !== '-', lines: [], marker: rawLine.trim() };
      cards.push(current);
      continue;
    }
    if (!current) {
      if (!rawLine.trim()) continue;     // текст до первой метки игнорируем
      current = { usePhoto: true, lines: [], marker: '' };
      cards.push(current);
    }
    current.lines.push(rawLine);
  }
  // хвостовые пустые строки не влияют на вёрстку
  for (const card of cards) {
    while (card.lines.length && !card.lines[card.lines.length - 1].trim()) card.lines.pop();
  }
  return cards;
}

/*
 * Посимвольная модель текста.
 *
 * Разметка хранится строкой, но редактировать удобнее посимвольно:
 * у каждого символа своё начертание и, если задан, свой кегль.
 * Это позволяет менять жирность и размер именно у выделенного куска.
 *
 * Токены: **жирный**, _курсив_, ⟨48⟩кегль⟨/⟩
 */
const SIZE_OPEN = '\u27e8';    // ⟨
const SIZE_CLOSE = '\u27e9';   // ⟩

function markupToChars(text) {
  const chars = [];
  let bold = false, italic = false, size = null;
  const src = String(text || '');
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('**', i)) { bold = !bold; i += 2; continue; }
    if (src[i] === '_') { italic = !italic; i += 1; continue; }
    if (src[i] === SIZE_OPEN) {
      const close = src.indexOf(SIZE_CLOSE, i);
      const body = close > i ? src.slice(i + 1, close) : '';
      if (close > i && /^\/?\d*$/.test(body)) {
        size = body.startsWith('/') || body === '' ? null : Number(body);
        i = close + 1;
        continue;
      }
    }
    chars.push({ ch: src[i], bold, italic, size });
    i += 1;
  }
  return chars;
}

function sameStyle(a, b) {
  return a.bold === b.bold && a.italic === b.italic && a.size === b.size;
}

function charsToMarkup(chars) {
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const start = chars[i];
    if (start.ch === '\n') { out += '\n'; i += 1; continue; }

    let j = i;
    let text = '';
    while (j < chars.length && chars[j].ch !== '\n' && sameStyle(chars[j], start)) {
      text += chars[j].ch;
      j += 1;
    }
    let piece = text;
    if (start.italic) piece = '_' + piece + '_';
    if (start.bold) piece = '**' + piece + '**';
    if (start.size) piece = SIZE_OPEN + start.size + SIZE_CLOSE + piece + SIZE_OPEN + '/' + SIZE_CLOSE;
    out += piece;
    i = j;
  }
  return out;
}

/* Текст без разметки — то, что видит пользователь. */
function markupToPlain(text) {
  return markupToChars(text).map(c => c.ch).join('');
}

/* Разбивает строку разметки на куски с одинаковым оформлением. */
function parseRuns(line) {
  const chars = markupToChars(line);
  const runs = [];
  for (const c of chars) {
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, c)) last.text += c.ch;
    else runs.push({ text: c.ch, bold: c.bold, italic: c.italic, size: c.size });
  }
  return runs.filter(r => r.text.length);
}

/* Строка целиком жирная — это подзаголовок, он набирается крупнее. */
function isHeading(line) {
  const chars = markupToChars(line).filter(c => c.ch.trim());
  return chars.length > 0 && chars.every(c => c.bold);
}

/* ------------------------------------------------------------- измерение */

function runSize(run, size) {
  return run && run.size ? run.size : size;
}

function fontSpec(size, { bold, italic }, weightName) {
  if (italic) return `italic ${ITALIC_WEIGHT} ${size}px ${FAMILY}, sans-serif`;
  const weight = bold ? 700 : (WEIGHTS[weightName] || 500);
  return `${weight} ${size}px ${FAMILY}, sans-serif`;
}

function applyLetterSpacing(ctx, size, percent) {
  const px = (percent || 0) / 100 * size;
  if ('letterSpacing' in ctx) ctx.letterSpacing = px.toFixed(2) + 'px';
  return px;
}

function measureRun(ctx, run, size, style, spacingPx) {
  ctx.font = fontSpec(runSize(run, size), run, style.weight);
  const m = ctx.measureText(run.text);
  const supported = 'letterSpacing' in ctx;
  // если браузер не умеет letterSpacing — добавляем вручную
  return m.width + (supported ? 0 : spacingPx * run.text.length);
}

/* --------------------------------------------------------------- перенос */

/*
 * Короткие служебные слова не должны оставаться в конце строки.
 * Такое слово склеивается со следующим в неразрывную группу.
 */
const GLUE_WORDS = new Set([
  'в', 'во', 'на', 'к', 'ко', 'с', 'со', 'у', 'о', 'об', 'обо', 'от', 'ото',
  'до', 'из', 'изо', 'за', 'по', 'под', 'над', 'при', 'про', 'для', 'без',
  'не', 'ни', 'и', 'а', 'но', 'да', 'же', 'ли', 'бы', 'то', 'как', 'что',
  'или', 'их', 'его', 'её', 'ее', 'мы', 'вы', 'он', 'она', 'они', 'я',
  'a', 'an', 'the', 'in', 'on', 'at', 'to', 'of', 'by', 'is', 'or', 'and',
]);

function isGlueWord(text) {
  const clean = text.replace(/[«»"'(]/g, '').toLowerCase();
  return clean.length > 0 && (clean.length <= 2 || GLUE_WORDS.has(clean));
}

/*
 * Раскладывает строку разметки в готовые строки с кусками текста.
 * Перенос только целыми словами, без дефисов.
 */
function layoutParagraph(ctx, runs, size, style, maxWidth) {
  const spacingPx = applyLetterSpacing(ctx, size, style.letterSpacing);
  const limit = maxWidth * WRAP_TOLERANCE;

  // разворачиваем в последовательность слов с сохранением начертания
  const words = [];
  for (const run of runs) {
    const parts = run.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      words.push({ text: part, bold: run.bold, italic: run.italic, size: run.size,
                   space: /^\s+$/.test(part) });
    }
  }
  for (const word of words) word.width = measureRun(ctx, word, size, style, spacingPx);

  // собираем неразрывные группы: «в» + пробел + следующее слово
  const groups = [];
  let i = 0;
  while (i < words.length) {
    if (words[i].space) { groups.push({ space: true, parts: [words[i]], width: words[i].width }); i++; continue; }
    const parts = [words[i]];
    let width = words[i].width;
    let j = i + 1;
    while (
      style.keepShortWords !== false &&
      isGlueWord(parts[parts.length - 1].text) &&
      words[j] && words[j].space && words[j + 1] && !words[j + 1].space
    ) {
      parts.push(words[j], words[j + 1]);
      width += words[j].width + words[j + 1].width;
      j += 2;
    }
    groups.push({ space: false, parts, width });
    i = j;
  }

  const lines = [];
  let line = [], width = 0;

  const flush = () => {
    while (line.length && line[line.length - 1].space) line.pop();
    if (line.length) lines.push(line);
    line = []; width = 0;
  };

  for (const group of groups) {
    if (!group.space && width + group.width > limit && line.length) flush();
    if (group.space && !line.length) continue;   // пробел в начале строки не нужен
    for (const part of group.parts) line.push(Object.assign({}, part));
    width += group.width;
  }
  flush();

  return lines.map(parts => {
    let inkAscent = 0, inkDescent = 0, maxSize = size;
    for (const p of parts) {
      maxSize = Math.max(maxSize, runSize(p, size));
      ctx.font = fontSpec(runSize(p, size), p, style.weight);
      const m = ctx.measureText(p.text);
      if (typeof m.actualBoundingBoxAscent === 'number') {
        inkAscent = Math.max(inkAscent, m.actualBoundingBoxAscent);
        inkDescent = Math.max(inkDescent, m.actualBoundingBoxDescent);
      }
    }
    return {
      parts,
      width: parts.reduce((s, p) => s + p.width, 0),
      inkAscent, inkDescent, maxSize,
    };
  });
}

/* ------------------------------------------------------------- рисование */

function drawLine(ctx, line, size, style, x, baseline, maxWidth, color, isLast) {  applyLetterSpacing(ctx, size, style.letterSpacing);
  ctx.fillStyle = color;

  let cursor = x;
  let extraPerGap = 0;

  if (style.align === 'center') {
    cursor = x + (maxWidth - line.width) / 2;
  } else if (style.align === 'right') {
    cursor = x + (maxWidth - line.width);
  } else if (style.align === 'justify' && !isLast) {
    const gaps = line.parts.filter(p => p.space).length;
    if (gaps > 0) extraPerGap = (maxWidth - line.width) / gaps;
  }

  const manual = !('letterSpacing' in ctx) && Math.abs(style.letterSpacing || 0) > 0.01;
  const spacingPx = (style.letterSpacing || 0) / 100 * size;

  for (const part of line.parts) {
    ctx.font = fontSpec(runSize(part, size), part, style.weight);
    if (manual) {
      // старые браузеры не умеют ctx.letterSpacing — рисуем посимвольно
      let x = cursor;
      for (const ch of part.text) {
        ctx.fillText(ch, x, baseline);
        x += ctx.measureText(ch).width + spacingPx;
      }
    } else {
      ctx.fillText(part.text, cursor, baseline);
    }
    cursor += part.width + (part.space ? extraPerGap : 0);
  }
}

/*
 * Затемнение под текстом на обложке. Рисуется, а не берётся картинкой,
 * поэтому подстраивается под любой формат и настраивается ползунками.
 */
const GRADIENT_DEFAULTS = { height: 0.37, opacity: 0.51, softness: 0.37, color: '0, 0, 0' };

function drawGradient(ctx, W, H, g) {
  const height = Math.min(Math.max(g.height, 0.01), 1);
  const softness = Math.min(Math.max(g.softness, 0.01), 1);
  const color = g.color || GRADIENT_DEFAULTS.color;
  const top = H * (1 - height);
  const grad = ctx.createLinearGradient(0, top, 0, H);
  grad.addColorStop(0, `rgba(${color}, 0)`);
  grad.addColorStop(softness, `rgba(${color}, ${g.opacity})`);
  grad.addColorStop(1, `rgba(${color}, ${g.opacity})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, top, W, H - top);
}

/*
 * Логотип вписывается в рамку по видимой части: прозрачные поля в файле
 * обрезаются, поэтому положение не зависит от того, с каким запасом
 * сохранён файл.
 */
function drawLogo(ctx, logo, L) {
  if (!logo || !logo.img) return;
  const box = L.logo;
  const sw = logo.sw || logo.img.width;
  const sh = logo.sh || logo.img.height;
  const scale = Math.min(box.w / sw, box.h / sh);
  ctx.drawImage(logo.img, logo.sx || 0, logo.sy || 0, sw, sh,
    box.left, box.top, Math.round(sw * scale), Math.round(sh * scale));
}

function coverCrop(img, targetW, targetH, zoom, panX, panY) {
  const baseScale = Math.max(targetW / img.width, targetH / img.height);
  const scale = baseScale * Math.max(zoom, 1);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const maxLeft = Math.max(0, drawW - targetW);
  const maxTop = Math.max(0, drawH - targetH);
  const left = Math.min(Math.max(maxLeft / 2 + panX, 0), maxLeft);
  const top = Math.min(Math.max(maxTop / 2 + panY, 0), maxTop);
  return { drawW, drawH, dx: -left, dy: -top,
           panX: left - maxLeft / 2, panY: top - maxTop / 2 };
}

/*
 * Строка для ctx.filter из настроек ч/б, яркости и контраста карточки.
 * 100% яркости/контраста — нейтральное значение, ничего не меняет.
 */
function photoFilterCss(card) {
  const parts = [];
  if (card.grayscale) parts.push('grayscale(100%)');
  const brightness = card.brightness || 100;
  if (brightness !== 100) parts.push(`brightness(${brightness}%)`);
  const contrast = card.contrast || 100;
  if (contrast !== 100) parts.push(`contrast(${contrast}%)`);
  return parts.length ? parts.join(' ') : 'none';
}

/*
 * Рисует фотографию в область (0,0,W,H) с масштабом, сдвигом и поворотом.
 * При повороте область докрывается с запасом, чтобы по углам не было пустот.
 */
function drawPhoto(ctx, img, W, H, card) {
  const angle = ((card.rotate || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  // размер площадки, которую нужно закрыть, чтобы после поворота не было щелей
  const needW = W * cos + H * sin;
  const needH = W * sin + H * cos;

  const c = coverCrop(img, needW, needH, card.zoom, card.panX, card.panY);

  ctx.save();
  // старые браузеры без ctx.filter просто рисуют фото без ч/б/яркости/контраста —
  // деградирует мягко, как letterSpacing чуть выше по файлу
  if ('filter' in ctx) ctx.filter = photoFilterCss(card);
  ctx.translate(W / 2, H / 2);
  if (angle) ctx.rotate(angle);
  ctx.drawImage(img, c.dx - needW / 2, c.dy - needH / 2, c.drawW, c.drawH);
  ctx.restore();

  return { panX: c.panX, panY: c.panY };
}

/* ---------------------------------------------------------------- сборка */

/*
 * Собирает готовый блок строк карточки: возвращает список
 * { line, size, baselineOffset, pitch } и общую высоту.
 */
function buildBlock(ctx, card, L, style, maxWidth) {
  const bodySize = style.size;
  const headingSize = style.headingSize;
  const lh = style.lineHeight / 100;
  const bodyPitch = Math.round(bodySize * lh);
  const items = [];
  let total = 0;

  if (card.kind === 'cover') {
    const push = (text, size, upper, blockStyle) => {
      if (!text || !text.trim()) return;
      const runs = parseRuns(upper ? text.toUpperCase() : text);
      const pitch = Math.round(size * (blockStyle.lineHeight / 100));
      const lines = layoutParagraph(ctx, runs, size, blockStyle, maxWidth);
      if (items.length) { total += L.gapTitleBody; items.push({ gap: L.gapTitleBody }); }
      for (const line of lines) {
        items.push({ line, size, pitch, style: blockStyle,
                     isLast: line === lines[lines.length - 1] });
        total += pitch;
      }
    };
    // у заголовка и подзаголовка свои настройки: начертание, трекинг, выключка
    const titleStyle = Object.assign({}, style, { weight: L.titleWeight }, card.titleStyle || {});
    const bodyStyle = Object.assign({}, style, { weight: L.bodyWeight }, card.bodyStyle || {});
    push(card.title, headingSize, L.titleUpper, titleStyle);
    push(card.body, bodySize, L.bodyUpper, bodyStyle);
    return { items, total };
  }

  for (const raw of card.lines) {
    if (!raw.trim()) {                  // пустая строка = отступ в одну строку
      items.push({ gap: bodyPitch });
      total += bodyPitch;
      continue;
    }
    // строка целиком жирная — подзаголовок: кегль в полтора раза больше обычного
    const size = isHeading(raw) ? Math.round(bodySize * HEADING_SCALE) : bodySize;
    const runs = parseRuns(raw);
    const lines = layoutParagraph(ctx, runs, size, style, maxWidth);
    lines.forEach((line, i) => {
      // в строке могут быть куски разного кегля — шаг считаем по самому крупному
      const pitch = Math.round((line.maxSize || size) * lh);
      items.push({ line, size, pitch, style, isLast: i === lines.length - 1 });
      total += pitch;
    });
  }
  return { items, total };
}

/*
 * Рисует карточку. Координаты — в единицах карточки (1080xH), масштаб
 * задаётся снаружи через ctx.setTransform, поэтому переносы строк
 * в превью и в экспорте одинаковые.
 */
function renderCard(ctx, card, size, assets, gradient) {
  const [W, H] = size;
  const L = layoutFor(card);
  const hasPhoto = Boolean(card.usePhoto && card.img);
  const style = Object.assign(defaultTypography(card), card.style || {});
  let panX = card.panX, panY = card.panY;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // --- сначала раскладываем текст: от его высоты зависит полоса фотографии
  const maxWidth = W - L.marginX * 2;
  const { items, total } = buildBlock(ctx, card, L, style, maxWidth);

  const drawable = items.filter(it => it.line);
  const first = drawable[0];
  const last = drawable[drawable.length - 1];
  // в макете отступы отмерены до самих букв, а не до строки целиком,
  // поэтому привязываемся к «чернилам» первой и последней строки
  const topInk = first ? Math.round(first.size * ASCENT_RATIO) - first.line.inkAscent : 0;
  const bottomInk = last ? last.pitch - (Math.round(last.size * ASCENT_RATIO) + last.line.inkDescent) : 0;

  const marginBottom = scaleV(L.marginBottom, H);
  const gapPhoto = L.gapPhotoText ? scaleV(L.gapPhotoText, H) : 0;

  /*
   * Полоса фотографии подстраивается под текст: отступ от низа фото до текста
   * и отступ от текста до низа карточки всегда равны 85. Когда текста много,
   * текст поднимается вверх и полоса сжимается.
   */
  let bandH = 0;
  if (hasPhoto && L.photoMode === 'band') {
    // textInk — верх самих букв первой строки, от него и отмеряем 85
    const textInk = total > 0 ? H - marginBottom - total + bottomInk + topInk : H - marginBottom;
    bandH = Math.round(textInk - gapPhoto);
    bandH = Math.max(scaleV(L.photoMinHeight, H), Math.min(bandH, scaleV(L.photoMaxHeight, H)));
  }

  // --- фон и фотография
  ctx.fillStyle = L.bg || '#000000';
  ctx.fillRect(0, 0, W, H);

  if (hasPhoto && L.photoMode === 'full') {
    const c = drawPhoto(ctx, card.img, W, H, card);
    panX = c.panX; panY = c.panY;
  } else if (hasPhoto && L.photoMode === 'band') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, bandH);
    ctx.clip();
    const c = drawPhoto(ctx, card.img, W, bandH, card);
    ctx.restore();
    panX = c.panX; panY = c.panY;
  }

  if (L.useGradient && gradient && gradient.opacity > 0) drawGradient(ctx, W, H, gradient);

  drawLogo(ctx, L.logoVariant === 'dark' ? (assets.logoDark || assets.logo)
                                         : (assets.logo || assets.logoDark), L);

  // --- текст
  // overflow: текста больше, чем помещается в отведённое место без наложения
  // на фото/логотип или верхний край карточки — сигнал для UI подсветить карточку
  let overflow = false;
  if (total > 0) {
    let y;
    const logoBottom = L.logo.top + L.logo.h + LOGO_GAP;
    if (L.anchor === 'bottom') {
      y = H - marginBottom - total + bottomInk;
      // если полоса упёрлась в минимум, текст начинается сразу под ней
      if (hasPhoto && L.photoMode === 'band') {
        const floor = bandH + gapPhoto - topInk;
        if (y < floor) { y = floor; overflow = true; }
      }
      if (y < EDGE_GUARD) overflow = true;
      // фото на всю карточку (обложка) логотип не сдвигает — только предупреждаем
      if (!hasPhoto || L.photoMode !== 'band') { if (y < logoBottom) overflow = true; }
    } else if (L.anchor === 'center') {
      y = (H - total) / 2;
      // центрирование без учёта логотипа могло надвинуть текст прямо на него —
      // прижимаем блок под логотип, а не даём тексту залезать под него
      if (y < logoBottom) { y = logoBottom; overflow = true; }
      if (y < EDGE_GUARD) overflow = true;
      if (y + total > H - EDGE_GUARD) overflow = true;
    } else {
      y = bandH + gapPhoto - topInk;
      const limit = H - EDGE_GUARD - total;
      if (y > limit) { y = Math.max(bandH + 20, limit); overflow = true; }
    }

    const color = card.kind === 'cover' ? L.titleColor : L.textColor;
    for (const item of items) {
      if (item.gap) { y += item.gap; continue; }
      const baseline = y + Math.round(item.size * ASCENT_RATIO);
      drawLine(ctx, item.line, item.size, item.style || style, L.marginX, baseline, maxWidth, color, item.isLast);
      y += item.pitch;
    }
  }

  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
  return { panX, panY, overflow };
}
