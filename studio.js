/* studio.js — استوديو الخيال: خطّط فكرتك من رسمتك قبل ما تبنيها في Scratch */
'use strict';

const SW = 960, SH = 720;
const $ = id => document.getElementById(id);

/* ================= 1) أدوات الصورة ================= */
function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 30; if (h < 0) h += 180;
  }
  return [h, mx ? (d / mx) * 255 : 0, mx];
}
const isPaper = (r, g, b) => { const [, s, v] = rgbToHsv(r, g, b); return v > 150 && s < 75; };

function findPaperCorners(img) {
  const F = 4, w = Math.floor(img.width / F), h = Math.floor(img.height / F);
  const bright = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y * F) * img.width + x * F) * 4;
      const [, s, v] = rgbToHsv(img.data[i], img.data[i + 1], img.data[i + 2]);
      bright[y * w + x] = (v > 140 && s < 75) ? 1 : 0;
    }
  const label = new Int32Array(w * h).fill(-1);
  let bestArea = 0, bestId = -1, id = 0;
  const stack = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!bright[s0] || label[s0] !== -1) continue;
    let area = 0;
    stack.push(s0); label[s0] = id;
    while (stack.length) {
      const p = stack.pop(); area++;
      const px = p % w, py = (p / w) | 0;
      if (px > 0 && bright[p - 1] && label[p - 1] === -1) { label[p - 1] = id; stack.push(p - 1); }
      if (px < w - 1 && bright[p + 1] && label[p + 1] === -1) { label[p + 1] = id; stack.push(p + 1); }
      if (py > 0 && bright[p - w] && label[p - w] === -1) { label[p - w] = id; stack.push(p - w); }
      if (py < h - 1 && bright[p + w] && label[p + w] === -1) { label[p + w] = id; stack.push(p + w); }
    }
    if (area > bestArea) { bestArea = area; bestId = id; }
    id++;
  }
  if (bestArea < 0.25 * w * h) return null;
  let tl, tr, br, bl, minS = 1e9, maxS = -1e9, minD = 1e9, maxD = -1e9;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (label[y * w + x] !== bestId) continue;
      const s = x + y, d = x - y;
      if (s < minS) { minS = s; tl = [x, y]; }
      if (s > maxS) { maxS = s; br = [x, y]; }
      if (d > maxD) { maxD = d; tr = [x, y]; }
      if (d < minD) { minD = d; bl = [x, y]; }
    }
  return [tl, tr, br, bl].map(([x, y]) => [x * F, y * F]);
}

function homography(src, dst) {
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++)
      if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c || !A[c][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  const hM = B.map((b, i) => b / A[i][i]); hM.push(1);
  return hM;
}

function warpToStage(img) {
  const corners = findPaperCorners(img);
  const out = new Uint8ClampedArray(SW * SH * 4);

  // نحسب النسبة الحقيقية (بتاعة الورقة لو لقيناها، أو الصورة كلها)
  let aw, ah;
  if (corners) {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    aw = (d(corners[0], corners[1]) + d(corners[3], corners[2])) / 2;
    ah = (d(corners[0], corners[3]) + d(corners[1], corners[2])) / 2;
  } else { aw = img.width; ah = img.height; }

  // نحتوي الصورة جوه المسرح من غير أي ضغط — لو بالطول تفضل بالطول
  const sc = Math.min(SW / aw, SH / ah);
  const rw = Math.round(aw * sc), rh = Math.round(ah * sc);
  const ox = (SW - rw) >> 1, oy = (SH - rh) >> 1;

  let H = null;
  if (corners) {
    const dstPts = [[ox, oy], [ox + rw, oy], [ox + rw, oy + rh], [ox, oy + rh]];
    H = homography(dstPts, corners);
  }

  for (let y = 0; y < SH; y++)
    for (let x = 0; x < SW; x++) {
      const o = (y * SW + x) * 4;
      const inside = x >= ox && x < ox + rw && y >= oy && y < oy + rh;
      if (!inside) {   // هوامش بلون الورق
        out[o] = 245; out[o + 1] = 243; out[o + 2] = 238; out[o + 3] = 255;
        continue;
      }
      let sx, sy;
      if (H) {
        const d = H[6] * x + H[7] * y + H[8];
        sx = (H[0] * x + H[1] * y + H[2]) / d;
        sy = (H[3] * x + H[4] * y + H[5]) / d;
      } else {
        sx = (x - ox) / sc;
        sy = (y - oy) / sc;
      }
      if (sx >= 0 && sy >= 0 && sx < img.width && sy < img.height) {
        const i = ((sy | 0) * img.width + (sx | 0)) * 4;
        out[o] = img.data[i]; out[o + 1] = img.data[i + 1]; out[o + 2] = img.data[i + 2];
      } else { out[o] = 245; out[o + 1] = 243; out[o + 2] = 238; }
      out[o + 3] = 255;
    }
  return new ImageData(out, SW, SH);
}

/* ================= 2) حالة التطبيق ================= */
const state = {
  mode: null,               // story | anim | game | scene
  backdrops: [],            // {canvas, original} — المشاهد
  items: [],                // {id,name,sprite,w,h,x,y,homeX,homeY,visible,isPlayer,bd}
  rules: [],                // {id,trigger:{type,param},itemId,actions:[{type,param}]}
  answers: {},              // إجابات أسئلة الأفكار
  nextId: 1,
};
const MODE_NAMES = { story: 'قصة', anim: 'أنيميشن', game: 'لعبة', scene: 'مشهد تفاعلي' };

const stage = $('stage'), ctx = stage.getContext('2d');
let curBd = 0;
const curBg = () => state.backdrops[curBd].canvas;

function addBackdrop(imageData) {
  const canvas = document.createElement('canvas'); canvas.width = SW; canvas.height = SH;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  const original = document.createElement('canvas'); original.width = SW; original.height = SH;
  original.getContext('2d').drawImage(canvas, 0, 0);
  state.backdrops.push({ canvas, original });
  return state.backdrops.length - 1;
}

let stageMode = 'arrange';   // arrange | cut | preview | pickpoint
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.style.display = 'none', ms);
}
function hideToast(){ $('toast').style.display = 'none'; }

/* ================= 3) الشاشات ================= */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  $(id).classList.add('on');
  document.body.classList.toggle('compact', id === 'scrStudio');
}

/* --- الرفع --- */
let chosenFile = null;
$('file').addEventListener('change', e => {
  chosenFile = e.target.files[0];
  if (!chosenFile) return;
  $('upPreview').src = URL.createObjectURL(chosenFile);
  $('upPreview').style.display = 'block';
  $('upIcon').style.display = 'none';
  $('dropTitle').textContent = 'جميل! افتح الاستوديو 👇';
  $('goStudio').disabled = false;
});

$('goStudio').addEventListener('click', async () => {
  const btn = $('goStudio');
  btn.disabled = true; btn.textContent = 'ثواني… بنجهّز رسمتك ✨';
  try {
    const img = await readImage(chosenFile);
    const level = warpToStage(img);
    curBd = addBackdrop(level);
    renderScenes();
    showScreen('scrMode');
  } catch (err) {
    $('upError').textContent = 'معرفناش نقرا الصورة — جرّب صورة تانية.';
    $('upError').style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'افتح الاستوديو ✨';
});

function readImage(file) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const MAX = 1280, sc = Math.min(1, MAX / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
      const cx = c.getContext('2d');
      cx.drawImage(im, 0, 0, c.width, c.height);
      resolve(cx.getImageData(0, 0, c.width, c.height));
    };
    im.onerror = () => reject(new Error('bad image'));
    im.src = URL.createObjectURL(file);
  });
}

/* --- اختيار النوع --- */
document.querySelectorAll('.mode').forEach(m => m.addEventListener('click', () => {
  state.mode = m.dataset.mode;
  $('subTitle').textContent = 'إنت بتعمل: ' + MODE_NAMES[state.mode] + ' ' + m.querySelector('.em').textContent;
  buildQuestions();
  showScreen('scrStudio');
  drawStage();
  toast('✂️ ابدأ قصّ عناصرك من الرسمة!');
}));

