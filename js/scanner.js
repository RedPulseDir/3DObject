/**
 * SCANNER MODULE
 * Логика сканирования, детектирование объекта, трекинг
 */

const Scanner = (() => {
  // Состояние
  let state = {
    phase: 'idle',       // idle | selecting | scanning | complete
    frames: [],          // захваченные кадры
    selectedRegion: null, // { x, y, w, h } - выбранная область
    currentAngle: 0,     // текущий угол обхода
    totalFrames: 36,     // целевое количество кадров
    autoCapture: true,
    captureInterval: null,
    lastCaptureAngle: -30,
    trackingPoints: [],
    motionScore: 0,
    prevFrameData: null,
    detectionActive: false
  };

  // Настройки
  const CONFIG = {
    MIN_FRAMES: 12,
    ANGLE_STEP: 10, // кадр каждые 10 градусов
    AUTO_CAPTURE_MS: 800,
    MAX_FRAMES: 72,
    TRACK_POINTS: 15
  };

  // UI элементы (инициализируются в init)
  let ui = {};
  let selectionCanvas, selectionCtx;
  let isDrawing = false;
  let drawPath = [];
  let animFrame = null;

  /**
   * Инициализация
   */
  function init(elements) {
    ui = elements;
    
    selectionCanvas = document.getElementById('selection-canvas');
    selectionCtx = selectionCanvas.getContext('2d');

    setupSelectionCanvas();
    setupOrbitDots();
    
    console.log('Scanner инициализирован');
  }

  /**
   * Настройка canvas выделения
   */
  function setupSelectionCanvas() {
    const resize = () => {
      selectionCanvas.width = selectionCanvas.offsetWidth;
      selectionCanvas.height = selectionCanvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Touch события для выделения пальцем
    selectionCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
    selectionCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
    selectionCanvas.addEventListener('touchend', onTouchEnd);

    // Mouse события для десктопа
    selectionCanvas.addEventListener('mousedown', onMouseDown);
    selectionCanvas.addEventListener('mousemove', onMouseMove);
    selectionCanvas.addEventListener('mouseup', onMouseUp);
  }

  /**
   * Создать точки кадров для отображения прогресса
   */
  function setupOrbitDots() {
    const container = document.getElementById('frame-dots');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 36; i++) {
      const dot = document.createElement('div');
      dot.className = 'frame-dot';
      dot.id = `fdot-${i}`;
      container.appendChild(dot);
    }
  }

  // ===== СОБЫТИЯ ВЫДЕЛЕНИЯ =====

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
      x: (touch.clientX - rect.left) * (canvas.width / rect.width),
      y: (touch.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function onTouchStart(e) {
    e.preventDefault();
    if (state.phase !== 'selecting') return;
    const pos = getPos(e, selectionCanvas);
    startDraw(pos);
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (!isDrawing || state.phase !== 'selecting') return;
    const pos = getPos(e, selectionCanvas);
    continueDraw(pos);
  }

  function onTouchEnd(e) {
    if (state.phase !== 'selecting') return;
    endDraw();
  }

  function onMouseDown(e) {
    if (state.phase !== 'selecting') return;
    const pos = getPos(e, selectionCanvas);
    startDraw(pos);
  }

  function onMouseMove(e) {
    if (!isDrawing || state.phase !== 'selecting') return;
    const pos = getPos(e, selectionCanvas);
    continueDraw(pos);
  }

  function onMouseUp(e) {
    if (state.phase !== 'selecting') return;
    endDraw();
  }

  function startDraw(pos) {
    isDrawing = true;
    drawPath = [pos];
    selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
  }

  function continueDraw(pos) {
    drawPath.push(pos);
    renderSelection();
  }

  function endDraw() {
    if (drawPath.length < 5) {
      isDrawing = false;
      return;
    }
    isDrawing = false;
    finishSelection();
  }

  /**
   * Отрисовка выделения
   */
  function renderSelection() {
    selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
    
    if (drawPath.length < 2) return;

    // Полупрозрачный фон
    selectionCtx.fillStyle = 'rgba(0,0,0,0.3)';
    selectionCtx.fillRect(0, 0, selectionCanvas.width, selectionCanvas.height);

    // Контур выделения
    selectionCtx.beginPath();
    selectionCtx.moveTo(drawPath[0].x, drawPath[0].y);
    for (let i = 1; i < drawPath.length; i++) {
      selectionCtx.lineTo(drawPath[i].x, drawPath[i].y);
    }
    selectionCtx.closePath();
    
    // Вырезаем область (делаем прозрачной)
    selectionCtx.save();
    selectionCtx.clip();
    selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
    selectionCtx.restore();

    // Обводка
    selectionCtx.beginPath();
    selectionCtx.moveTo(drawPath[0].x, drawPath[0].y);
    for (let i = 1; i < drawPath.length; i++) {
      selectionCtx.lineTo(drawPath[i].x, drawPath[i].y);
    }
    selectionCtx.closePath();
    selectionCtx.strokeStyle = '#00f5ff';
    selectionCtx.lineWidth = 2;
    selectionCtx.setLineDash([8, 4]);
    selectionCtx.stroke();
    selectionCtx.setLineDash([]);
  }

  /**
   * Завершить выделение
   */
  function finishSelection() {
    if (drawPath.length < 5) return;

    // Вычислить bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    drawPath.forEach(p => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });

    const w = maxX - minX;
    const h = maxY - minY;

    if (w < 30 || h < 30) {
      clearSelection();
      showToast('Выделенная область слишком мала', 'error');
      return;
    }

    state.selectedRegion = {
      x: minX / selectionCanvas.width,
      y: minY / selectionCanvas.height,
      w: w / selectionCanvas.width,
      h: h / selectionCanvas.height,
      path: drawPath.map(p => ({
        x: p.x / selectionCanvas.width,
        y: p.y / selectionCanvas.height
      }))
    };

    // Нарисовать финальное выделение
    renderFinalSelection(minX, minY, w, h);
    
    // Активировать кнопку подтверждения
    const confirmBtn = document.getElementById('btn-confirm-selection');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.style.animation = 'pulse-btn 1s ease-in-out infinite';
    }

    updateStatus('Объект выделен! Нажмите "Подтвердить"', 'active');
    generateTrackingPoints(minX, minY, w, h);
  }

  /**
   * Авто-определение объекта (детектирование по яркости/контрасту)
   */
  function autoDetect() {
    updateStatus('Анализ кадра...', 'warning');
    
    // Получаем данные с видео
    const video = document.getElementById('camera-video');
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth || 640;
    tempCanvas.height = video.videoHeight || 480;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const region = detectObject(imageData);
    
    if (region) {
      // Конвертировать в экранные координаты
      const scaleX = selectionCanvas.width / tempCanvas.width;
      const scaleY = selectionCanvas.height / tempCanvas.height;
      
      const px = region.x * scaleX;
      const py = region.y * scaleY;
      const pw = region.w * scaleX;
      const ph = region.h * scaleY;

      // Добавить отступ
      const pad = 20;
      const fx = Math.max(0, px - pad);
      const fy = Math.max(0, py - pad);
      const fw = Math.min(selectionCanvas.width - fx, pw + pad * 2);
      const fh = Math.min(selectionCanvas.height - fy, ph + pad * 2);

      state.selectedRegion = {
        x: fx / selectionCanvas.width,
        y: fy / selectionCanvas.height,
        w: fw / selectionCanvas.width,
        h: fh / selectionCanvas.height
      };

      renderFinalSelection(fx, fy, fw, fh);
      generateTrackingPoints(fx, fy, fw, fh);

      const confirmBtn = document.getElementById('btn-confirm-selection');
      if (confirmBtn) confirmBtn.disabled = false;

      updateStatus('Объект обнаружен!', 'active');
      showToast('Объект автоматически обнаружен ✓', 'success');
    } else {
      updateStatus('Объект не найден', 'error');
      showToast('Поместите объект в центр кадра', 'error');
      setTimeout(() => updateStatus('Выделите объект вручную', ''), 2000);
    }
  }

  /**
   * Простой алгоритм детектирования объекта
   * Ищет область с высоким контрастом
   */
  function detectObject(imageData) {
    const { data, width, height } = imageData;
    
    // Создаём карту яркости
    const brightness = new Float32Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
      const idx = i / 4;
      brightness[idx] = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114) / 255;
    }

    // Находим края (простой детектор)
    const edges = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const gx = brightness[idx + 1] - brightness[idx - 1];
        const gy = brightness[idx + width] - brightness[idx - width];
        edges[idx] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    // Ищем регион с максимальным количеством краёв
    const blockW = Math.floor(width / 6);
    const blockH = Math.floor(height / 6);
    
    let bestScore = 0;
    let bestRegion = null;

    for (let by = 0; by < 4; by++) {
      for (let bx = 0; bx < 4; bx++) {
        const startX = bx * blockW;
        const startY = by * blockH;
        const endX = startX + blockW * 2;
        const endY = startY + blockH * 2;
        
        if (endX > width || endY > height) continue;

        let score = 0;
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            score += edges[y * width + x];
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestRegion = { x: startX, y: startY, w: endX - startX, h: endY - startY };
        }
      }
    }

    // Проверяем что нашли что-то значимое
    if (bestScore < 500) return null;

    return bestRegion;
  }

  /**
   * Финальная отрисовка выделения
   */
  function renderFinalSelection(x, y, w, h) {
    selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
    
    // Тёмный фон вокруг выделения
    selectionCtx.fillStyle = 'rgba(0,0,0,0.5)';
    selectionCtx.fillRect(0, 0, selectionCanvas.width, selectionCanvas.height);
    
    // Вырезаем выделенную область
    selectionCtx.clearRect(x, y, w, h);

    // Рамка
    selectionCtx.strokeStyle = '#00f5ff';
    selectionCtx.lineWidth = 2;
    selectionCtx.strokeRect(x, y, w, h);

    // Уголки
    const cs = 20;
    selectionCtx.strokeStyle = '#00f5ff';
    selectionCtx.lineWidth = 4;
    
    [[x, y, 1, 1], [x+w, y, -1, 1], [x, y+h, 1, -1], [x+w, y+h, -1, -1]].forEach(([cx, cy, dx, dy]) => {
      selectionCtx.beginPath();
      selectionCtx.moveTo(cx + dx * cs, cy);
      selectionCtx.lineTo(cx, cy);
      selectionCtx.lineTo(cx, cy + dy * cs);
      selectionCtx.stroke();
    });
  }

  /**
   * Очистить выделение
   */
  function clearSelection() {
    selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
    state.selectedRegion = null;
    drawPath = [];
    isDrawing = false;
    
    const confirmBtn = document.getElementById('btn-confirm-selection');
    if (confirmBtn) confirmBtn.disabled = true;

    clearTrackingPoints();
    updateStatus('Выделите объект', '');
  }

  /**
   * Генерация точек трекинга
   */
  function generateTrackingPoints(x, y, w, h) {
    clearTrackingPoints();
    const container = document.getElementById('tracking-points');
    if (!container) return;

    const containerRect = selectionCanvas.getBoundingClientRect();
    const scaleX = containerRect.width / selectionCanvas.width;
    const scaleY = containerRect.height / selectionCanvas.height;

    state.trackingPoints = [];
    
    for (let i = 0; i < CONFIG.TRACK_POINTS; i++) {
      const px = x + Math.random() * w;
      const py = y + Math.random() * h;
      
      const dot = document.createElement('div');
      dot.className = 'track-point';
      dot.style.left = (px * scaleX / containerRect.width * 100) + '%';
      dot.style.top = (py * scaleY / containerRect.height * 100) + '%';
      dot.style.animationDelay = (Math.random() * 1) + 's';
      container.appendChild(dot);
      
      state.trackingPoints.push({ x: px / selectionCanvas.width, y: py / selectionCanvas.height, el: dot });
    }
  }

  function clearTrackingPoints() {
    const container = document.getElementById('tracking-points');
    if (container) container.innerHTML = '';
    state.trackingPoints = [];
  }

  /**
   * Начать сканирование
   */
  function startScanning() {
    state.phase = 'scanning';
    state.frames = [];
    state.currentAngle = 0;
    state.lastCaptureAngle = -30;

    // Показать элементы сканирования
    const scanFrame = document.getElementById('scan-frame');
    if (scanFrame) scanFrame.classList.add('scanning');

    const orbitProgress = document.getElementById('orbit-progress-container');
    if (orbitProgress) orbitProgress.style.display = 'block';

    // Обновить UI
    updateOrbitProgress(0);
    updateScanStats();

    // Запустить авто-захват
    if (state.autoCapture) {
      startAutoCapture();
    }

    // Начать детектирование движения
    startMotionDetection();
    
    updateStatus('Обходите вокруг объекта', 'active');
  }

  /**
   * Авто-захват кадров
   */
  function startAutoCapture() {
    if (state.captureInterval) clearInterval(state.captureInterval);
    
    state.captureInterval = setInterval(() => {
      if (state.phase !== 'scanning') return;
      
      // Проверяем что прошёл достаточный угол
      const angleDiff = Math.abs(state.currentAngle - state.lastCaptureAngle);
      if (angleDiff >= CONFIG.ANGLE_STEP || state.frames.length === 0) {
        captureFrame();
      }
    }, CONFIG.AUTO_CAPTURE_MS);
  }

  function stopAutoCapture() {
    if (state.captureInterval) {
      clearInterval(state.captureInterval);
      state.captureInterval = null;
    }
  }

  /**
   * Захватить один кадр
   */
  function captureFrame() {
    if (state.phase !== 'scanning') return;
    if (state.frames.length >= CONFIG.MAX_FRAMES) return;

    const tempCanvas = document.createElement('canvas');
    const frameData = Camera.captureFrameData(tempCanvas);
    if (!frameData) return;

    const frameInfo = {
      index: state.frames.length,
      angle: state.currentAngle,
      timestamp: Date.now(),
      imageData: frameData.imageData,
      dataUrl: tempCanvas.toDataURL('image/jpeg', 0.8),
      width: frameData.width,
      height: frameData.height,
      region: state.selectedRegion
    };

    state.frames.push(frameInfo);
    state.lastCaptureAngle = state.currentAngle;

    // Обновить UI
    updateScanStats();
    updateFrameDot(state.frames.length - 1);
    flashCaptureEffect();

    // Проверить достаточность
    const minFramesReached = state.frames.length >= CONFIG.MIN_FRAMES;
    const coverageOk = state.currentAngle >= 270;
    
    const finishBtn = document.getElementById('btn-finish-scan');
    if (finishBtn) {
      finishBtn.disabled = !(minFramesReached && coverageOk);
    }
  }

  /**
   * Детектирование движения для оценки угла
   * Использует оптический поток (упрощённый)
   */
  function startMotionDetection() {
    let lastFrame = null;
    let accumulatedAngle = 0;
    
    function detectMotion() {
      if (state.phase !== 'scanning') return;
      
      const frameData = Camera.captureFrameData();
      if (!frameData || !lastFrame) {
        lastFrame = frameData;
        animFrame = requestAnimationFrame(detectMotion);
        return;
      }

      // Вычислить оптический поток (упрощённо)
      const flow = calculateOpticalFlow(lastFrame.imageData, frameData.imageData);
      
      // Оценить угол поворота
      const angleChange = estimateAngleChange(flow);
      accumulatedAngle += Math.abs(angleChange);
      state.currentAngle = Math.min(360, accumulatedAngle);
      
      // Обновить UI
      updateOrbitProgress(state.currentAngle);

      // Определить направление
      if (Math.abs(angleChange) > 0.5) {
        showMotionIndicator();
      }

      state.motionScore = flow.magnitude;
      lastFrame = frameData;
      
      animFrame = requestAnimationFrame(detectMotion);
    }

    animFrame = requestAnimationFrame(detectMotion);
  }

  /**
   * Упрощённый оптический поток
   */
  function calculateOpticalFlow(prev, curr) {
    const step = 8;
    const { width, height } = prev;
    let totalDx = 0, totalDy = 0, count = 0;

    const pd = prev.data;
    const cd = curr.data;

    for (let y = step; y < height - step; y += step * 2) {
      for (let x = step; x < width - step; x += step * 2) {
        const idx = (y * width + x) * 4;
        
        const pb = (pd[idx] + pd[idx+1] + pd[idx+2]) / 3;
        const cb = (cd[idx] + cd[idx+1] + cd[idx+2]) / 3;
        
        // Ищем соответствие
        let minDiff = Infinity;
        let bestDx = 0, bestDy = 0;
        
        for (let dy = -step; dy <= step; dy += 2) {
          for (let dx = -step; dx <= step; dx += 2) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            
            const nidx = (ny * width + nx) * 4;
            const nb = (cd[nidx] + cd[nidx+1] + cd[nidx+2]) / 3;
            const diff = Math.abs(nb - pb);
            
            if (diff < minDiff) {
              minDiff = diff;
              bestDx = dx;
              bestDy = dy;
            }
          }
        }
        
        if (minDiff < 30) {
          totalDx += bestDx;
          totalDy += bestDy;
          count++;
        }
      }
    }

    const avgDx = count > 0 ? totalDx / count : 0;
    const avgDy = count > 0 ? totalDy / count : 0;
    const magnitude = Math.sqrt(avgDx * avgDx + avgDy * avgDy);

    return { dx: avgDx, dy: avgDy, magnitude };
  }

  /**
   * Оценить изменение угла из оптического потока
   */
  function estimateAngleChange(flow) {
    // Горизонтальное движение → угол обхода
    const sensitivity = 0.15;
    return flow.dx * sensitivity;
  }

  /**
   * Показать индикатор движения
   */
  function showMotionIndicator() {
    const indicator = document.getElementById('motion-indicator');
    if (indicator) {
      indicator.style.display = 'flex';
      clearTimeout(indicator._hideTimer);
      indicator._hideTimer = setTimeout(() => {
        indicator.style.display = 'none';
      }, 500);
    }
  }

  /**
   * Эффект захвата кадра
   */
  function flashCaptureEffect() {
    const video = document.getElementById('camera-video');
    if (video) {
      video.style.filter = 'brightness(2)';
      setTimeout(() => { video.style.filter = ''; }, 100);
    }
  }

  /**
   * Обновление UI элементов
   */
  function updateOrbitProgress(angle) {
    const degrees = Math.min(360, Math.round(angle));
    const percent = degrees / 360;
    const circumference = 314;
    const offset = circumference - percent * circumference;

    const fill = document.getElementById('orbit-fill');
    const percentText = document.getElementById('orbit-percent');
    
    if (fill) fill.style.strokeDashoffset = offset;
    if (percentText) percentText.textContent = degrees + '°';

    // Обновить счётчик кадров
    const frameCount = document.getElementById('frame-count');
    if (frameCount) frameCount.textContent = state.frames.length;
  }

  function updateScanStats() {
    const statFrames = document.getElementById('stat-frames');
    const statQuality = document.getElementById('stat-quality');
    const statCoverage = document.getElementById('stat-coverage');

    if (statFrames) statFrames.textContent = state.frames.length;
    if (statQuality) {
      const q = state.frames.length < 6 ? 'Низкое' :
                state.frames.length < 18 ? 'Среднее' :
                state.frames.length < 30 ? 'Хорошее' : 'Отличное';
      statQuality.textContent = q;
    }
    if (statCoverage) {
      const c = Math.min(100, Math.round(state.currentAngle / 360 * 100));
      statCoverage.textContent = c + '%';
    }
  }

  function updateFrameDot(index) {
    const dotIndex = Math.floor(index / state.frames.length * 36);
    const dot = document.getElementById(`fdot-${Math.min(35, dotIndex)}`);
    if (dot) dot.classList.add('captured');
  }

  function updateStatus(text, type) {
    const dot = document.getElementById('status-dot');
    const textEl = document.getElementById('status-text');
    
    if (dot) {
      dot.className = 'status-dot';
      if (type) dot.classList.add(type);
    }
    if (textEl) textEl.textContent = text;
  }

  function showToast(msg, type) {
    // Делегируем глобальной функции
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    }
  }

  /**
   * Завершить сканирование
   */
  function finishScanning() {
    stopAutoCapture();
    if (animFrame) cancelAnimationFrame(animFrame);
    state.phase = 'complete';
    
    const scanFrame = document.getElementById('scan-frame');
    if (scanFrame) scanFrame.classList.remove('scanning');

    return {
      frames: state.frames,
      frameCount: state.frames.length,
      coverage: Math.min(100, Math.round(state.currentAngle / 360 * 100)),
      selectedRegion: state.selectedRegion
    };
  }

  /**
   * Сброс
   */
  function reset() {
    stopAutoCapture();
    if (animFrame) cancelAnimationFrame(animFrame);
    clearSelection();
    clearTrackingPoints();
    
    state = {
      phase: 'idle',
      frames: [],
      selectedRegion: null,
      currentAngle: 0,
      totalFrames: 36,
      autoCapture: true,
      captureInterval: null,
      lastCaptureAngle: -30,
      trackingPoints: [],
      motionScore: 0,
      prevFrameData: null,
      detectionActive: false
    };
    
    setupOrbitDots();
  }

  return {
    init,
    startPhase: (phase) => { state.phase = phase; },
    autoDetect,
    clearSelection,
    startScanning,
    captureFrame,
    finishScanning,
    reset,
    setAutoCapture: (v) => { 
      state.autoCapture = v;
      if (v && state.phase === 'scanning') startAutoCapture();
      else stopAutoCapture();
    },
    get frames() { return state.frames; },
    get phase() { return state.phase; },
    get hasSelection() { return !!state.selectedRegion; },
    get frameCount() { return state.frames.length; },
    get coverage() { return Math.min(100, Math.round(state.currentAngle / 360 * 100)); }
  };
})();
