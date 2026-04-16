/**
 * APP.JS — Главный контроллер
 * Соединяет все модули в единый пайплайн
 */

const App = (() => {
  // Глобальное состояние
  const state = {
    imageData: null,      // ImageData оригинала
    originalCanvas: null, // Canvas с исходным фото
    mask: null,           // Uint8Array маски
    depthMap: null,       // Float32Array глубины
    meshData: null,       // { vertices, faces, normals, uvs, ... }
    textureData: null,    // { canvas, imageData, dataURL }
    isProcessing: false
  };

  // ===== TOAST =====
  window.showToast = function(msg, type='info', dur=3000) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), dur);
  };

  // ===== ЭКРАНЫ =====
  function goTo(id) {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active');
      s.style.display = 'none';
    });
    const sc = document.getElementById(`screen-${id}`);
    if (sc) { sc.style.display = 'flex'; requestAnimationFrame(() => sc.classList.add('active')); }
  }

  // ===== INIT =====
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 AI 3D Creator запущен');
    initUploadScreen();
    initNeuralCanvas();
  });

  // ===== ЗАГРУЗОЧНЫЙ ЭКРАН =====
  function initUploadScreen() {
    const zone   = document.getElementById('upload-zone');
    const input  = document.getElementById('file-input');
    const trigger= document.getElementById('upload-trigger');
    const btn    = document.getElementById('btn-create');
    const detailSlider = document.getElementById('detail-level');
    const detailVal    = document.getElementById('detail-val');

    // Клик на зону
    trigger.addEventListener('click', () => input.click());
    zone.addEventListener('click', e => { if(e.target===zone) input.click(); });

    // Drag & Drop
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) loadPhoto(file);
    });

    // Выбор файла
    input.addEventListener('change', e => {
      if (e.target.files[0]) loadPhoto(e.target.files[0]);
    });

    // Сменить фото
    document.getElementById('btn-change-photo')?.addEventListener('click', () => {
      clearPhoto();
    });

    // Слайдер детализации
    detailSlider?.addEventListener('input', e => {
      detailVal.textContent = e.target.value;
    });

    // Создать 3D
    btn?.addEventListener('click', startCreating);

    // Примеры
    document.querySelectorAll('.example-btn').forEach(b => {
      b.addEventListener('click', () => loadExample(b.dataset.example));
    });
  }

  // ===== ЗАГРУЗИТЬ ФОТО =====
  async function loadPhoto(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Выберите изображение', 'err'); return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showToast('Файл слишком большой (макс 20МБ)', 'err'); return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const img = new Image();
      img.onload = async () => {
        await processLoadedImage(img, file.name);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function processLoadedImage(img, name='image') {
    // Ограничить размер для производительности
    const MAX_DIM = 800;
    let { width, height } = img;
    if (Math.max(width, height) > MAX_DIM) {
      const scale = MAX_DIM / Math.max(width, height);
      width  = Math.floor(width * scale);
      height = Math.floor(height * scale);
    }

    // Нарисовать на canvas
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    state.imageData     = imageData;
    state.originalCanvas = canvas;

    // Показать превью
    const preview = document.getElementById('photo-preview');
    const previewCont = document.getElementById('photo-preview-container');
    const uploadZone   = document.getElementById('upload-zone');
    const aiSettings   = document.getElementById('ai-settings');
    const createBtn    = document.getElementById('btn-create');
    const photoInfo    = document.getElementById('photo-info');

    if (preview) {
      preview.src = canvas.toDataURL();
      previewCont.style.display = '';
      uploadZone.style.display  = 'none';
    }

    if (photoInfo) {
      photoInfo.textContent = `${width}×${height}px · ${name}`;
    }

    if (aiSettings) aiSettings.style.display = '';
    if (createBtn) createBtn.style.display = '';

    showToast('Фото загружено ✓', 'ok');
  }

  function clearPhoto() {
    state.imageData = null;
    state.originalCanvas = null;

    document.getElementById('photo-preview-container').style.display = 'none';
    document.getElementById('upload-zone').style.display = '';
    document.getElementById('ai-settings').style.display = 'none';
    document.getElementById('btn-create').style.display = 'none';
    document.getElementById('file-input').value = '';
  }

  // ===== ЗАГРУЗИТЬ ПРИМЕР =====
  async function loadExample(type) {
    // Генерируем синтетические тестовые изображения
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 400;
    const ctx = canvas.getContext('2d');

    switch (type) {
      case 'cup':      drawExampleCup(ctx, 400, 400); break;
      case 'bottle':   drawExampleBottle(ctx, 400, 400); break;
      case 'toy':      drawExampleToy(ctx, 400, 400); break;
      case 'shoe':     drawExampleShoe(ctx, 400, 400); break;
    }

    const img = new Image();
    img.onload = () => processLoadedImage(img, type + '.png');
    img.src = canvas.toDataURL();
  }

  function drawExampleCup(ctx, w, h) {
    // Фон
    ctx.fillStyle = '#e8e0d4'; ctx.fillRect(0,0,w,h);
    // Тень
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.beginPath(); ctx.ellipse(w/2,h*0.85,80,15,0,0,Math.PI*2); ctx.fill();
    // Чашка
    const grad = ctx.createLinearGradient(w*0.2,0,w*0.8,0);
    grad.addColorStop(0,'#c0392b'); grad.addColorStop(0.4,'#e74c3c');
    grad.addColorStop(0.7,'#c0392b'); grad.addColorStop(1,'#922b21');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(w*0.25,h*0.25); ctx.lineTo(w*0.75,h*0.25);
    ctx.lineTo(w*0.7,h*0.8);  ctx.lineTo(w*0.3,h*0.8);
    ctx.closePath(); ctx.fill();
    // Верх чашки (эллипс)
    ctx.fillStyle='#c0392b';
    ctx.beginPath(); ctx.ellipse(w/2,h*0.25,w*0.25,h*0.04,0,0,Math.PI*2); ctx.fill();
    // Ручка
    ctx.strokeStyle='#922b21'; ctx.lineWidth=12; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(w*0.8,h*0.5,h*0.12,Math.PI*0.3,Math.PI*1.7); ctx.stroke();
    // Блик
    ctx.fillStyle='rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.ellipse(w*0.38,h*0.4,12,50,Math.PI*0.1,0,Math.PI*2); ctx.fill();
  }

  function drawExampleBottle(ctx, w, h) {
    ctx.fillStyle = '#d4e8e0'; ctx.fillRect(0,0,w,h);
    ctx.fillStyle='rgba(0,0,0,0.08)';
    ctx.beginPath(); ctx.ellipse(w/2,h*0.9,60,12,0,0,Math.PI*2); ctx.fill();
    const g = ctx.createLinearGradient(w*0.25,0,w*0.75,0);
    g.addColorStop(0,'#1a5276'); g.addColorStop(0.3,'#2980b9'); g.addColorStop(0.7,'#1a5276'); g.addColorStop(1,'#154360');
    ctx.fillStyle=g;
    // Тело
    ctx.beginPath();
    ctx.moveTo(w*0.3,h*0.35); ctx.lineTo(w*0.7,h*0.35);
    ctx.lineTo(w*0.72,h*0.85); ctx.lineTo(w*0.28,h*0.85);
    ctx.closePath(); ctx.fill();
    // Горлышко
    ctx.fillStyle='#1a5276';
    ctx.fillRect(w*0.42,h*0.12,w*0.16,h*0.25);
    // Крышка
    ctx.fillStyle='#f39c12';
    ctx.fillRect(w*0.41,h*0.08,w*0.18,h*0.06);
    // Блики
    ctx.fillStyle='rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.ellipse(w*0.38,h*0.55,8,60,0,0,Math.PI*2); ctx.fill();
  }

  function drawExampleToy(ctx, w, h) {
    ctx.fillStyle = '#f0e6d3'; ctx.fillRect(0,0,w,h);
    // Медведь
    ctx.fillStyle='#d4873a';
    // Тело
    ctx.beginPath(); ctx.ellipse(w/2,h*0.6,w*0.22,h*0.25,0,0,Math.PI*2); ctx.fill();
    // Голова
    ctx.beginPath(); ctx.ellipse(w/2,h*0.32,w*0.18,h*0.18,0,0,Math.PI*2); ctx.fill();
    // Уши
    ctx.beginPath(); ctx.ellipse(w*0.36,h*0.2,w*0.07,h*0.07,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w*0.64,h*0.2,w*0.07,h*0.07,0,0,Math.PI*2); ctx.fill();
    // Морда
    ctx.fillStyle='#c17028';
    ctx.beginPath(); ctx.ellipse(w/2,h*0.36,w*0.09,h*0.07,0,0,Math.PI*2); ctx.fill();
    // Глаза
    ctx.fillStyle='#2c2c2c';
    ctx.beginPath(); ctx.ellipse(w*0.44,h*0.29,5,5,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(w*0.56,h*0.29,5,5,0,0,Math.PI*2); ctx.fill();
    // Нос
    ctx.fillStyle='#1a1a1a';
    ctx.beginPath(); ctx.ellipse(w*0.5,h*0.335,6,4,0,0,Math.PI*2); ctx.fill();
  }

  function drawExampleShoe(ctx, w, h) {
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0,0,w,h);
    ctx.fillStyle='rgba(0,0,0,0.1)';
    ctx.beginPath(); ctx.ellipse(w*0.52,h*0.78,w*0.3,h*0.06,0,0,Math.PI*2); ctx.fill();
    // Подошва
    ctx.fillStyle='#f0f0f0';
    ctx.beginPath();
    ctx.moveTo(w*0.15,h*0.7); ctx.lineTo(w*0.85,h*0.7);
    ctx.lineTo(w*0.88,h*0.75); ctx.lineTo(w*0.12,h*0.75);
    ctx.closePath(); ctx.fill();
    // Верх кроссовка
    const g = ctx.createLinearGradient(w*0.1,h*0.35,w*0.9,h*0.7);
    g.addColorStop(0,'#e74c3c'); g.addColorStop(1,'#c0392b');
    ctx.fillStyle=g;
    ctx.beginPath();
    ctx.moveTo(w*0.15,h*0.7); ctx.lineTo(w*0.85,h*0.7);
    ctx.lineTo(w*0.8,h*0.45); ctx.quadraticCurveTo(w*0.6,h*0.3,w*0.35,h*0.38);
    ctx.lineTo(w*0.18,h*0.55); ctx.closePath(); ctx.fill();
    // Шнурки
    ctx.strokeStyle='white'; ctx.lineWidth=3;
    for (let i=0;i<4;i++) {
      ctx.beginPath();
      ctx.moveTo(w*(0.38+i*0.07),h*0.52); ctx.lineTo(w*(0.45+i*0.07),h*0.5);
      ctx.stroke();
    }
    // Белый носок
    ctx.fillStyle='white';
    ctx.beginPath(); ctx.ellipse(w*0.23,h*0.6,w*0.06,h*0.05,Math.PI*0.2,0,Math.PI*2); ctx.fill();
  }

  // ===== ЗАПУСК СОЗДАНИЯ =====
  async function startCreating() {
    if (!state.imageData) { showToast('Загрузите фото', 'err'); return; }
    if (state.isProcessing) return;
    state.isProcessing = true;

    // Получить настройки
    const quality    = document.getElementById('quality-select')?.value || 'medium';
    const objType    = document.getElementById('object-type')?.value || 'auto';
    const texMode    = document.getElementById('texture-mode')?.value || 'photo';
    const detailLvl  = parseInt(document.getElementById('detail-level')?.value || '3');
    const doSmooth   = document.getElementById('opt-smooth')?.checked ?? true;
    const closeBot   = document.getElementById('opt-close-bottom')?.checked ?? true;

    // Перейти на экран обработки
    goTo('process');

    // Показать фото на экране обработки
    const procImg = document.getElementById('proc-image');
    if (procImg && state.originalCanvas) {
      procImg.src = state.originalCanvas.toDataURL();
    }

    // Запустить сканирующую линию
    const beam = document.getElementById('proc-scan-beam');
    if (beam) { beam.style.display='block'; animateScanBeam(beam); }

    try {
      // === СТАДИЯ 1: Анализ изображения ===
      setStage(1,'active','Загрузка AI компонентов...');
      await sleep(300);
      setStage(1,'active','Анализ структуры изображения...');
      await animateStage(1, 0, 100, 600);
      updateMainProgress(15, 'Анализ завершён');
      setStage(1,'done','Анализ завершён ✓');

      // === СТАДИЯ 2: Сегментация ===
      setStage(2,'active','Сегментация объекта...');
      const segResult = await Segmentation.segment(
        state.imageData,
        {
          onProgress: (p, msg) => {
            setStageProgress(2, p);
            setStageDetail(2, msg);
            updateMainProgress(15 + p*0.15, msg);
          }
        }
      );
      state.mask = segResult.mask;

      // Показать маску
      const maskCanvas = document.getElementById('result-mask-canvas');
      if (maskCanvas) {
        Segmentation.drawMaskOnCanvas(maskCanvas, segResult.mask, state.imageData.width, state.imageData.height);
      }
      // Оверлей на обрабатываемое изображение
      drawMaskOverlay(segResult.mask, state.imageData.width, state.imageData.height);

      setStage(2,'done', `Объект найден: ${segResult.bbox.w}×${segResult.bbox.h}px`);
      updateMainProgress(30, 'Объект выделен');

      // === СТАДИЯ 3: Карта глубины ===
      setStage(3,'active','Нейросетевой анализ глубины...');
      const depthMap = await DepthEstimator.estimate(
        state.imageData,
        state.mask,
        {
          objectType: objType,
          onProgress: (p, msg) => {
            setStageProgress(3, p);
            setStageDetail(3, msg);
            updateMainProgress(30 + p*0.15, msg);
          }
        }
      );
      state.depthMap = depthMap;

      // Показать карту глубины
      const depthCanvas = document.getElementById('result-depth-canvas');
      if (depthCanvas) {
        DepthEstimator.drawDepthOnCanvas(depthCanvas, depthMap, state.imageData.width, state.imageData.height);
      }

      setStage(3,'done','Карта глубины готова ✓');
      updateMainProgress(45, 'Глубина оценена');

      // === СТАДИЯ 4: Нормали ===
      setStage(4,'active','Построение карты нормалей...');
      await animateStage(4, 0, 100, 500);
      setStage(4,'done','Нормали вычислены ✓');
      updateMainProgress(55, 'Нормали готовы');

      // === СТАДИЯ 5: 3D Сетка ===
      setStage(5,'active','Создание 3D геометрии...');
      const meshData = await MeshBuilder.build(
        state.imageData,
        state.mask,
        state.depthMap,
        {
          qualityPreset: quality,
          detailLevel: detailLvl,
          smoothing: doSmooth,
          closeBottom: closeBot,
          onProgress: (p, msg) => {
            setStageProgress(5, p);
            setStageDetail(5, msg);
            updateMainProgress(55 + p*0.2, msg);
          }
        }
      );
      state.meshData = meshData;
      setStage(5,'done',`${(meshData.vertices.length/3).toLocaleString()} вершин ✓`);
      updateMainProgress(75, 'Геометрия создана');

      // === СТАДИЯ 6: Текстура ===
      setStage(6,'active','Создание текстуры из фото...');
      const textureData = await TextureMapper.createTexture(
        state.imageData,
        state.mask,
        meshData,
        {
          textureMode: texMode,
          onProgress: (p, msg) => {
            setStageProgress(6, p);
            setStageDetail(6, msg);
            updateMainProgress(75 + p*0.2, msg);
          }
        }
      );
      state.textureData = textureData;
      setStage(6,'done','Текстура готова ✓');
      updateMainProgress(100, '🎉 Модель готова!');

      if (beam) beam.style.display='none';

      // Небольшая пауза и переход к результату
      await sleep(800);
      showResult();

    } catch (err) {
      console.error('Ошибка создания 3D:', err);
      showToast('Ошибка: ' + err.message, 'err', 5000);
      goTo('upload');
      state.isProcessing = false;
    }
  }

  // ===== ПОКАЗАТЬ РЕЗУЛЬТАТ =====
  function showResult() {
    goTo('result');
    state.isProcessing = false;

    // Инициализировать вьювер
    const canvas = document.getElementById('viewer-canvas');
    if (canvas && !Viewer3D.isReady) {
      Viewer3D.init(canvas);
    }

    // Показать модель
    Viewer3D.displayModel(state.meshData, state.textureData);

    // Исходное фото в сайдбаре
    const srcPhoto = document.getElementById('result-src-photo');
    if (srcPhoto && state.originalCanvas) {
      srcPhoto.src = state.originalCanvas.toDataURL();
    }

    // Статистика
    const verts = state.meshData.vertices.length / 3;
    const faceCnt = state.meshData.faces.length;
    const statsLabel = document.getElementById('model-stats-label');
    if (statsLabel) statsLabel.textContent = `${verts.toLocaleString()} вершин · ${faceCnt.toLocaleString()} граней`;

    // Размер
    const sizeEl = document.querySelector('#vio-size .vio-val');
    if (sizeEl && state.meshData.bbox) {
      sizeEl.textContent = `${state.meshData.bbox.w}×${state.meshData.bbox.h}`;
    }

    // Привязать кнопки результата
    bindResultButtons();

    showToast('🎉 3D модель готова!', 'ok', 4000);
  }

  // ===== КНОПКИ РЕЗУЛЬТАТА =====
  function bindResultButtons() {
    // Режимы вьювера
    const modes = {
      'vt-textured': 'textured',
      'vt-solid': 'solid',
      'vt-wire': 'wireframe',
      'vt-depth': 'depth'
    };
    Object.entries(modes).forEach(([btnId, mode]) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.onclick = () => {
          document.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          Viewer3D.setMode(mode);
        };
      }
    });

    // Контролы вьювера
    document.getElementById('vfc-rotate')?.addEventListener('click', function() {
      const on = Viewer3D.toggleAutoRotate();
      this.classList.toggle('active', on);
    });
    document.getElementById('vfc-reset')?.addEventListener('click', () => Viewer3D.resetView());
    document.getElementById('vfc-zoom-in')?.addEventListener('click', () => Viewer3D.zoomIn());
    document.getElementById('vfc-zoom-out')?.addEventListener('click', () => Viewer3D.zoomOut());

    // Назад
    document.getElementById('btn-back-result')?.addEventListener('click', () => {
      goTo('upload');
      clearPhoto();
    });

    // Новое фото
    document.getElementById('btn-new-photo')?.addEventListener('click', () => {
      goTo('upload');
      clearPhoto();
    });

    // Экспорт всё
    document.getElementById('btn-export-all')?.addEventListener('click', exportAll);

    // G-CODE модалка
    document.getElementById('gm-cancel')?.addEventListener('click', () => {
      document.getElementById('gcode-modal').style.display='none';
    });
    document.getElementById('gm-ok')?.addEventListener('click', () => {
      const settings = {
        layerHeight: parseFloat(document.getElementById('gc-layer')?.value || '0.2'),
        printSpeed:  parseInt(document.getElementById('gc-speed')?.value || '60'),
        nozzleTemp:  parseInt(document.getElementById('gc-nozzle')?.value || '210'),
        bedTemp:     parseInt(document.getElementById('gc-bed')?.value || '60'),
        infill:      parseInt(document.getElementById('gc-infill')?.value || '20'),
        nozzleSize:  parseFloat(document.getElementById('gc-nozzle-size')?.value || '0.4')
      };
      document.getElementById('gcode-modal').style.display='none';
      Exporter.exportGCODE(state.meshData, settings);
    });
  }

  // ===== ЭКСПОРТ =====
  function exportFn(format) {
    if (!state.meshData) { showToast('Модель не готова', 'err'); return; }
    switch (format) {
      case 'stl':         Exporter.exportSTL(state.meshData); break;
      case 'obj':         Exporter.exportOBJ(state.meshData, state.textureData); break;
      case 'gltf':        Exporter.exportGLTF(state.meshData, state.textureData); break;
      case 'ply':         Exporter.exportPLY(state.meshData); break;
      case 'png-texture': Exporter.exportTexturePNG(state.textureData); break;
      case 'gcode':
        document.getElementById('gcode-modal').style.display='flex'; break;
    }
  }

  async function exportAll() {
    if (!state.meshData) return;
    showToast('Скачивание файлов...', 'info', 6000);
    const fmts = ['stl','obj','ply','gltf'];
    for (let i=0; i<fmts.length; i++) {
      await sleep(i * 700);
      exportFn(fmts[i]);
    }
    setTimeout(() => Exporter.exportTexturePNG(state.textureData), fmts.length*700+200);
  }

  // ===== ОВЕРЛЕЙ МАСКИ =====
  function drawMaskOverlay(mask, w, h) {
    const overlay = document.getElementById('proc-overlay');
    if (!overlay) return;
    overlay.width = overlay.parentElement.clientWidth;
    overlay.height = overlay.parentElement.clientHeight;
    const ctx = overlay.getContext('2d');
    const scaleX = overlay.width / w;
    const scaleY = overlay.height / h;
    const imgD = ctx.createImageData(overlay.width, overlay.height);

    for (let y=0; y<overlay.height; y++) {
      for (let x=0; x<overlay.width; x++) {
        const sx = Math.floor(x/scaleX), sy = Math.floor(y/scaleY);
        const mi = Math.min(h-1,sy)*w + Math.min(w-1,sx);
        const idx = (y*overlay.width+x)*4;
        if (mask[mi]===1) {
          imgD.data[idx]=0; imgD.data[idx+1]=245; imgD.data[idx+2]=255; imgD.data[idx+3]=60;
        }
      }
    }
    ctx.putImageData(imgD,0,0);
    // Контур
    ctx.strokeStyle='rgba(0,245,255,0.8)';
    ctx.lineWidth=2;
    ctx.strokeRect(2,2,overlay.width-4,overlay.height-4);
  }

  // ===== НЕЙРОННЫЙ CANVAS (фоновая анимация) =====
  function initNeuralCanvas() {
    const canvas = document.getElementById('neural-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const nodes = [];
    const N = 40;

    const resize = () => {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Создать узлы
    for (let i=0; i<N; i++) {
      nodes.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random()-.5)*.0005,
        vy: (Math.random()-.5)*.0005,
        r: Math.random()*3+1
      });
    }

    function draw() {
      if (!document.getElementById('screen-process')?.classList.contains('active')) {
        requestAnimationFrame(draw); return;
      }
      const { width: w, height: h } = canvas;
      ctx.clearRect(0,0,w,h);

      // Обновить
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x<0||n.x>1) n.vx*=-1;
        if (n.y<0||n.y>1) n.vy*=-1;
      }

      // Связи
      for (let i=0; i<nodes.length; i++) {
        for (let j=i+1; j<nodes.length; j++) {
          const dx=nodes[i].x-nodes[j].x, dy=nodes[i].y-nodes[j].y;
          const d=Math.sqrt(dx*dx+dy*dy);
          if (d<0.2) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x*w, nodes[i].y*h);
            ctx.lineTo(nodes[j].x*w, nodes[j].y*h);
            ctx.strokeStyle=`rgba(0,245,255,${(1-d/0.2)*0.15})`;
            ctx.lineWidth=1;
            ctx.stroke();
          }
        }
      }

      // Точки
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x*w, n.y*h, n.r, 0, Math.PI*2);
        ctx.fillStyle='rgba(0,245,255,0.4)';
        ctx.fill();
      }

      requestAnimationFrame(draw);
    }
    draw();
  }

  function animateScanBeam(beam) {
    let pos = 0, dir = 1;
    function step() {
      if (!beam.style.display || beam.style.display==='none') return;
      pos += dir * 2;
      if (pos>100||pos<0) dir*=-1;
      beam.style.top = pos+'%';
      requestAnimationFrame(step);
    }
    step();
  }

  // ===== УТИЛИТЫ СТАДИЙ =====
  function setStage(n, status, detail) {
    const el = document.getElementById(`astage-${n}`);
    const ck = document.getElementById(`acheck-${n}`);
    if (el) { el.className='ai-stage '+status; }
    if (ck) { ck.textContent = status==='done'?'✅':status==='active'?'⚡':'○'; }
    if (detail) setStageDetail(n, detail);
  }

  function setStageProgress(n, p) {
    const fill = document.getElementById(`afill-${n}`);
    if (fill) fill.style.width = p+'%';
  }

  function setStageDetail(n, txt) {
    const el = document.getElementById(`adetail-${n}`);
    if (el) el.textContent = txt;
  }

  async function animateStage(n, from, to, dur) {
    const start = performance.now();
    return new Promise(res => {
      function step() {
        const t = Math.min(1,(performance.now()-start)/dur);
        setStageProgress(n, from+(to-from)*t);
        if (t<1) requestAnimationFrame(step);
        else res();
      }
      requestAnimationFrame(step);
    });
  }

  function updateMainProgress(pct, text) {
    const fill = document.getElementById('main-prog-fill');
    const txt  = document.getElementById('main-prog-text');
    const ptxt = document.getElementById('main-prog-pct');
    if (fill) fill.style.width = Math.round(pct)+'%';
    if (txt)  txt.textContent  = text || '';
    if (ptxt) ptxt.textContent = Math.round(pct)+'%';
  }

  function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

  // Публичный API
  return { export: exportFn };
})();