/* ================= 4) أسئلة الأفكار ================= */
const QUESTIONS = {
  story: ['مين بطل الحكاية؟', 'مين اللي هيتكلم؟ وهيقول إيه؟', 'إيه أول حاجة بتحصل؟',
          'وبعد كده يحصل إيه؟', 'في حاجة بتتحرك؟', 'في حاجة بتختفي أو تظهر؟', 'الحكاية بتخلص إزاي؟'],
  anim:  ['إيه اللي بيتحرك في المشهد؟', 'بيتحرك فين وإزاي؟', 'في حاجة بتظهر أو بتختفي؟',
          'في أصوات؟', 'الأنيميشن بيخلص إزاي؟'],
  game:  ['مين اللاعب؟', 'اللاعب بيقدر يعمل إيه؟', 'اللاعب بيجمع إيه؟', 'اللاعب بيبعد عن إيه؟',
          'لما اللاعب يلمس الحاجة دي، يحصل إيه؟', 'اللاعب بيكسب إزاي؟', 'اللاعب بيخسر إزاي؟'],
  scene: ['إيه اللي بيتحرك في المشهد؟', 'لما أدوس على حاجة، تعمل إيه؟', 'في أصوات؟', 'المشهد بيتغير إزاي؟'],
};
function buildQuestions() {
  const box = $('qList'); box.innerHTML = '';
  QUESTIONS[state.mode].forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'q';
    div.innerHTML = `<label>${q}</label><input placeholder="اكتب فكرتك هنا…">`;
    div.querySelector('input').addEventListener('input', e => state.answers[q] = e.target.value);
    box.appendChild(div);
  });
}

/* ================= 5) اللوحات (التابات) ================= */
document.querySelectorAll('.ptab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.ptab').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('.pane').forEach(x => x.classList.remove('on'));
  t.classList.add('on');
  $('pane-' + t.dataset.pane).classList.add('on');
}));

/* ================= 5ب) المشاهد (الخلفيات) ================= */
$('sceneFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  toast('ثواني… بنجهّز المشهد ✨', 0);
  try {
    const img = await readImage(f);
    curBd = addBackdrop(warpToStage(img));
    renderScenes(); drawStage();
    toast('🖼️ اتضاف مشهد ' + state.backdrops.length + '!');
  } catch (err) { toast('معرفناش نقرا الصورة — جرّب تانية'); }
  e.target.value = '';
});

function renderScenes() {
  const grid = $('scenesGrid'); grid.innerHTML = '';
  state.backdrops.forEach((bd, i) => {
    const card = document.createElement('div');
    card.className = 'item-card scene-card' + (i === curBd ? ' on' : '');
    card.innerHTML = `<img src="${bd.canvas.toDataURL('image/jpeg', 0.5)}">
      <b>مشهد ${i + 1}</b>
      <div class="mini">${state.backdrops.length > 1 ? '<button data-act="del">🗑️</button>' : ''}</div>`;
    card.querySelector('img').addEventListener('click', () => {
      curBd = i; renderScenes(); renderItems(); drawStage();
      toast('🖼️ بتشتغل دلوقتي على مشهد ' + (i + 1));
    });
    const del = card.querySelector('[data-act="del"]');
    if (del) del.addEventListener('click', () => {
      if (state.items.some(it => it.bd === i)) { toast('فيه عناصر متقصوصة من المشهد ده — امسحهم الأول'); return; }
      if (state.rules.some(r => r.actions.some(a => a.type === 'scene' && a.param && a.param.bd === i))) {
        toast('فيه قاعدة بتغيّر للمشهد ده — امسحها الأول'); return;
      }
      state.backdrops.splice(i, 1);
      state.items.forEach(it => { if (it.bd > i) it.bd--; });
      state.rules.forEach(r => r.actions.forEach(a => {
        if (a.type === 'scene' && a.param && a.param.bd > i) a.param.bd--;
      }));
      if (curBd >= state.backdrops.length) curBd = state.backdrops.length - 1;
      renderScenes(); drawStage();
    });
    grid.appendChild(card);
  });
}

/* ================= 6) قصّ العناصر ================= */
let cutStart = null, cutRect = null, pendingSprite = null;

$('btnCut').addEventListener('click', () => {
  if (stageMode === 'preview') return;
  stageMode = stageMode === 'cut' ? 'arrange' : 'cut';
  $('btnCut').classList.toggle('on', stageMode === 'cut');
  if (stageMode === 'cut') toast('حوّط بصباعك على الحاجة اللي عايزها من الرسمة', 0);
  else hideToast();
  drawStage();
});

function stagePos(e) {
  const r = stage.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * SW / r.width,
    y: (e.clientY - r.top) * SH / r.height,
  };
}

function extractItem(rect) {
  const x0 = Math.max(0, Math.round(Math.min(rect.x1, rect.x2)));
  const y0 = Math.max(0, Math.round(Math.min(rect.y1, rect.y2)));
  const w = Math.min(SW, Math.round(Math.abs(rect.x2 - rect.x1)));
  const h = Math.min(SH, Math.round(Math.abs(rect.y2 - rect.y1)));
  if (w < 24 || h < 24) return null;

  const src = curBg().getContext('2d').getImageData(x0, y0, w, h);
  const out = new Uint8ClampedArray(src.data);
  let inkCount = 0;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (isPaper(out[i], out[i + 1], out[i + 2])) out[i + 3] = 0;
    else inkCount++;
  }
  const sp = document.createElement('canvas'); sp.width = w; sp.height = h;
  sp.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);

  // نمسح مكانه من الخلفية (بلون الورق) عشان لما يتحرك ميسبش نسخة وراه
  const bgc = curBg().getContext('2d');
  bgc.fillStyle = '#F2F0EA';
  if (inkCount > 40) bgc.fillRect(x0, y0, w, h);

  return { sprite: sp, x: x0 + w / 2, y: y0 + h / 2, w, h, bd: curBd };
}

/* مودال التسمية */
$('nameCancel').addEventListener('click', () => {
  if (pendingSprite) {  // رجّع الخلفية زي ما كانت
    const { x, y, w, h, bd } = pendingSprite;
    const B = state.backdrops[bd];
    B.canvas.getContext('2d').drawImage(B.original, x - w / 2, y - h / 2, w, h, x - w / 2, y - h / 2, w, h);
  }
  pendingSprite = null;
  $('nameModal').classList.remove('on');
  drawStage();
});
$('nameOk').addEventListener('click', () => {
  const name = $('nameInput').value.trim() || ('عنصر ' + state.nextId);
  const it = {
    id: state.nextId++, name,
    sprite: pendingSprite.sprite,
    w: pendingSprite.w, h: pendingSprite.h,
    x: pendingSprite.x, y: pendingSprite.y,
    homeX: pendingSprite.x, homeY: pendingSprite.y,
    visible: true, isPlayer: false, bd: pendingSprite.bd,
  };
  state.items.push(it);
  pendingSprite = null;
  $('nameModal').classList.remove('on');
  renderItems();
  drawStage();
  toast('🧩 اتضاف "' + name + '" لعناصرك!');
});

function renderItems() {
  const grid = $('itemsGrid'); grid.innerHTML = '';
  const mine = state.items.filter(it => it.bd === curBd);
  $('itemsEmpty').style.display = mine.length ? 'none' : 'block';
  $('itemsEmpty').textContent = state.backdrops.length > 1
    ? 'مفيش عناصر في مشهد ' + (curBd + 1) + ' — دوس ✂️ وحوّط على حاجة فيه'
    : 'لسه مفيش عناصر — دوس ✂️ قصّ عنصر وحوّط على حاجة في رسمتك';
  const playerAllowed = state.mode === 'game' || state.mode === 'scene';
  for (const it of mine) {
    const card = document.createElement('div');
    card.className = 'item-card' + (it.isPlayer ? ' player' : '');
    card.innerHTML = `
      <span class="ptag">اللاعب</span>
      <img src="${it.sprite.toDataURL()}">
      <b>${it.name}</b>
      <div class="mini">
        ${playerAllowed ? `<button title="خليه اللاعب" data-act="player">⭐</button>` : ''}
        <button title="حذف" data-act="del">🗑️</button>
      </div>`;
    card.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.act === 'del') {
        // رجّع مكانه في الخلفية اللي اتقص منها
        const B = state.backdrops[it.bd];
        B.canvas.getContext('2d').drawImage(B.original,
          it.homeX - it.w / 2, it.homeY - it.h / 2, it.w, it.h,
          it.homeX - it.w / 2, it.homeY - it.h / 2, it.w, it.h);
        state.items = state.items.filter(x => x.id !== it.id);
        state.rules = state.rules.filter(r => r.itemId !== it.id &&
          !(r.trigger.type === 'touch' && r.trigger.param === it.id));
        renderItems(); renderRules(); drawStage();
      } else {
        state.items.forEach(x => x.isPlayer = false);
        it.isPlayer = true;
        renderItems();
        toast('⭐ "' + it.name + '" بقى اللاعب — هيتحرك بالأسهم في التجربة');
      }
    }));
    grid.appendChild(card);
  }
}

