/**
 * APP.JS - Главный контроллер
 * Исправлено: загрузка файла, камера, съёмка
 */

const App = (() => {

  // ===== СОСТОЯНИЕ =====
  const S = {
    imageData: null,
    originalCanvas: null,
    mask: null,
    depthMap: null,
    meshData: null,
    textureData: null,
    processing: false,
    // Камера
    camStream: null,
    camFacing: 'environment',
    camTimerSec: 0,
    camTimerTick: null,
    currentZoom: 1
  };

  // ===== TOAST =====
  window.showToast = (msg, type = 'info', dur = 3000) => {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(t._t);
    t._t = setTimeout(() => t.className = 'toast', dur);
  };

  // ===== НАВИГАЦИЯ =====
  function goTo(id) {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active');
      s.style.display = 'none';
    });
    const sc = document.getElementById(`screen-${id}`);
    if (!sc) return;
    sc.style.display = 'flex';
    // Небольшая задержка для анимации
    requestAnimationFrame(() => {
      requestAnimationFrame(() => sc.classList.add('active'));
    });
  }

  // ===== SLEEP =====
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ===== ИНИЦИАЛИЗАЦИЯ =====
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 AI 3D Creator');

    // Стартовый экран сразу видим
    const uploadScreen = document.getElementById('screen-upload');
    if (uploadScreen) {
      uploadScreen.style.display = 'flex';
      uploadScreen.classList.add('active');
    }

    initUploadButtons();
    initCameraScreen();
    initResultButtons();
    initNeuralBg();
    initSlider();
  });

  // ===== КНОПКИ ЗАГРУЗКИ =====
  function initUploadButtons() {

    // --- КНОПКА КАМЕРЫ ---
    const btnCamera = document.getElementById('btn-open-camera');
    btnCamera?.addEventListener('click', openCamera);

    // --- КНОПКА ГАЛЕРЕИ ---
    const btnUpload = document.getElementById('btn-open-upload');
    btnUpload?.addEventListener('click', () => {
      triggerFileInput();
    });

    // --- FILE INPUT (создаём динамически чтобы гарантировать работу) ---
    setupFileInput();

    // --- ПРИМЕРЫ ---
    document.querySelectorAll('.ex-btn').forEach(b => {
      b.addEventListener('click', () => loadExample(b.dataset.example));
    });

    // --- ОЧИСТИТЬ ФОТО ---
    document.getElementById('btn-clear-photo')?.addEventListener('click', clearPhoto);

    // --- СОЗДАТЬ 3D ---
    document.getElementById('btn-create')?.addEventListener('click', startCreating);

    // --- СЛАЙДЕР ---
    document.getElementById('detail-level')?.addEventListener('input', e => {
      const v = document.getElementById('detail-val');
      if (v) v.textContent = e.target.value;
    });
  }

  // ===== FILE INPUT =====
  function setupFileInput() {
    // Удалить старый если есть
    let old = document.getElementById('file-input');
    if (old) old.remove();

    // Создать новый
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'file-input';
    input.accept = 'image/*';
    input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;width:1px;height:1px';
    document.body.appendChild(input);

    input.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) {
        loadPhotoFile(file);
      }
      // Сбросить input чтобы можно было выбрать тот же файл повторно
      input.value = '';
    });
  }

  function triggerFileInput() {
    const input = document.getElementById('file-input');
    if (input) {
      input.click();
    } else {
      setupFileInput();
      setTimeout(() => document.getElementById('file-input')?.click(), 50);
    }
  }

  // ===== ЗАГРУЗКА ФАЙЛА =====
  async function loadPhotoFile(file) {
    if (!file) return;

    // Проверка типа
    if (!file.type.startsWith('image/')) {
      showToast('Выберите изображение (JPG, PNG, WEBP)', 'err');
      return;
    }

    // Проверка размера
    if (file.size > 25 * 1024 * 1024) {
      showToast('Файл слишком большой. Максимум 25 МБ', 'err');
      return;
    }

    showToast('Загрузка...', 'info', 1500);

    try {
      const dataURL = await readFileAsDataURL(file);
      const img = await loadImage(dataURL);
      await processImage(img);
    } catch (err) {
      console.error('Ошибка загрузки файла:', err);
      showToast('Ошибка загрузки файла', 'err');
    }
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ===== ОБРАБОТАТЬ ИЗОБРАЖЕНИЕ =====
  async function processImage(img) {
    // Ограничить размер
    const MAX = 800;
    let { naturalWidth: w, naturalHeight: h } = img;
    if (!w) { w = img.width; h = img.height; }

    if (Math.max(w, h) > MAX) {
      const scale = MAX / Math.max(w, h);
      w = Math.floor(w * scale);
      h = Math.floor(h * scale);
    }

    // Нарисовать на canvas
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    S.imageData = ctx.getImageData(0, 0, w, h);
    S.originalCanvas = canvas;

    // Показать превью
    showPreview(canvas.toDataURL(), `${w}×${h}px`);
    showToast('Фото загружено ✓', 'ok');
  }

  function showPreview(src, info) {
    const preview = document.getElementById('photo-preview');
    const previewSection = document.getElementById('preview-section');
    const badge = document.getElementById('preview-badge');
    const examplesBlock = document.getElementById('examples-block');
    const mainActions = document.querySelector('.main-actions');

    if (preview) preview.src = src;
    if (previewSection) previewSection.style.display = '';
    if (badge) badge.textContent = info || 'Готово к обработке';
    if (examplesBlock) examplesBlock.style.display = 'none';
    if (mainActions) mainActions.style.display = 'none';
  }

  function clearPhoto() {
    S.imageData = null;
    S.originalCanvas = null;

    const previewSection = document.getElementById('preview-section');
    const examplesBlock = document.getElementById('examples-block');
    const mainActions = document.querySelector('.main-actions');
    const preview = document.getElementById('photo-preview');

    if (previewSection) previewSection.style.display = 'none';
    if (examplesBlock) examplesBlock.style.display = '';
    if (mainActions) mainActions.style.display = '';
    if (preview) preview.src = '';
  }

  // ===== ПРИМЕРЫ =====
  async function loadExample(type) {
    showToast('Генерация примера...', 'info', 1500);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    switch (type) {
      case 'cup':    drawCup(ctx, 400, 400);    break;
      case 'bottle': drawBottle(ctx, 400, 400); break;
      case 'toy':    drawToy(ctx, 400, 400);    break;
      case 'shoe':   drawShoe(ctx, 400, 400);   break;
    }

    const img = await loadImage(canvas.toDataURL());
    await processImage(img);
  }

  // Рисование примеров
  function drawCup(ctx, w, h) {
    ctx.fillStyle = '#e8ddd0'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath(); ctx.ellipse(w/2, h*0.84, 75, 14, 0, 0, Math.PI*2); ctx.fill();
    const g = ctx.createLinearGradient(w*0.22, 0, w*0.78, 0);
    g.addColorStop(0, '#b03020'); g.addColorStop(0.35, '#e04030'); g.addColorStop(0.7, '#b03020'); g.addColorStop(1, '#8a2010');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w*0.26, h*0.24); ctx.lineTo(w*0.74, h*0.24);
    ctx.lineTo(w*0.69, h*0.79); ctx.lineTo(w*0.31, h*0.79);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b03020';
    ctx.beginPath(); ctx.ellipse(w/2, h*0.24, w*0.24, h*0.04, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#8a2010'; ctx.lineWidth = 11; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(w*0.79, h*0.5, h*0.11, Math.PI*0.25, Math.PI*1.75); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.ellipse(w*0.38, h*0.41, 10, 48, Math.PI*0.1, 0, Math.PI*2); ctx.fill();
  }

  function drawBottle(ctx, w, h) {
    ctx.fillStyle = '#d0e8e0'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    ctx.beginPath(); ctx.ellipse(w/2, h*0.89, 58, 11, 0, 0, Math.PI*2); ctx.fill();
    const g = ctx.createLinearGradient(w*0.26, 0, w*0.74, 0);
    g.addColorStop(0, '#164080'); g.addColorStop(0.3, '#2060c0'); g.addColorStop(0.7, '#164080'); g.addColorStop(1, '#103060');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w*0.31, h*0.34); ctx.lineTo(w*0.69, h*0.34);
    ctx.lineTo(w*0.71, h*0.84); ctx.lineTo(w*0.29, h*0.84);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#164080';
    ctx.fillRect(w*0.43, h*0.11, w*0.14, h*0.25);
    ctx.fillStyle = '#e09020'; ctx.fillRect(w*0.42, h*0.07, w*0.16, h*0.06);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.ellipse(w*0.38, h*0.55, 7, 55, 0, 0, Math.PI*2); ctx.fill();
  }

  function drawToy(ctx, w, h) {
    ctx.fillStyle = '#f0e4d0'; ctx.fillRect(0, 0, w, h);
    const brown = '#d4893a';
    ctx.fillStyle = brown;
    ctx.beginPath(); ctx.ellipse(w/2, h*0.6, w*0.22, h*0.24, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w/2, h*0.32, w*0.18, h*0.18, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w*0.365, h*0.19, w*0.07, h*0.07, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w*0.635, h*0.19, w*0.07, h*0.07, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#c07830';
    ctx.beginPath(); ctx.ellipse(w/2, h*0.36, w*0.09, h*0.07, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.ellipse(w*0.44, h*0.29, 5, 5.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w*0.56, h*0.29, 5, 5.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.ellipse(w*0.455, h*0.285, 2, 2.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w*0.575, h*0.285, 2, 2.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.ellipse(w/2, h*0.335, 5.5, 4, 0, 0, Math.PI*2); ctx.fill();
  }

  function drawShoe(ctx, w, h) {
    ctx.fillStyle = '#ebebeb'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.09)';
    ctx.beginPath(); ctx.ellipse(w*0.52, h*0.77, w*0.3, h*0.055, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#f5f5f5';
    ctx.beginPath();
    ctx.moveTo(w*0.14, h*0.69); ctx.lineTo(w*0.86, h*0.69);
    ctx.lineTo(w*0.88, h*0.75); ctx.lineTo(w*0.12, h*0.75);
    ctx.closePath(); ctx.fill();
    const g = ctx.createLinearGradient(w*0.1, h*0.35, w*0.9, h*0.7);
    g.addColorStop(0, '#d03030'); g.addColorStop(1, '#a02020');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w*0.14, h*0.69); ctx.lineTo(w*0.86, h*0.69);
    ctx.lineTo(w*0.8, h*0.44);
    ctx.quadraticCurveTo(w*0.6, h*0.29, w*0.34, h*0.38);
    ctx.lineTo(w*0.17, h*0.54); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(w*(0.38+i*0.07), h*0.52);
      ctx.lineTo(w*(0.44+i*0.07), h*0.5);
      ctx.stroke();
    }
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.ellipse(w*0.23, h*0.6, w*0.06, h*0.045, Math.PI*0.2, 0, Math.PI*2); ctx.fill();
  }

  // ===== КАМЕРА =====
  async function openCamera() {
    goTo('camera');
    await startCamera();
  }

  function initCameraScreen() {
    // Закрыть
    document.getElementById('btn-cam-close')?.addEventListener('click', closeCamera);

    // Перевернуть
    document.getElementById('btn-cam-flip')?.addEventListener('click', flipCamera);

    // Съёмка
    document.getElementById('btn-shoot')?.addEventListener('click', shoot);

    // Таймер
    document.getElementById('btn-timer')?.addEventListener('click', cycleTimer);

    // Зум
    document.getElementById('btn-zoom-1')?.addEventListener('click', () => setZoom(1));
    document.getElementById('btn-zoom-2')?.addEventListener('click', () => setZoom(2));
  }

  async function startCamera() {
    const video = document.getElementById('cam-video');
    const statusText = document.getElementById('cam-status-text');

    if (statusText) statusText.textContent = 'Запрос доступа...';

    try {
      // Остановить предыдущий поток
      if (S.camStream) {
        S.camStream.getTracks().forEach(t => t.stop());
        S.camStream = null;
      }

      const constraints = {
        video: {
          facingMode: { ideal: S.camFacing },
          width:  { ideal: 1280, min: 480 },
          height: { ideal: 720,  min: 360 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      S.camStream = stream;

      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      if (statusText) statusText.textContent = 'Камера готова';
      showToast('Камера готова ✓', 'ok');

    } catch (err) {
      console.error('Камера:', err);
      let msg = 'Нет доступа к камере';
      if (err.name === 'NotAllowedError') msg = 'Разрешите доступ к камере';
      if (err.name === 'NotFoundError')   msg = 'Камера не найдена';
      if (err.name === 'NotReadableError') msg = 'Камера занята другим приложением';

      if (statusText) statusText.textContent = msg;
      showToast(msg, 'err', 4000);

      // Через 2 секунды вернуться назад
      setTimeout(() => { closeCamera(); }, 2500);
    }
  }

  function closeCamera() {
    if (S.camStream) {
      S.camStream.getTracks().forEach(t => t.stop());
      S.camStream = null;
    }
    clearTimerCountdown();
    goTo('upload');
  }

  async function flipCamera() {
    S.camFacing = S.camFacing === 'environment' ? 'user' : 'environment';
    await startCamera();
    showToast(S.camFacing === 'environment' ? 'Задняя камера' : 'Фронтальная камера', 'info');
  }

  function setZoom(level) {
    S.currentZoom = level;
    document.querySelectorAll('.zoom-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-zoom-${level}`)?.classList.add('active');

    // Реальный зум через track constraints
    if (S.camStream) {
      const track = S.camStream.getVideoTracks()[0];
      if (track && track.getCapabilities) {
        const caps = track.getCapabilities();
        if (caps.zoom) {
          const minZ = caps.zoom.min;
          const maxZ = caps.zoom.max;
          const targetZ = minZ + (maxZ - minZ) * (level - 1) / 3;
          track.applyConstraints({ advanced: [{ zoom: targetZ }] }).catch(() => {});
        }
      }
    }

    // CSS зум как запасной вариант
    const video = document.getElementById('cam-video');
    if (video) {
      video.style.transform = level > 1 ? `scale(${level})` : '';
    }
  }

  function cycleTimer() {
    const steps = [0, 3, 5, 10];
    const labels = ['Без', '3с', '5с', '10с'];
    const idx = steps.indexOf(S.camTimerSec);
    const next = (idx + 1) % steps.length;
    S.camTimerSec = steps[next];

    const label = document.getElementById('timer-label');
    const btn = document.getElementById('btn-timer');
    if (label) label.textContent = labels[next];
    if (btn) btn.classList.toggle('active-timer', S.camTimerSec > 0);

    showToast(S.camTimerSec > 0 ? `Таймер: ${S.camTimerSec} секунд` : 'Таймер выключен', 'info');
  }

  async function shoot() {
    if (S.camTimerSec > 0) {
      await runTimerCountdown(S.camTimerSec);
    }
    capturePhoto();
  }

  async function runTimerCountdown(seconds) {
    const timerEl = document.getElementById('cam-timer');
    const numEl   = document.getElementById('cam-timer-num');
    if (timerEl) timerEl.style.display = '';

    for (let i = seconds; i > 0; i--) {
      if (numEl) {
        numEl.textContent = i;
        numEl.style.animation = 'none';
        numEl.offsetHeight; // reflow
        numEl.style.animation = '';
      }
      await sleep(1000);
    }

    if (timerEl) timerEl.style.display = 'none';
  }

  function clearTimerCountdown() {
    const timerEl = document.getElementById('cam-timer');
    if (timerEl) timerEl.style.display = 'none';
    clearInterval(S.camTimerTick);
  }

  function capturePhoto() {
    const video  = document.getElementById('cam-video');
    const canvas = document.getElementById('cam-capture-canvas');

    if (!video || !canvas || !S.camStream) {
      showToast('Камера не готова', 'err'); return;
    }

    const vw = video.videoWidth  || 640;
    const vh = video.videoHeight || 480;

    canvas.width  = vw;
    canvas.height = vh;

    const ctx = canvas.getContext('2d');

    // Если фронтальная — зеркально
    if (S.camFacing === 'user') {
      ctx.translate(vw, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, vw, vh);

    // Показать вспышку
    flashEffect();

    // Превью последнего фото в UI камеры
    const lastPhotoEl = document.getElementById('cam-last-photo');
    if (lastPhotoEl) {
      lastPhotoEl.innerHTML = `<img src="${canvas.toDataURL('image/jpeg', 0.5)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">`;
      lastPhotoEl.style.opacity = '1';
    }

    // Конвертировать в imageData
    const imageData = ctx.getImageData(0, 0, vw, vh);
    S.imageData = imageData;
    S.originalCanvas = canvas.cloneNode();
    S.originalCanvas.width = vw;
    S.originalCanvas.height = vh;
    S.originalCanvas.getContext('2d').putImageData(imageData, 0, 0);

    showToast('Фото сделано ✓', 'ok');

    // Закрыть камеру и показать превью
    setTimeout(() => {
      closeCamera();
      showPreview(
        S.originalCanvas.toDataURL('image/jpeg', 0.85),
        `${vw}×${vh}px · Камера`
      );
    }, 400);
  }

  function flashEffect() {
    const viewport = document.querySelector('.cam-viewport');
    if (!viewport) return;
    const flash = document.createElement('div');
    flash.style.cssText = `
      position:absolute;inset:0;background:white;opacity:0.7;
      pointer-events:none;z-index:100;border-radius:0;
      animation:flashOut .25s ease forwards
    `;
    const style = document.createElement('style');
    style.textContent = '@keyframes flashOut{to{opacity:0}}';
    document.head.appendChild(style);
    viewport.appendChild(flash);
    setTimeout(() => {
      flash.remove();
      style.remove();
    }, 300);
  }

  // ===== СЛАЙДЕР =====
  function initSlider() {
    const slider = document.getElementById('detail-level');
    const val    = document.getElementById('detail-val');
    if (slider && val) {
      slider.addEventListener('input', () => { val.textContent = slider.value; });
    }
  }

  // ===== СОЗДАНИЕ 3D =====
  async function startCreating() {
    if (!S.imageData) {
      showToast('Сначала сделайте или загрузите фото', 'err');
      return;
    }
    if (S.processing) return;
    S.processing = true;

    const quality   = document.getElementById('quality-select')?.value || 'medium';
    const texMode   = document.getElementById('texture-mode')?.value || 'photo';
    const detailLvl = parseInt(document.getElementById('detail-level')?.value || '3');
    const doSmooth  = document.getElementById('opt-smooth')?.checked ?? true;
    const closeBot  = document.getElementById('opt-close-bottom')?.checked ?? true;
    const objType   = document.getElementById('object-type')?.value || 'auto';

    goTo('process');

    // Показать фото в процессе
    const procImg = document.getElementById('proc-image');
    if (procImg && S.originalCanvas) {
      procImg.src = S.originalCanvas.toDataURL('image/jpeg', 0.8);
    }

    // Сканирующий луч
    const beam = document.getElementById('proc-beam');
    if (beam) { beam.style.display = 'block'; animateBeam(beam); }

    // Сбросить стадии
    for (let i = 1; i <= 5; i++) resetStage(i);

    try {

      // === 1: Анализ ===
      setStage(1, 'active', 'Анализ структуры...');
      await animFill(1, 0, 100, 700);
      setStage(1, 'done', 'Готово ✓');
      setProgress(15, 'Анализ завершён');

      // === 2: Сегментация ===
      setStage(2, 'active', 'Поиск объекта...');
      const seg = await Segmentation.segment(S.imageData, {
        onProgress: (p, msg) => {
          setFill(2, p);
          setDetail(2, msg);
          setProgress(15 + p * 0.15, msg);
        }
      });
      S.mask = seg.mask;

      // Показать маску
      const maskCv = document.getElementById('res-mask');
      if (maskCv) Segmentation.drawMaskOnCanvas(maskCv, seg.mask, S.imageData.width, S.imageData.height);

      drawOverlay(seg.mask, S.imageData.width, S.imageData.height);
      setStage(2, 'done', `${seg.bbox.w}×${seg.bbox.h}px`);
      setProgress(32, 'Объект найден');

      // === 3: Глубина ===
      setStage(3, 'active', 'Оценка глубины...');
      const depth = await DepthEstimator.estimate(S.imageData, S.mask, {
        objectType: objType,
        onProgress: (p, msg) => {
          setFill(3, p);
          setDetail(3, msg);
          setProgress(32 + p * 0.15, msg);
        }
      });
      S.depthMap = depth;

      const depthCv = document.getElementById('res-depth');
      if (depthCv) DepthEstimator.drawDepthOnCanvas(depthCv, depth, S.imageData.width, S.imageData.height);

      setStage(3, 'done', 'Карта готова ✓');
      setProgress(48, 'Глубина оценена');

      // === 4: Сетка ===
      setStage(4, 'active', 'Построение геометрии...');
      const mesh = await MeshBuilder.build(S.imageData, S.mask, S.depthMap, {
        qualityPreset: quality,
        detailLevel: detailLvl,
        smoothing: doSmooth,
        closeBottom: closeBot,
        onProgress: (p, msg) => {
          setFill(4, p);
          setDetail(4, msg);
          setProgress(48 + p * 0.25, msg);
        }
      });
      S.meshData = mesh;
      setStage(4, 'done', `${(mesh.vertices.length/3).toLocaleString()} вершин`);
      setProgress(75, 'Геометрия готова');

      // === 5: Текстура ===
      setStage(5, 'active', 'Наложение текстуры...');
      const tex = await TextureMapper.createTexture(S.imageData, S.mask, mesh, {
        textureMode: texMode,
        onProgress: (p, msg) => {
          setFill(5, p);
          setDetail(5, msg);
          setProgress(75 + p * 0.22, msg);
        }
      });
      S.textureData = tex;
      setStage(5, 'done', 'Текстура готова ✓');
      setProgress(100, '🎉 3D модель готова!');

      if (beam) beam.style.display = 'none';

      await sleep(700);
      showResult();

    } catch (err) {
      console.error('Ошибка 3D:', err);
      showToast('Ошибка: ' + err.message, 'err', 5000);
      goTo('upload');
      S.processing = false;
    }
  }

  // ===== ПОКАЗАТЬ РЕЗУЛЬТАТ =====
  function showResult() {
    goTo('result');
    S.processing = false;

    const canvas = document.getElementById('viewer-canvas');
    if (canvas && !Viewer3D.isReady) {
      Viewer3D.init(canvas);
    }

    Viewer3D.displayModel(S.meshData, S.textureData);

    // Исходное фото
    const srcEl = document.getElementById('res-src');
    if (srcEl && S.originalCanvas) {
      srcEl.src = S.originalCanvas.toDataURL('image/jpeg', 0.8);
    }

    // Статистика
    const v = S.meshData.vertices.length / 3;
    const f = S.meshData.faces.length;
    const statsEl = document.getElementById('model-stats-label');
    if (statsEl) statsEl.textContent = `${v.toLocaleString()} вершин · ${f.toLocaleString()} граней`;

    const svV = document.getElementById('sv-v');
    const svF = document.getElementById('sv-f');
    if (svV) svV.textContent = v.toLocaleString();
    if (svF) svF.textContent = f.toLocaleString();

    showToast('🎉 3D модель готова!', 'ok', 4000);
  }

  // ===== КНОПКИ РЕЗУЛЬТАТА =====
  function initResultButtons() {
    // Режимы
    const modes = { 'vm-tex':'textured', 'vm-solid':'solid', 'vm-wire':'wireframe', 'vm-depth':'depth' };
    Object.entries(modes).forEach(([id, mode]) => {
      document.getElementById(id)?.addEventListener('click', function() {
        document.querySelectorAll('.vm-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        Viewer3D.setMode(mode);
      });
    });

    // Контролы
    document.getElementById('vb-rotate')?.addEventListener('click', function() {
      const on = Viewer3D.toggleAutoRotate();
      this.classList.toggle('on', on);
    });
    document.getElementById('vb-reset')?.addEventListener('click', () => Viewer3D.resetView());
    document.getElementById('vb-zi')?.addEventListener('click', () => Viewer3D.zoomIn());
    document.getElementById('vb-zo')?.addEventListener('click', () => Viewer3D.zoomOut());

    // Назад
    document.getElementById('btn-back-result')?.addEventListener('click', () => {
      goTo('upload');
    });

    document.getElementById('btn-new-photo')?.addEventListener('click', () => {
      clearPhoto();
      goTo('upload');
    });

    document.getElementById('btn-export-all')?.addEventListener('click', exportAll);

    // G-CODE
    document.getElementById('gm-cancel')?.addEventListener('click', () => {
      document.getElementById('gcode-modal').style.display = 'none';
    });
    document.getElementById('gm-ok')?.addEventListener('click', () => {
      const s = {
        layerHeight: parseFloat(document.getElementById('gc-layer')?.value || '0.2'),
        printSpeed:  parseInt(document.getElementById('gc-speed')?.value  || '60'),
        nozzleTemp:  parseInt(document.getElementById('gc-nozzle')?.value || '210'),
        bedTemp:     parseInt(document.getElementById('gc-bed')?.value    || '60'),
        infill:      parseInt(document.getElementById('gc-infill')?.value || '20'),
        nozzleSize:  parseFloat(document.getElementById('gc-nozzle-size')?.value || '0.4')
      };
      document.getElementById('gcode-modal').style.display = 'none';
      Exporter.exportGCODE(S.meshData, s);
    });
  }

  // ===== ЭКСПОРТ =====
  function exportFn(format) {
    if (!S.meshData) { showToast('Модель не готова', 'err'); return; }
    switch (format) {
      case 'stl':         Exporter.exportSTL(S.meshData); break;
      case 'obj':         Exporter.exportOBJ(S.meshData, S.textureData); break;
      case 'gltf':        Exporter.exportGLTF(S.meshData, S.textureData); break;
      case 'ply':         Exporter.exportPLY(S.meshData); break;
      case 'png-texture': Exporter.exportTexturePNG(S.textureData); break;
      case 'gcode':
        document.getElementById('gcode-modal').style.display = 'flex';
        break;
    }
  }

  async function exportAll() {
    if (!S.meshData) return;
    showToast('Скачивание файлов...', 'info', 5000);
    const formats = ['stl','obj','ply','gltf','png-texture'];
    for (let i = 0; i < formats.length; i++) {
      await sleep(i * 700);
      exportFn(formats[i]);
    }
  }

  // ===== ОВЕРЛЕЙ МАСКИ =====
  function drawOverlay(mask, mw, mh) {
    const cv = document.getElementById('proc-overlay');
    if (!cv) return;
    const parent = cv.parentElement;
    cv.width  = parent?.clientWidth  || 160;
    cv.height = parent?.clientHeight || 160;
    const ctx = cv.getContext('2d');
    const sx = cv.width / mw, sy = cv.height / mh;
    const img = ctx.createImageData(cv.width, cv.height);
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const pi = Math.min(mh-1, Math.floor(y/sy))*mw + Math.min(mw-1, Math.floor(x/sx));
        const ii = (y*cv.width+x)*4;
        if (mask[pi] === 1) {
          img.data[ii]=0; img.data[ii+1]=245; img.data[ii+2]=255; img.data[ii+3]=55;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ===== NEURAL BG =====
  function initNeuralBg() {
    const cv = document.getElementById('neural-canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const nodes = Array.from({length:35}, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random()-.5)*.0004,
      vy: (Math.random()-.5)*.0004,
      r: Math.random()*2.5+1
    }));

    const resize = () => {
      cv.width  = cv.parentElement?.clientWidth  || window.innerWidth;
      cv.height = cv.parentElement?.clientHeight || window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    function draw() {
      const { width: w, height: h } = cv;
      ctx.clearRect(0, 0, w, h);
      nodes.forEach(n => {
        n.x += n.vx; n.y += n.vy;
        if (n.x<0||n.x>1) n.vx*=-1;
        if (n.y<0||n.y>1) n.vy*=-1;
      });
      for (let i=0;i<nodes.length;i++) {
        for (let j=i+1;j<nodes.length;j++) {
          const dx=nodes[i].x-nodes[j].x, dy=nodes[i].y-nodes[j].y;
          const d=Math.sqrt(dx*dx+dy*dy);
          if (d<.18) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x*w, nodes[i].y*h);
            ctx.lineTo(nodes[j].x*w, nodes[j].y*h);
            ctx.strokeStyle=`rgba(0,245,255,${(1-d/.18)*.12})`;
            ctx.lineWidth=1; ctx.stroke();
          }
        }
      }
      nodes.forEach(n => {
        ctx.beginPath();
        ctx.arc(n.x*w, n.y*h, n.r, 0, Math.PI*2);
        ctx.fillStyle='rgba(0,245,255,0.35)';
        ctx.fill();
      });
      requestAnimationFrame(draw);
    }
    draw();
  }

  // ===== ЛУЧ СКАНИРОВАНИЯ =====
  function animateBeam(el) {
    let pos=0, dir=1;
    function step() {
      if (el.style.display==='none') return;
      pos += dir*1.5;
      if (pos>100||pos<0) dir*=-1;
      el.style.top=pos+'%';
      requestAnimationFrame(step);
    }
    step();
  }

  // ===== УТИЛИТЫ СТАДИЙ =====
  function resetStage(n) {
    const el = document.getElementById(`ps-${n}`);
    const ck = document.getElementById(`pc-${n}`);
    const fl = document.getElementById(`pf-${n}`);
    const dt = document.getElementById(`pd-${n}`);
    if (el) el.className='ps-item';
    if (ck) ck.textContent='○';
    if (fl) fl.style.width='0%';
    if (dt) dt.textContent='Ожидание...';
  }

  function setStage(n, status, detail) {
    const el = document.getElementById(`ps-${n}`);
    const ck = document.getElementById(`pc-${n}`);
    if (el) el.className=`ps-item ${status}`;
    if (ck) ck.textContent = status==='done'?'✅':status==='active'?'⚡':'○';
    if (detail) setDetail(n, detail);
  }

  function setFill(n, p) {
    const el = document.getElementById(`pf-${n}`);
    if (el) el.style.width=p+'%';
  }

  function setDetail(n, txt) {
    const el = document.getElementById(`pd-${n}`);
    if (el) el.textContent=txt;
  }

  async function animFill(n, from, to, dur) {
    const start=performance.now();
    return new Promise(res=>{
      function step(){
        const t=Math.min(1,(performance.now()-start)/dur);
        setFill(n, from+(to-from)*t);
        if(t<1) requestAnimationFrame(step); else res();
      }
      requestAnimationFrame(step);
    });
  }

  function setProgress(pct, text) {
    const fill = document.getElementById('main-prog-fill');
    const txt  = document.getElementById('main-prog-text');
    const pctEl= document.getElementById('main-prog-pct');
    if (fill) fill.style.width = Math.round(pct)+'%';
    if (txt)  txt.textContent  = text||'';
    if (pctEl) pctEl.textContent = Math.round(pct)+'%';
  }

  // Публичный API
  return { export: exportFn };

})();