/* ================= 7) تفاعل المسرح ================= */
let dragItem = null, dragOff = null;

stage.addEventListener('pointerdown', e => {
  const p = stagePos(e);
  stage.setPointerCapture(e.pointerId);

  if (stageMode === 'pickpoint') {
    pickedPoint = { x: Math.round(p.x), y: Math.round(p.y) };
    stageMode = 'arrange';
    hideToast();
    reopenRuleModal();
    return;
  }
  if (stageMode === 'cut') { cutStart = p; cutRect = null; return; }
  if (stageMode === 'preview') { previewTap(p); return; }

  // arrange: مسك عنصر (من المشهد الحالي بس)
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (it.bd !== curBd) continue;
    if (Math.abs(p.x - it.x) < it.w / 2 && Math.abs(p.y - it.y) < it.h / 2) {
      dragItem = it; dragOff = { x: p.x - it.x, y: p.y - it.y };
      return;
    }
  }
});
stage.addEventListener('pointermove', e => {
  const p = stagePos(e);
  if (stageMode === 'cut' && cutStart) {
    cutRect = { x1: cutStart.x, y1: cutStart.y, x2: p.x, y2: p.y };
    drawStage();
  } else if (dragItem) {
    dragItem.x = p.x - dragOff.x; dragItem.y = p.y - dragOff.y;
    dragItem.homeX = dragItem.x; dragItem.homeY = dragItem.y;
    drawStage();
  }
});
stage.addEventListener('pointerup', () => {
  if (stageMode === 'cut' && cutRect) {
    const got = extractItem(cutRect);
    cutStart = null; cutRect = null;
    if (got) {
      pendingSprite = got;
      $('nameThumb').src = got.sprite.toDataURL();
      $('nameInput').value = '';
      $('nameModal').classList.add('on');
      setTimeout(() => $('nameInput').focus(), 60);
      stageMode = 'arrange';
      $('btnCut').classList.remove('on');
      hideToast();
    }
    drawStage();
  }
  dragItem = null;
  if (stageMode === 'cut') cutStart = null;
});

/* ================= 8) الرسم ================= */
/* لف الكلام على سطور — والكلمة الطويلة أوي بتتقسم حروف عشان متطلعش بره */
function wrapText(c, text, maxW) {
  const lines = [];
  let line = '';
  const pushWord = (w) => {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width <= maxW) { line = t; return; }
    if (line) { lines.push(line); line = ''; }
    if (c.measureText(w).width <= maxW) { line = w; return; }
    let part = '';
    for (const ch of w) {
      if (c.measureText(part + ch).width > maxW) { lines.push(part); part = ch; }
      else part += ch;
    }
    line = part;
  };
  for (const w of String(text).trim().split(/\s+/)) pushWord(w);
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawStage(runtime) {
  ctx.clearRect(0, 0, SW, SH);
  if (!state.backdrops.length) return;
  const bdi = runtime ? runtime.bd : curBd;
  ctx.drawImage(state.backdrops[bdi].canvas, 0, 0);

  // تظليل المشهد (تغيير المشهد في التجربة)
  if (runtime && runtime.tint) {
    ctx.fillStyle = runtime.tint === 'night' ? 'rgba(30,40,90,.45)' : 'rgba(255,140,40,.30)';
    ctx.fillRect(0, 0, SW, SH);
  }

  for (const it of state.items) {
    if (it.bd !== bdi) continue;   // كل مشهد بعناصره بس
    const vis = runtime ? runtime.vis[it.id] : it.visible;
    if (!vis) continue;
    const x = runtime ? runtime.pos[it.id].x : it.x;
    const y = runtime ? runtime.pos[it.id].y : it.y;
    ctx.drawImage(it.sprite, x - it.w / 2, y - it.h / 2);
    if (!runtime) {   // إطار خفيف في وضع الترتيب
      ctx.strokeStyle = 'rgba(43,108,230,.55)';
      ctx.setLineDash([7, 5]); ctx.lineWidth = 2;
      ctx.strokeRect(x - it.w / 2, y - it.h / 2, it.w, it.h);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(43,108,230,.85)';
      ctx.font = "bold 15px Tajawal";
      ctx.textAlign = 'center';
      ctx.fillText(it.name + (it.isPlayer ? ' ⭐' : ''), x, y - it.h / 2 - 7);
    }
  }

  // فقاعات الكلام — بتتوسع على قد الكلام ومتطلعش بره الشاشة
  if (runtime) {
    ctx.font = "bold 19px Tajawal"; ctx.textAlign = 'center';
    const LINE_H = 26, PAD = 14, MAX_TEXT_W = 300;
    for (const b of runtime.bubbles) {
      const it = state.items.find(i => i.id === b.itemId);
      if (!it || it.bd !== bdi) continue;
      const x = runtime.pos[it.id].x, topY = runtime.pos[it.id].y - it.h / 2;

      const lines = wrapText(ctx, b.text, MAX_TEXT_W);
      let tw = 0;
      for (const ln of lines) tw = Math.max(tw, ctx.measureText(ln).width);
      tw = Math.min(SW - 12, Math.max(64, tw + PAD * 2));
      const th = lines.length * LINE_H + PAD;

      const bx = Math.max(6, Math.min(SW - tw - 6, x - tw / 2));
      let by = topY - th - 20;
      let below = false;
      if (by < 6) {   // مفيش مكان فوق؟ اعرضها تحت العنصر
        by = Math.min(SH - th - 6, runtime.pos[it.id].y + it.h / 2 + 18);
        below = true;
      }

      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2A2D34'; ctx.lineWidth = 2.5;
      roundRect(ctx, bx, by, tw, th, 12); ctx.fill(); ctx.stroke();
      // ذيل الفقاعة ناحية العنصر
      const tx = Math.max(bx + 16, Math.min(bx + tw - 16, x));
      ctx.beginPath();
      if (below) {
        ctx.moveTo(tx - 8, by); ctx.lineTo(tx + 8, by); ctx.lineTo(tx, by - 12);
      } else {
        ctx.moveTo(tx - 8, by + th); ctx.lineTo(tx + 8, by + th); ctx.lineTo(tx, by + th + 12);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();

      ctx.fillStyle = '#2A2D34';
      lines.forEach((ln, i) =>
        ctx.fillText(ln, bx + tw / 2, by + PAD / 2 + (i + 0.75) * LINE_H));
    }
  }

  // مستطيل القص
  if (cutRect) {
    ctx.strokeStyle = '#FF6B35'; ctx.lineWidth = 3; ctx.setLineDash([9, 6]);
    ctx.strokeRect(Math.min(cutRect.x1, cutRect.x2), Math.min(cutRect.y1, cutRect.y2),
                   Math.abs(cutRect.x2 - cutRect.x1), Math.abs(cutRect.y2 - cutRect.y1));
    ctx.setLineDash([]);
  }
}

/* ================= 9) بطاقات القواعد ================= */
const TRIGGERS = [
  { t: 'start', em: '🏁', name: 'في البداية' },
  { t: 'tap',   em: '👆', name: 'لما أدوس عليه' },
  { t: 'key',   em: '⌨️', name: 'لما أدوس زرار' },
  { t: 'touch', em: '🤝', name: 'لما يلمس…' },
  { t: 'timer', em: '⏱️', name: 'بعد كام ثانية' },
  { t: 'reach', em: '📍', name: 'لما يوصل لمكان' },
  { t: 'score', em: '⭐', name: 'لما النقط تكفي' },
];
const ACTIONS = [
  { t: 'move',   em: '🏃', name: 'يتحرك' },
  { t: 'jump',   em: '🦘', name: 'ينط' },
  { t: 'talk',   em: '💬', name: 'يتكلم' },
  { t: 'hide',   em: '🫥', name: 'يختفي' },
  { t: 'show',   em: '✨', name: 'يظهر' },
  { t: 'collect',em: '🪙', name: 'يتجمع (+نقطة)' },
  { t: 'avoid',  em: '💥', name: 'خطر! ارجع للبداية' },
  { t: 'win',    em: '🏆', name: 'مكسب' },
  { t: 'lose',   em: '😢', name: 'خسارة' },
  { t: 'scene',  em: '🌙', name: 'يغيّر المشهد' },
  { t: 'sound',  em: '🔊', name: 'صوت' },
  { t: 'wait',   em: '⏳', name: 'يستنى' },
  { t: 'follow', em: '🧲', name: 'يتبع…' },
];
const DIRS = { right: 'يمين', left: 'شمال', up: 'فوق', down: 'تحت' };
const KEY_NAMES = { Space: 'المسافة ⎵', ArrowRight: 'سهم يمين ▶', ArrowLeft: 'سهم شمال ◀',
                    ArrowUp: 'سهم فوق ▲', ArrowDown: 'سهم تحت ▼' };
const KEY_ICONS = { Space: '⤒', ArrowRight: '◀', ArrowLeft: '▶', ArrowUp: '▲', ArrowDown: '▼' };

let editRule = null, pickedPoint = null, editingRuleId = null;

$('btnNewRule').addEventListener('click', () => openRuleModal());

function openRuleModal(existing) {
  if (!state.items.length) { toast('✂️ قصّ عنصر واحد على الأقل الأول!'); return; }
  if (existing) {
    editRule = JSON.parse(JSON.stringify(existing));   // نسخة — الإلغاء ميأثرش على الأصل
    editingRuleId = existing.id;
  } else {
    editRule = { trigger: null, itemId: null, actions: [] };
    editingRuleId = null;
  }
  pickedPoint = null;
  buildRuleModal();
  $('ruleModal').classList.add('on');
}
function reopenRuleModal() {
  if (editRule && editRule.trigger && editRule.trigger.type === 'reach')
    editRule.trigger.param = pickedPoint;
  buildRuleModal();
  $('ruleModal').classList.add('on');
}

function buildRuleModal() {
  // بطاقات "إمتى"
  const tc = $('triggerCards'); tc.innerHTML = '';
  for (const tr of TRIGGERS) {
    if (tr.t === 'score' && !['game', 'scene'].includes(state.mode)) continue;
    const b = document.createElement('button');
    b.className = 'pick trigger-card' + (editRule.trigger?.type === tr.t ? ' on' : '');
    b.innerHTML = `<span class="em">${tr.em}</span><b>${tr.name}</b>`;
    b.addEventListener('click', () => {
      editRule.trigger = { type: tr.t, param: null };
      if (tr.t === 'timer') editRule.trigger.param = 3;
      if (tr.t === 'score') editRule.trigger.param = 3;
      if (tr.t === 'reach') {
        $('ruleModal').classList.remove('on');
        stageMode = 'pickpoint';
        toast('📍 دوس على المكان في رسمتك!', 0);
        return;
      }
      buildRuleModal();
    });
    tc.appendChild(b);
  }
  // باراميترات التريجر
  const tp = $('trigParams'); tp.innerHTML = ''; tp.classList.remove('on');
  if (editRule.trigger) {
    const tt = editRule.trigger.type;
    if (tt === 'timer' || tt === 'score') {
      tp.classList.add('on');
      tp.innerHTML = `<label>${tt === 'timer' ? 'كام ثانية؟' : 'كام نقطة؟'}</label>`;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 1; inp.max = 60; inp.value = editRule.trigger.param;
      inp.addEventListener('input', () => { editRule.trigger.param = +inp.value || 1; updateSentence(); });
      tp.appendChild(inp);
    }
    if (tt === 'key') {
      tp.classList.add('on');
      tp.innerHTML = `<label style="width:100%">أنهي زرار؟ (على الموبايل هيظهر كزرار على الشاشة)</label>`;
      for (const [code, name] of Object.entries(KEY_NAMES)) {
        const b = document.createElement('button');
        b.className = 'pick' + (editRule.trigger.param === code ? ' on' : '');
        b.innerHTML = `<b>${name}</b>`;
        b.addEventListener('click', () => { editRule.trigger.param = code; buildRuleModal(); });
        tp.appendChild(b);
      }
      editRule.trigger.param = editRule.trigger.param || 'Space';
    }
    if (tt === 'touch') {
      tp.classList.add('on');
      tp.innerHTML = `<label>يلمس مين؟</label>`;
      const sel = document.createElement('select');
      for (const it of state.items) {
        const o = document.createElement('option');
        o.value = it.id; o.textContent = it.name;
        sel.appendChild(o);
      }
      editRule.trigger.param = editRule.trigger.param || state.items[0].id;
      sel.value = editRule.trigger.param;
      sel.addEventListener('change', () => { editRule.trigger.param = +sel.value; updateSentence(); });
      tp.appendChild(sel);
    }
  }

  // بطاقات "مين"
  const ic = $('itemCards'); ic.innerHTML = '';
  for (const it of state.items) {
    const b = document.createElement('button');
    b.className = 'pick' + (editRule.itemId === it.id ? ' on' : '');
    const bdTag = state.backdrops.length > 1 ? `<small style="color:#8a8d94">مشهد ${it.bd + 1}</small>` : '';
    b.innerHTML = `<img src="${it.sprite.toDataURL()}" style="height:38px; display:block; margin:0 auto"><b>${it.name}</b>${bdTag}`;
    b.addEventListener('click', () => { editRule.itemId = it.id; buildRuleModal(); });
    ic.appendChild(b);
  }

  // بطاقات "يعمل إيه"
  const ac = $('actionCards'); ac.innerHTML = '';
  for (const a of ACTIONS) {
    if (['collect', 'avoid', 'win', 'lose'].includes(a.t) && !['game', 'scene'].includes(state.mode)
        && a.t !== 'win' && a.t !== 'lose') continue;
    const b = document.createElement('button');
    b.className = 'pick action-card';
    b.innerHTML = `<span class="em">${a.em}</span><b>${a.name}</b>`;
    b.addEventListener('click', () => askActionParam(a.t));
    ac.appendChild(b);
  }
  renderActionChips();
  updateSentence();
}

function askActionParam(type) {
  const ap = $('actParams'); ap.innerHTML = ''; ap.classList.add('on');
  let target = editRule.itemId ?? state.items[0].id;
  const add = (action) => {
    action.target = target;
    editRule.actions.push(action);
    ap.classList.remove('on'); renderActionChips(); updateSentence();
  };

  // مين اللي يعمل الأمر ده؟ (يقدر يبقى عنصر تاني غير بتاع القاعدة!)
  if (state.items.length > 1) {
    const lbl = document.createElement('label');
    lbl.textContent = 'مين اللي يعمل ده؟';
    lbl.style.width = '100%';
    ap.appendChild(lbl);
    const wrap = document.createElement('div');
    wrap.className = 'cards'; wrap.style.width = '100%';
    for (const it of state.items) {
      const b = document.createElement('button');
      b.className = 'pick' + (it.id === target ? ' on' : '');
      b.innerHTML = `<b>${it.name}</b>`;
      b.addEventListener('click', () => {
        target = it.id;
        wrap.querySelectorAll('.pick').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
      });
      wrap.appendChild(b);
    }
    ap.appendChild(wrap);
    const sep = document.createElement('div'); sep.style.width = '100%';
    ap.appendChild(sep);
  }

  if (type === 'move') {
    { const l = document.createElement('label'); l.textContent = 'ناحية؟'; l.style.width = '100%'; ap.appendChild(l); }
    for (const [d, name] of Object.entries(DIRS)) {
      const b = document.createElement('button');
      b.className = 'pick'; b.innerHTML = `<b>${name}</b>`;
      b.addEventListener('click', () => add({ type: 'move', param: d }));
      ap.appendChild(b);
    }
  } else if (type === 'talk') {
    { const l = document.createElement('label'); l.textContent = 'يقول إيه؟'; l.style.width = '100%'; ap.appendChild(l); }
    const inp = document.createElement('input'); inp.placeholder = 'مثلاً: أهلاً!';
    inp.maxLength = 140;
    ap.appendChild(inp);
    const voiceWrap = document.createElement('label');
    voiceWrap.style.cssText = 'width:100%; display:flex; align-items:center; gap:8px; font-weight:700; cursor:pointer';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.style.cssText = 'width:22px; height:22px; flex:0 0 auto; min-width:0; accent-color:var(--green)';
    voiceWrap.appendChild(chk);
    voiceWrap.appendChild(document.createTextNode('🗣️ ينطق الكلام بصوت كمان'));
    ap.appendChild(voiceWrap);
    const ok = document.createElement('button'); ok.className = 'pick'; ok.innerHTML = '<b>تمام ✓</b>';
    ok.addEventListener('click', () => add({ type: 'talk', param: { text: inp.value.trim() || 'أهلاً!', voice: chk.checked } }));
    ap.appendChild(ok);
  } else if (type === 'wait') {
    { const l = document.createElement('label'); l.textContent = 'كام ثانية؟'; l.style.width = '100%'; ap.appendChild(l); }
    const inp = document.createElement('input'); inp.type = 'number'; inp.min = 1; inp.max = 30; inp.value = 2;
    const ok = document.createElement('button'); ok.className = 'pick'; ok.innerHTML = '<b>تمام ✓</b>';
    ok.addEventListener('click', () => add({ type: 'wait', param: +inp.value || 2 }));
    ap.appendChild(inp); ap.appendChild(ok);
  } else if (type === 'follow') {
    const l2 = document.createElement('label'); l2.textContent = 'يتبع مين؟';
    ap.appendChild(l2);
    for (const it of state.items) {
      const b = document.createElement('button');
      b.className = 'pick'; b.innerHTML = `<b>${it.name}</b>`;
      b.addEventListener('click', () => {
        if (it.id === target) { toast('مينفعش يتبع نفسه 😄 اختار حد تاني'); return; }
        add({ type: 'follow', param: it.id });
      });
      ap.appendChild(b);
    }
  } else if (type === 'sound') {
    { const l = document.createElement('label'); l.textContent = 'صوت إيه؟'; l.style.width = '100%'; ap.appendChild(l); }
    for (const [s, name] of Object.entries({ happy: 'نغمة سعيدة 🎵', alert: 'تنبيه ⚠️', winml: 'مزيكا فوز 🎺' })) {
      const b = document.createElement('button');
      b.className = 'pick'; b.innerHTML = `<b>${name}</b>`;
      b.addEventListener('click', () => add({ type: 'sound', param: s }));
      ap.appendChild(b);
    }
  } else if (type === 'scene') {
    { const l = document.createElement('label'); l.textContent = 'يروح لأنهي مشهد؟'; l.style.width = '100%'; ap.appendChild(l); }
    state.backdrops.forEach((bd, i) => {
      const b = document.createElement('button');
      b.className = 'pick';
      b.innerHTML = `<img src="${bd.canvas.toDataURL('image/jpeg', 0.4)}" style="height:44px; display:block; margin:0 auto 3px; border-radius:6px"><b>مشهد ${i + 1}</b>`;
      b.addEventListener('click', () => add({ type: 'scene', param: { bd: i } }));
      ap.appendChild(b);
    });
    for (const [s, name] of Object.entries({ night: 'ليل 🌙', sunset: 'غروب 🌇', normal: 'نهار ☀️' })) {
      const b = document.createElement('button');
      b.className = 'pick'; b.innerHTML = `<b>${name}</b>`;
      b.addEventListener('click', () => add({ type: 'scene', param: { tint: s } }));
      ap.appendChild(b);
    }
  } else if (type === 'win' || type === 'lose') {
    { const l = document.createElement('label'); l.textContent = 'الرسالة؟'; l.style.width = '100%'; ap.appendChild(l); }
    const inp = document.createElement('input');
    inp.placeholder = type === 'win' ? 'برافو! كسبت 🏆' : 'للأسف خسرت 😢';
    const ok = document.createElement('button'); ok.className = 'pick'; ok.innerHTML = '<b>تمام ✓</b>';
    ok.addEventListener('click', () => add({ type, param: inp.value.trim() || inp.placeholder }));
    ap.appendChild(inp); ap.appendChild(ok);
  } else {
    // أوامر من غير إعدادات (يختفي/يظهر/يتجمع/خطر)
    if (state.items.length > 1) {
      const ok = document.createElement('button');
      ok.className = 'pick'; ok.innerHTML = '<b>تمام ✓</b>';
      ok.addEventListener('click', () => add({ type, param: null }));
      ap.appendChild(ok);
    } else {
      add({ type, param: null });
    }
  }
}

function actionText(a, ownerId) {
  const who = (a.target != null && a.target !== ownerId)
    ? (() => { const t = state.items.find(i => i.id === a.target); return t ? '«' + t.name + '» ' : ''; })()
    : '';
  switch (a.type) {
    case 'move': return who + 'يتحرك ناحية ' + DIRS[a.param];
    case 'jump': return who + 'ينط';
    case 'talk': return who + 'يقول «' + talkText(a.param) + '»' + (talkVoice(a.param) ? ' 🗣️' : '');
    case 'hide': return who + 'يختفي';
    case 'show': return who + 'يظهر';
    case 'collect': return who + 'يتجمع وتزيد النقط';
    case 'avoid': return 'اللاعب يرجع للبداية';
    case 'win': return 'الكل يكسب 🏆';
    case 'lose': return 'اللعبة تخسر 😢';
    case 'scene':
      if (a.param && a.param.bd != null) return 'المشهد يتغيّر لمشهد ' + (a.param.bd + 1);
      return 'المشهد يبقى ' + ({ night: 'ليل', sunset: 'غروب', normal: 'نهار' })[a.param.tint];
    case 'sound': return 'يطلع صوت';
    case 'wait': return who + 'يستنى ' + a.param + ' ثواني';
    case 'follow': {
      const t = state.items.find(i => i.id === a.param);
      return who + 'يتبع ' + (t ? t.name : '؟');
    }
  }
}
function triggerText(tr) {
  switch (tr.type) {
    case 'start': return 'في البداية';
    case 'tap': return 'لما أدوس عليه';
    case 'key': return 'لما أدوس ' + (KEY_NAMES[tr.param] || 'زرار');
    case 'touch': {
      const t = state.items.find(i => i.id === tr.param);
      return 'لما يلمس ' + (t ? t.name : '؟');
    }
    case 'timer': return 'بعد ' + tr.param + ' ثواني';
    case 'reach': return 'لما يوصل للمكان 📍';
    case 'score': return 'لما النقط توصل ' + tr.param;
  }
}
function ruleSentence(r) {
  const it = state.items.find(i => i.id === r.itemId);
  return { tg: triggerText(r.trigger), it: it ? it.name : '؟',
           acts: r.actions.map(a => actionText(a, r.itemId)).join('، وبعدين ') };
}

function renderActionChips() {
  const box = $('actChips'); box.innerHTML = '';
  editRule.actions.forEach((a, i) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = actionText(a, editRule.itemId) + ' <button>✕</button>';
    c.querySelector('button').addEventListener('click', () => {
      editRule.actions.splice(i, 1);
      renderActionChips(); updateSentence();
    });
    box.appendChild(c);
  });
}
function updateSentence() {
  const s = $('ruleSentence');
  if (!editRule.trigger || !editRule.itemId || !editRule.actions.length) {
    s.textContent = 'اختار بطاقة برتقالي + عنصر + بطاقة زرقا…';
    return;
  }
  const sn = ruleSentence(editRule);
  s.innerHTML = `<span style="color:var(--orange)">${sn.tg}</span>، <span style="color:var(--blue)">${sn.it}</span> ${sn.acts}.`;
}

$('ruleCancel').addEventListener('click', () => { editingRuleId = null; $('ruleModal').classList.remove('on'); hideToast(); });
$('ruleSave').addEventListener('click', () => {
  if (!editRule.trigger || !editRule.itemId || !editRule.actions.length) {
    toast('كمّل القاعدة: إمتى + مين + يعمل إيه'); return;
  }
  editRule.actions.forEach(a => { if (a.target == null) a.target = editRule.itemId; });
  if (editingRuleId != null) {
    editRule.id = editingRuleId;
    const i = state.rules.findIndex(r => r.id === editingRuleId);
    if (i !== -1) state.rules[i] = editRule; else state.rules.push(editRule);
    toast('✏️ اتعدلت القاعدة');
  } else {
    editRule.id = state.nextId++;
    state.rules.push(editRule);
  }
  editingRuleId = null;
  $('ruleModal').classList.remove('on');
  renderRules();
});

function renderRules() {
  const list = $('rulesList'); list.innerHTML = '';
  $('rulesEmpty').style.display = state.rules.length ? 'none' : 'block';
  for (const r of state.rules) {
    const sn = ruleSentence(r);
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.innerHTML = `<div class="sent"><span class="tg">${sn.tg}</span>، <span class="it">${sn.it}</span> ${sn.acts}.</div>
                     <button data-act="edit" title="تعديل">✏️</button>
                     <button data-act="del" title="حذف">🗑️</button>`;
    row.querySelector('[data-act="edit"]').addEventListener('click', () => openRuleModal(r));
    row.querySelector('[data-act="del"]').addEventListener('click', () => {
      state.rules = state.rules.filter(x => x.id !== r.id);
      renderRules();
    });
    list.appendChild(row);
  }
}

/* نص الكلام وهل بينطق — بيدعم الشكل القديم (نص مباشر) والجديد {text, voice} */
const talkText = p => (p && typeof p === 'object') ? p.text : p;
const talkVoice = p => !!(p && typeof p === 'object' && p.voice);

function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ar-EG'; u.rate = 0.95;
    const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('ar'));
    if (v) u.voice = v;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {}
}

/* ================= 10) الأصوات ================= */
let audioCtx = null;
function beep(kind) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'happy' ? [[523, 0], [659, .12]]
                : kind === 'alert' ? [[180, 0]]
                : [[523, 0], [659, .12], [784, .24], [1047, .36]];
    for (const [f, t] of notes) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'triangle';
      g.gain.setValueAtTime(.18, audioCtx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + t + .22);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + .25);
    }
  } catch (e) {}
}

/* ================= 11) محرك التجربة ================= */
let R = null, rafId = null;
const keys = {};
document.addEventListener('keydown', e => {
  if (stageMode === 'preview') {
    if (['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
    if (R && !R.ended)
      for (const r of state.rules)
        if (r.trigger.type === 'key' && r.trigger.param === e.code) fireRule(r);
  }
  keys[e.code] = true;
});
document.addEventListener('keyup', e => keys[e.code] = false);
document.querySelectorAll('#dpadMove .tbtn').forEach(b => {
  b.addEventListener('pointerdown', e => { e.preventDefault(); keys[b.dataset.k] = true; });
  b.addEventListener('pointerup', () => keys[b.dataset.k] = false);
  b.addEventListener('pointerleave', () => keys[b.dataset.k] = false);
});

$('btnPreview').addEventListener('click', startPreview);
$('btnStop').addEventListener('click', stopPreview);
$('endRetry').addEventListener('click', () => { $('endOv').style.display = 'none'; startPreview(); });

function startPreview() {
  if (!state.rules.length) { toast('🃏 اعمل قاعدة واحدة على الأقل الأول!'); return; }
  stageMode = 'preview';
  $('btnPreview').style.display = 'none';
  $('btnStop').style.display = 'inline-block';
  $('endOv').style.display = 'none';

  R = {
    t0: performance.now(), now: 0, bd: 0,
    pos: {}, vis: {}, score: 0, tint: null, ended: false,
    bubbles: [], cor: [], fired: new Set(), touchArmed: {}, follows: {},
  };
  for (const it of state.items) {
    R.pos[it.id] = { x: it.homeX, y: it.homeY, glide: null };
    R.vis[it.id] = true;
  }
  const hasScore = state.rules.some(r =>
    r.actions.some(a => a.type === 'collect') || r.trigger.type === 'score');
  $('scoreChip').style.display = hasScore ? 'block' : 'none';
  $('scoreChip').textContent = '⭐ 0';

  const player = state.items.find(i => i.isPlayer);
  const coarse = window.matchMedia('(pointer:coarse)').matches;
  const showPad = !!player && coarse;
  $('dpadMove').style.display = showPad ? 'flex' : 'none';

  // زراير للقواعد اللي بتستخدم الكيبورد (Space/أسهم) — في بوكس تحت اللعبة
  const kb = $('keyBtns'); kb.innerHTML = '';
  const usedKeys = [...new Set(state.rules.filter(r => r.trigger.type === 'key').map(r => r.trigger.param))];
  const showKeys = usedKeys.length > 0 && coarse;
  kb.style.display = showKeys ? 'flex' : 'none';
  $('controlsBox').style.display = (showPad || showKeys) ? 'flex' : 'none';
  for (const code of usedKeys) {
    const b = document.createElement('button');
    b.className = 'tbtn' + (code === 'Space' ? ' jump' : '');
    b.textContent = KEY_ICONS[code] || '⎵';
    let rep = null;
    const fire = () => { if (R && !R.ended) for (const r of state.rules)
      if (r.trigger.type === 'key' && r.trigger.param === code) fireRule(r); };
    b.addEventListener('pointerdown', e => { e.preventDefault(); fire(); rep = setInterval(fire, 170); });
    const stop = () => { clearInterval(rep); rep = null; };
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointerleave', stop);
    kb.appendChild(b);
  }
  if (player) toast('⭐ حرّك ' + player.name + ' بالأسهم!');
  else toast('▶ التجربة شغالة!');

  // قواعد "في البداية" و"التايمر"
  for (const r of state.rules) {
    if (r.trigger.type === 'start') fireRule(r);
    if (r.trigger.type === 'timer') setTimeoutSafe(r);
  }
  rafId = requestAnimationFrame(previewLoop);
}

function setTimeoutSafe(rule) {
  const at = performance.now() + rule.trigger.param * 1000;
  R.cor.push({ waitUntil: at, thenFire: rule, actions: [], idx: 0, itemId: rule.itemId });
}

function stopPreview() {
  try { speechSynthesis.cancel(); } catch (e) {}
  stageMode = 'arrange';
  cancelAnimationFrame(rafId);
  R = null;
  $('btnPreview').style.display = 'inline-block';
  $('btnStop').style.display = 'none';
  $('dpadMove').style.display = 'none';
  $('keyBtns').style.display = 'none';
  $('controlsBox').style.display = 'none';
  $('scoreChip').style.display = 'none';
  $('endOv').style.display = 'none';
  hideToast();
  drawStage();
}

function fireRule(rule) {
  R.cor.push({ itemId: rule.itemId, actions: rule.actions.slice(), idx: 0, waitUntil: 0 });
}

function previewTap(p) {
  if (!R || R.ended) return;
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (it.bd !== R.bd || !R.vis[it.id]) continue;
    const pos = R.pos[it.id];
    if (Math.abs(p.x - pos.x) < it.w / 2 && Math.abs(p.y - pos.y) < it.h / 2) {
      for (const r of state.rules)
        if (r.trigger.type === 'tap' && r.itemId === it.id) fireRule(r);
      return;
    }
  }
}

function endGame(kind, msg) {
  R.ended = true;
  $('endTitle').textContent = kind === 'win' ? '🏆 ' + msg : '😢 ' + msg;
  $('endMsg').textContent = kind === 'win' ? 'فكرتك اشتغلت! جاهز تبنيها في سكراتش؟' : 'جرّب تاني — إنت قدها!';
  $('endOv').style.display = 'flex';
  beep(kind === 'win' ? 'winml' : 'alert');
}

function previewLoop(nowMs) {
  if (!R) return;
  R.now = nowMs;
  const it2 = id => state.items.find(i => i.id === id);

  if (!R.ended) {
    // حركة اللاعب
    const player = state.items.find(i => i.isPlayer);
    if (player && player.bd === R.bd && R.vis[player.id]) {
      const p = R.pos[player.id], sp = 3.4;
      if (keys.ArrowRight) p.x += sp;
      if (keys.ArrowLeft) p.x -= sp;
      if (keys.ArrowUp) p.y -= sp;
      if (keys.ArrowDown) p.y += sp;
      p.x = Math.max(20, Math.min(SW - 20, p.x));
      p.y = Math.max(20, Math.min(SH - 20, p.y));
    }

    // اتباع
    for (const [idStr, targetId] of Object.entries(R.follows)) {
      const id = +idStr, tgt = R.pos[targetId], me = R.pos[id];
      if (!tgt || !me || !R.vis[id] || !R.vis[targetId]) continue;
      const dx = tgt.x - me.x, dy = tgt.y - me.y, d = Math.hypot(dx, dy);
      if (d > 6) { me.x += dx / d * 1.7; me.y += dy / d * 1.7; }
    }

    // الانزلاق (يتحرك)
    for (const it of state.items) {
      const p = R.pos[it.id];
      if (!p.glide) continue;
      const dx = p.glide.x - p.x, dy = p.glide.y - p.y, d = Math.hypot(dx, dy);
      if (d < 4) { p.x = p.glide.x; p.y = p.glide.y; p.glide = null; }
      else { p.x += dx / d * 4; p.y += dy / d * 4; }
    }

    // الكوروتينات (سلاسل الأكشنات)
    for (const c of R.cor) {
      if (c.done) continue;
      if (c.waitUntil > nowMs) continue;
      if (c.thenFire) { fireRule(c.thenFire); c.done = true; continue; }
      const item = it2(c.itemId);
      // مستنيين انزلاق يخلص؟
      if (c.glidingId != null && R.pos[c.glidingId].glide) continue;
      c.glidingId = null;

      if (c.idx >= c.actions.length) { c.done = true; continue; }
      const a = c.actions[c.idx++];
      const tid = a.target != null ? a.target : c.itemId;   // العنصر اللي هينفذ الأمر
      const pos = R.pos[tid];
      if (!pos) continue;
      switch (a.type) {
        case 'move': {
          const D = 130;
          const dx = a.param === 'right' ? D : a.param === 'left' ? -D : 0;
          const dy = a.param === 'up' ? -D : a.param === 'down' ? D : 0;
          pos.glide = { x: Math.max(20, Math.min(SW - 20, pos.x + dx)),
                        y: Math.max(20, Math.min(SH - 20, pos.y + dy)) };
          c.glidingId = tid;
          break;
        }
        case 'jump': {
          if (pos.glide) break;   // مينفعش ينط وهو في الهوا
          c.jumpY = pos.y;
          pos.glide = { x: pos.x, y: Math.max(20, pos.y - 130) };
          c.glidingId = tid;
          c.actions.splice(c.idx, 0, { type: '_land', target: tid });
          break;
        }
        case '_land': {
          pos.glide = { x: pos.x, y: c.jumpY != null ? c.jumpY : pos.y + 130 };
          c.glidingId = tid;
          break;
        }
        case 'talk': {
          const txt = talkText(a.param);
          const dur = Math.min(7000, Math.max(2200, txt.length * 110));
          R.bubbles.push({ itemId: tid, text: txt, until: nowMs + dur });
          if (talkVoice(a.param)) speak(txt);
          c.waitUntil = nowMs + dur;
          break;
        }
        case 'hide': R.vis[tid] = false; break;
        case 'show': R.vis[tid] = true; break;
        case 'collect':
          R.vis[tid] = false; R.score++;
          $('scoreChip').textContent = '⭐ ' + R.score;
          beep('happy');
          checkScoreRules(nowMs);
          break;
        case 'avoid': {
          const player = state.items.find(i => i.isPlayer);
          if (player) { R.pos[player.id].x = player.homeX; R.pos[player.id].y = player.homeY; }
          beep('alert');
          break;
        }
        case 'win': endGame('win', a.param); break;
        case 'lose': endGame('lose', a.param); break;
        case 'scene':
          if (a.param && a.param.bd != null) R.bd = Math.min(a.param.bd, state.backdrops.length - 1);
          else R.tint = a.param.tint === 'normal' ? null : a.param.tint;
          break;
        case 'sound': beep(a.param); break;
        case 'wait': c.waitUntil = nowMs + a.param * 1000; break;
        case 'follow': R.follows[tid] = a.param; break;
      }
    }
    R.cor = R.cor.filter(c => !c.done);
    R.bubbles = R.bubbles.filter(b => b.until > nowMs);

    // ترجرات اللمس والمكان والنقط
    for (const r of state.rules) {
      if (r.trigger.type === 'touch') {
        const a = R.pos[r.itemId], b = R.pos[r.trigger.param];
        const ia = it2(r.itemId), ib = it2(r.trigger.param);
        if (!a || !b || !R.vis[r.itemId] || !R.vis[r.trigger.param]) continue;
        if (ia.bd !== R.bd || ib.bd !== R.bd) continue;
        const touching = Math.abs(a.x - b.x) < (ia.w + ib.w) / 3 &&
                         Math.abs(a.y - b.y) < (ia.h + ib.h) / 3;
        const key = 'touch' + r.id;
        if (touching && !R.touchArmed[key]) { R.touchArmed[key] = true; fireRule(r); }
        if (!touching) R.touchArmed[key] = false;
      }
      if (r.trigger.type === 'reach' && !R.fired.has('reach' + r.id)) {
        const p = R.pos[r.itemId], pt = r.trigger.param;
        if (pt && Math.hypot(p.x - pt.x, p.y - pt.y) < 45) {
          R.fired.add('reach' + r.id); fireRule(r);
        }
      }
    }
  }

  drawStage(R);
  rafId = requestAnimationFrame(previewLoop);
}

function checkScoreRules(nowMs) {
  for (const r of state.rules)
    if (r.trigger.type === 'score' && R.score >= r.trigger.param && !R.fired.has('sc' + r.id)) {
      R.fired.add('sc' + r.id); fireRule(r);
    }
}

/* ================= 12) خطة البناء (التصدير) ================= */
$('btnExport').addEventListener('click', () => {
  if (!state.rules.length) { toast('🃏 اعمل قواعد الأول عشان نطلعلك الخطة!'); return; }
  renderPlan('scratch');
  $('exportModal').classList.add('on');
});
$('expClose').addEventListener('click', () => $('exportModal').classList.remove('on'));
$('expPrint').addEventListener('click', () => window.print());
document.querySelectorAll('.exp-tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.exp-tab').forEach(x => x.classList.remove('on'));
  t.classList.add('on');
  renderPlan(t.dataset.exp);
}));

const esc = s => String(s).replace(/</g, '&lt;');

function scratchTrigger(tr) {
  switch (tr.type) {
    case 'start': return { ev: 'عند نقر العلم الأخضر 🏳️', wrap: null };
    case 'tap': return { ev: 'عندما يُنقر هذا الكائن 👆', wrap: null };
    case 'key': return { ev: 'عند ضغط مفتاح [' + (KEY_NAMES[tr.param] || '؟') + '] ⌨️', wrap: null };
    case 'touch': {
      const t = state.items.find(i => i.id === tr.param);
      return { ev: 'عند نقر العلم الأخضر 🏳️', wrap: 'كرّر باستمرار ← إذا كان يلمس «' + (t ? t.name : '؟') + '»؟' };
    }
    case 'timer': return { ev: 'عند نقر العلم الأخضر 🏳️', wrap: 'انتظر ' + tr.param + ' ثوانٍ' };
    case 'reach': return { ev: 'عند نقر العلم الأخضر 🏳️', wrap: 'كرّر باستمرار ← إذا وصل الكائن للمكان (قارن الإحداثيات x و y)' };
    case 'score': return { ev: 'عند نقر العلم الأخضر 🏳️', wrap: 'كرّر باستمرار ← إذا كان (النقط) ≥ ' + tr.param };
  }
}
function scratchAction(a) {
  switch (a.type) {
    case 'move': return 'اتجه ناحية ' + DIRS[a.param] + ' ← بلوك «غيّر ' + (a.param === 'up' || a.param === 'down' ? 'y' : 'x') + ' بمقدار ' + ((a.param === 'left' || a.param === 'up') ? '-' : '') + '10» جوه «كرّر 13 مرة»';
    case 'talk': {
      let t = 'بلوك «قُل [' + esc(talkText(a.param)) + '] لمدة 2 ثانية»';
      if (talkVoice(a.param)) t += ' + ضيف إضافة «تحويل النص إلى كلام» 🗣️ وبلوك «انطق [' + esc(talkText(a.param)) + ']»';
      return t;
    }
    case 'hide': return 'بلوك «اختفِ»';
    case 'show': return 'بلوك «اظهر»';
    case 'jump': return 'بلوكات النط: «كرّر 10 مرات ← غيّر y بمقدار 10» وبعدها «كرّر 10 مرات ← غيّر y بمقدار -10»';
    case 'collect': return 'بلوك «اختفِ» + بلوك «غيّر (النقط) بمقدار 1»';
    case 'avoid': return 'للاعب: بلوك «اذهب إلى الموضع x .. y ..» (نقطة البداية)';
    case 'win': return 'بلوك «قُل [' + esc(a.param) + ']» + بلوك «أوقف الكل»';
    case 'lose': return 'بلوك «قُل [' + esc(a.param) + ']» + بلوك «أوقف الكل»';
    case 'scene':
      if (a.param && a.param.bd != null)
        return 'بلوك «غيّر الخلفية إلى [مشهد ' + (a.param.bd + 1) + ']» (ارفع صورة كل مشهد كـ Backdrop)';
      return 'بلوك «غيّر الخلفية إلى…» (اعمل نسخة من الخلفية بألوان ' + ({ night: 'الليل', sunset: 'الغروب', normal: 'النهار' })[a.param.tint] + ')';
    case 'sound': return 'بلوك «شغّل الصوت…»';
    case 'wait': return 'بلوك «انتظر ' + a.param + ' ثوانٍ»';
    case 'follow': {
      const t = state.items.find(i => i.id === a.param);
      return '«كرّر باستمرار» ← «اتجه نحو [' + (t ? t.name : '؟') + ']» + «تحرك 3 خطوات»';
    }
  }
}
function jrTrigger(tr) {
  switch (tr.type) {
    case 'start': return 'ابدأ بالعلم الأخضر 🏳️';
    case 'tap': return 'ابدأ عند اللمس 👆';
    case 'key': return '⚠️ جونيور مفيهوش كيبورد — استخدم «ابدأ عند اللمس 👆» ودوس على الشخصية بدل الزرار';
    case 'touch': {
      const t = state.items.find(i => i.id === tr.param);
      return 'ابدأ عند الاصطدام 💥 (لما يخبط في «' + (t ? t.name : '؟') + '»)';
    }
    case 'timer': return 'ابدأ بالعلم الأخضر 🏳️ + بلوك الانتظار ⏳ (' + tr.param + ')';
    case 'reach': return 'ابدأ بالعلم الأخضر 🏳️ (وحدد الحركة للمكان بعدد الخطوات)';
    case 'score': return '⚠️ سكراتش جونيور مفيهوش نقط — استخدم رسالة برتقالية 📨 بدلها';
  }
}
function jrAction(a) {
  switch (a.type) {
    case 'move': return 'سهم الحركة ' + ({ right: '⬅️ يمين', left: '➡️ شمال', up: '⬆️ فوق', down: '⬇️ تحت' })[a.param] + ' (عدد 4)';
    case 'talk': {
      let t = 'بلوك الكلام 💬 واكتب: «' + esc(talkText(a.param)) + '»';
      if (talkVoice(a.param)) t += ' + سجّل الجملة بصوتك في بلوك الميكروفون 🎤';
      return t;
    }
    case 'hide': return 'بلوك الاختفاء 🫥';
    case 'show': return 'بلوك الظهور ✨';
    case 'jump': return 'بلوك النط 🦘 (Hop)';
    case 'collect': return 'بلوك الاختفاء 🫥 + ابعت رسالة برتقالية 📨';
    case 'avoid': return 'للاعب: بلوك «ارجع لمكان البداية» 🏠';
    case 'win': return 'روح لصفحة النهاية السعيدة (بلوك تغيير الصفحة 📄) واكتب فيها «' + esc(a.param) + '»';
    case 'lose': return 'روح لصفحة الخسارة (بلوك تغيير الصفحة 📄) واكتب فيها «' + esc(a.param) + '»';
    case 'scene':
      if (a.param && a.param.bd != null)
        return 'بلوك تغيير الصفحة 📄 → روح لصفحة ' + (a.param.bd + 1) + ' (كل مشهد = صفحة في جونيور)';
      return 'اعمل صفحة جديدة بخلفية ' + ({ night: 'ليل', sunset: 'غروب', normal: 'نهار' })[a.param.tint] + ' + بلوك تغيير الصفحة 📄';
    case 'sound': return 'بلوك الصوت 🎤 (سجّل صوتك!)';
    case 'wait': return 'بلوك الانتظار ⏳ (' + a.param + ')';
    case 'follow': return '⚠️ مفيش "اتبع" في جونيور — استخدم أسهم الحركة ورا بعض';
  }
}

function renderPlan(kind) {
  const P = $('planBody');
  const items = state.items;
  const hasScore = state.rules.some(r => r.actions.some(a => a.type === 'collect') || r.trigger.type === 'score');
  const answered = Object.entries(state.answers).filter(([, v]) => v && v.trim());

  let html = `<h4>💡 فكرتك (${MODE_NAMES[state.mode]})</h4>`;
  if (answered.length) {
    html += '<ul>' + answered.map(([q, v]) => `<li><b>${q}</b> ${esc(v)}</li>`).join('') + '</ul>';
  } else html += '<p>— (ممكن تكتب فكرتك في تاب 💡 أفكاري)</p>';

  if (kind === 'scratch') {
    html += `<h4>🎒 التجهيزات في Scratch</h4><ul>
      <li><b>الخلفيات:</b> ${state.backdrops.length > 1
        ? 'عندك ' + state.backdrops.length + ' مشاهد — صوّر كل رسمة وارفعها كـ Backdrop لوحدها'
        : 'صوّر رسمتك وارفعها كـ Backdrop (أو ارسمها في محرر الرسم)'}</li>
      <li><b>الكائنات (Sprites):</b> ${items.map(i => '«' + esc(i.name) + '»').join('، ')} — قصّ كل واحد من الصورة وارفعه ككائن (زرار Upload Sprite)</li>
      ${hasScore ? '<li><b>المتغيرات:</b> اعمل متغير اسمه «النقط» وخليه صفر في البداية</li>' : ''}
    </ul><h4>🧱 خطوات كل كائن</h4>`;
    for (const r of state.rules) {
      const it = items.find(i => i.id === r.itemId);
      const trg = scratchTrigger(r.trigger);
      const own = r.actions.filter(a => a.target == null || a.target === r.itemId);
      const others = {};
      r.actions.filter(a => a.target != null && a.target !== r.itemId)
        .forEach(a => (others[a.target] = others[a.target] || []).push(a));
      const otherIds = Object.keys(others);
      const msgName = 'رسالة-' + esc(it.name);

      html += `<p><b>كائن «${esc(it.name)}»:</b></p><ol>
        <li>ابدأ بالحدث: <span class="blockhint">${trg.ev}</span></li>
        ${trg.wrap ? `<li>حطّ جواه: <span class="blockhint">${trg.wrap}</span></li>` : ''}
        ${own.map(a => `<li><span class="blockhint">${scratchAction(a)}</span></li>`).join('')}
        ${otherIds.length ? `<li><span class="blockhint">بلوك «بث رسالة [${msgName}]» 📨 — عشان توصّل للكائنات التانية</span></li>` : ''}
      </ol>`;
      for (const tidStr of otherIds) {
        const other = items.find(i => i.id === +tidStr);
        html += `<p style="margin-right:18px">↳ <b>وفي كائن «${esc(other.name)}»:</b></p><ol style="margin-right:18px">
          <li>ابدأ بالحدث: <span class="blockhint">عندما أتلقى [${msgName}] 📨</span></li>
          ${others[tidStr].map(a => `<li><span class="blockhint">${scratchAction(a)}</span></li>`).join('')}
        </ol>`;
      }
    }
    html += `<h4>✅ جرّب!</h4><p>دوس العلم الأخضر وشوف فكرتك اشتغلت زي التجربة هنا ولا لأ 😄</p>`;
  } else {
    const needsPages = state.rules.some(r => r.actions.some(a => ['win', 'lose', 'scene'].includes(a.type)));
    html += `<h4>🎒 التجهيزات في Scratch Jr</h4><ul>
      <li><b>الصفحات:</b> ${state.backdrops.length > 1
        ? state.backdrops.length + ' صفحات — صفحة لكل مشهد من رسماتك'
        : 'صفحة المشهد الرئيسي'}${needsPages ? ' + صفحات النهاية' : ''}</li>
      <li><b>الخلفيات:</b> صوّر كل رسمة بالكاميرا جوه Scratch Jr وحطها خلفية صفحتها 📷</li>
      <li><b>الشخصيات:</b> ${items.map(i => '«' + esc(i.name) + '»').join('، ')} — ارسم كل واحدة أو صوّرها بالكاميرا</li>
    </ul><h4>🧱 خطوات كل شخصية</h4>`;
    for (const r of state.rules) {
      const it = items.find(i => i.id === r.itemId);
      const own = r.actions.filter(a => a.target == null || a.target === r.itemId);
      const others = {};
      r.actions.filter(a => a.target != null && a.target !== r.itemId)
        .forEach(a => (others[a.target] = others[a.target] || []).push(a));
      const otherIds = Object.keys(others);

      html += `<p><b>شخصية «${esc(it.name)}»:</b></p><ol>
        <li>${jrTrigger(r.trigger)}</li>
        ${own.map(a => `<li>${jrAction(a)}</li>`).join('')}
        ${otherIds.length ? '<li>في الآخر: ابعت رسالة برتقالية 📨 (بلوك الظرف البرتقالي)</li>' : ''}
      </ol>`;
      for (const tidStr of otherIds) {
        const other = items.find(i => i.id === +tidStr);
        html += `<p style="margin-right:18px">↳ <b>وفي شخصية «${esc(other.name)}»:</b></p><ol style="margin-right:18px">
          <li>ابدأ عند استلام الرسالة البرتقالية 📨</li>
          ${others[tidStr].map(a => `<li>${jrAction(a)}</li>`).join('')}
        </ol>`;
      }
    }
    html += `<h4>✅ جرّب!</h4><p>دوس العلم الأخضر في Scratch Jr وقارن بفكرتك هنا 😄</p>`;
  }
  P.innerHTML = html;
}

/* ================= تشغيل أولي ================= */
drawStage();
