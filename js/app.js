/**
 * APP.JS — Главный контроллер приложения
 */

// ===== СОСТОЯНИЕ =====
const AppState = {
  currentScreen: 'welcome',
  scanData: null,
  modelData: null,
  gcodeSettings: {}
};

// ===== УТИЛИТЫ =====

function showToast(message, type = 'info', duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

window.showToast = showToast;

function showModal({ icon = '⚠️', title, message, confirmText = 'OK', cancelText = null, onConfirm, onCancel }) {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById('modal');
  
  document.getElementById('modal-icon').textContent = icon;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message').textContent = message;
  
  const confirmBtn = document.getElementById('modal-confirm');
  const cancelBtn = document.getElementById('modal-cancel');
  
  confirmBtn.textContent = confirmText;
  confirmBtn.onclick = () => {
    hideModal();
    if (onConfirm) onConfirm();
  };
  
  if (cancelText) {
    cancelBtn.style.display = '';
    cancelBtn.textContent = cancelText;
    cancelBtn.onclick = () => {
      hideModal();
      if (onCancel) onCancel();
    };
  } else {
    cancelBtn.style.display = 'none';
  }
  
  overlay.style.display = 'flex';
}

function hideModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.style.display = 'none';
}

/**
 * Переключить экран
 */
function navigateTo(screenId) {
  const current = document.querySelector('.screen.active');
  const next = document.getElementById(`screen-${screenId}`);
  
  if (!next || current === next) return;
  
  if (current) {
    current.classList.remove('active');
    current.style.display = 'none';
  }
  
  next.style.display = 'flex';
  requestAnimationFrame(() => {
    next.classList.add('active', 'fade-in');
    setTimeout(() => next.classList.remove('fade-in'), 400);
  });
  
  AppState.currentScreen = screenId;
}

// ===== ИНИЦИАЛИЗАЦИЯ =====

document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 3D Scanner Pro запущен');
  initWelcomeScreen();
  
  // Проверить поддержку
  checkBrowserSupport();
});

function checkBrowserSupport() {
  const issues = [];
  
  if (!navigator.mediaDevices?.getUserMedia) {
    issues.push('Camera API не поддерживается');
  }
  if (!window.WebGLRenderingContext) {
    issues.push('WebGL не поддерживается');
  }
  
  if (issues.length > 0) {
    showModal({
      icon: '⚠️',
      title: 'Ограниченная поддержка',
      message: issues.join('\n') + '\n\nНекоторые функции могут не работать.',
      confirmText: 'Понятно'
    });
  }
}

// ===== ЭКРАН: ПРИВЕТСТВИЕ =====

function initWelcomeScreen() {
  const btn = document.getElementById('btn-start');
  if (btn) {
    btn.addEventListener('click', handleStartScan);
  }
}

async function handleStartScan() {
  const btn = document.getElementById('btn-start');
  if (btn) {
    btn.textContent = '📷 Запрос камеры...';
    btn.disabled = true;
  }
  
  try {
    // Переключиться на экран сканирования
    navigateTo('scan');
    
    // Инициализировать сканирование
    await initScanScreen();
    
  } catch (err) {
    navigateTo('welcome');
    
    if (btn) {
      btn.innerHTML = '<span class="btn-icon">🚀</span> Начать сканирование';
      btn.disabled = false;
    }
    
    showModal({
      icon: '📷',
      title: 'Нет доступа к камере',
      message: 'Разрешите доступ к камере в настройках браузера и попробуйте снова.',
      confirmText: 'Понятно'
    });
    
    console.error('Ошибка камеры:', err);
  }
}

// ===== ЭКРАН: СКАНИРОВАНИЕ =====

async function initScanScreen() {
  // Запустить камеру
  const video = document.getElementById('camera-video');
  
  await Camera.init(video);
  showToast('Камера готова ✓', 'success');

  // Инициализировать сканер
  Scanner.init({});
  Scanner.startPhase('selecting');

  // Обновить статус
  updateScanStatus('Выделите объект', '');

  // Привязать кнопки
  bindScanButtons();
  
  // Показать фазу выбора
  showPhase('select');
}

function bindScanButtons() {
  
  // Назад
  document.getElementById('btn-back-scan')?.addEventListener('click', () => {
    showModal({
      icon: '⚠️',
      title: 'Выйти из сканирования?',
      message: 'Все записанные кадры будут потеряны.',
      confirmText: 'Выйти',
      cancelText: 'Остаться',
      onConfirm: () => {
        Scanner.reset();
        Camera.stop();
        navigateTo('welcome');
        resetWelcomeButton();
      }
    });
  });

  // Авто-обнаружение
  document.getElementById('btn-auto-detect')?.addEventListener('click', () => {
    Scanner.autoDetect();
  });

  // Очистить выделение
  document.getElementById('btn-clear-selection')?.addEventListener('click', () => {
    Scanner.clearSelection();
  });

  // Подтвердить объект
  document.getElementById('btn-confirm-selection')?.addEventListener('click', () => {
    if (!Scanner.hasSelection) {
      showToast('Сначала выделите объект', 'error');
      return;
    }
    confirmObjectSelection();
  });

  // Захват кадра
  document.getElementById('btn-capture')?.addEventListener('click', () => {
    Scanner.captureFrame();
    showCaptureFlash();
  });

  // Авто-захват
  document.getElementById('auto-capture')?.addEventListener('change', (e) => {
    Scanner.setAutoCapture(e.target.checked);
    showToast(e.target.checked ? 'Авто-захват включён' : 'Авто-захват выключен', 'info');
  });

  // Завершить сканирование
  document.getElementById('btn-finish-scan')?.addEventListener('click', () => {
    if (Scanner.frameCount < 8) {
      showModal({
        icon: '📸',
        title: 'Мало кадров',
        message: `Сейчас ${Scanner.frameCount} кадров. Рекомендуется минимум 12 для хорошего качества. Продолжить?`,
        confirmText: 'Продолжить',
        cancelText: 'Ещё поснимать',
        onConfirm: finishScanning
      });
    } else {
      finishScanning();
    }
  });
}

function confirmObjectSelection() {
  showPhase('scan');
  Scanner.startScanning();
  
  const frameLabel = document.querySelector('.frame-label');
  if (frameLabel) frameLabel.textContent = 'Держите объект в рамке';
  
  showToast('Начинайте обходить вокруг объекта 🔄', 'info', 4000);
  
  // Обновить заголовок
  document.querySelector('#scan-phase-label').textContent = 'Обходите вокруг объекта';
}

function showPhase(phase) {
  document.getElementById('phase-select').style.display = phase === 'select' ? '' : 'none';
  document.getElementById('phase-scan').style.display = phase === 'scan' ? '' : 'none';
}

function showCaptureFlash() {
  const container = document.querySelector('.camera-container');
  if (!container) return;
  
  const flash = document.createElement('div');
  flash.style.cssText = `
    position: absolute; inset: 0; 
    background: white; opacity: 0.5; 
    pointer-events: none; z-index: 50;
    animation: flashOut 0.2s ease forwards;
  `;
  
  const style = document.createElement('style');
  style.textContent = '@keyframes flashOut { to { opacity: 0; } }';
  document.head.appendChild(style);
  
  container.appendChild(flash);
  setTimeout(() => { container.removeChild(flash); document.head.removeChild(style); }, 200);
}

function updateScanStatus(text, type) {
  const dot = document.getElementById('status-dot');
  const textEl = document.getElementById('status-text');
  if (dot) { dot.className = 'status-dot'; if (type) dot.classList.add(type); }
  if (textEl) textEl.textContent = text;
}

function finishScanning() {
  const scanResult = Scanner.finishScanning();
  AppState.scanData = scanResult;
  
  console.log(`Сканирование завершено: ${scanResult.frameCount} кадров, ${scanResult.coverage}% покрытие`);
  
  Camera.stop();
  startProcessing(scanResult);
}

// ===== ЭКРАН: ОБРАБОТКА =====

function startProcessing(scanData) {
  navigateTo('process');
  
  const frameCountEl = document.getElementById('process-frame-count');
  if (frameCountEl) frameCountEl.textContent = scanData.frameCount;

  // Сбросить прогресс
  resetProcessProgress();

  // Лог
  const logContainer = document.getElementById('process-log');
  function addLog(message, type) {
    const entry = document.createElement('div');
    entry.className = 'log-entry' + (type ? ` ${type}` : '');
    entry.textContent = message;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  // Прогресс
  function updateProgress(percent, stage) {
    const circle = document.getElementById('progress-circle');
    const percentText = document.getElementById('progress-percent');
    const stageText = document.getElementById('progress-stage');
    
    const circumference = 534;
    const offset = circumference - (percent / 100) * circumference;
    
    if (circle) circle.style.strokeDashoffset = offset;
    if (percentText) percentText.textContent = percent + '%';
    if (stageText) stageText.textContent = stage;
  }

  // Кнопка отмены
  document.getElementById('btn-cancel-process')?.addEventListener('click', () => {
    Processor.cancel();
    showModal({
      icon: '⏹️',
      title: 'Обработка отменена',
      message: 'Вернуться к сканированию?',
      confirmText: 'К сканированию',
      cancelText: 'Остаться',
      onConfirm: () => {
        Scanner.reset();
        navigateTo('welcome');
        resetWelcomeButton();
      }
    });
  });

  // Запустить обработку
  addLog('🚀 Начало обработки...');
  
  Processor.process(scanData, updateProgress, addLog)
    .then(result => {
      AppState.modelData = result;
      addLog('✅ Модель готова!', 'success');
      
      setTimeout(() => {
        showResult(result);
      }, 1000);
    })
    .catch(err => {
      if (err.message !== 'Отменено') {
        addLog('❌ Ошибка обработки', 'error');
        showModal({
          icon: '❌',
          title: 'Ошибка обработки',
          message: 'Не удалось создать модель. Попробуйте сканировать снова с большим количеством кадров.',
          confirmText: 'Новое сканирование',
          onConfirm: () => {
            Scanner.reset();
            navigateTo('welcome');
            resetWelcomeButton();
          }
        });
      }
    });
}

function resetProcessProgress() {
  const circle = document.getElementById('progress-circle');
  const percentText = document.getElementById('progress-percent');
  const stageText = document.getElementById('progress-stage');
  
  if (circle) circle.style.strokeDashoffset = 534;
  if (percentText) percentText.textContent = '0%';
  if (stageText) stageText.textContent = 'Начало...';
  
  const log = document.getElementById('process-log');
  if (log) log.innerHTML = '<div class="log-entry">🚀 Начало обработки...</div>';

  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`stage-${i}`);
    const status = document.getElementById(`stage-${i}-status`);
    const fill = document.getElementById(`stage-${i}-fill`);
    if (el) el.className = 'stage';
    if (status) status.textContent = '⏳';
    if (fill) fill.style.width = '0%';
  }
}

// ===== ЭКРАН: РЕЗУЛЬТАТ =====

function showResult(modelData) {
  navigateTo('result');
  
  // Инициализировать Three.js вьювер
  const container = document.getElementById('viewer-container');
  
  if (!Model3D.isReady) {
    Model3D.init(container);
  }

  // Отобразить модель
  Model3D.displayMesh(modelData.mesh);

  // Привязать кнопки вьювера
  bindViewerButtons();
  bindExportButtons();
  
  showToast('🎉 3D модель готова!', 'success', 4000);
}

function bindViewerButtons() {
  document.getElementById('btn-rotate-auto')?.addEventListener('click', () => {
    Model3D.toggleAutoRotate();
    showToast('Авто-вращение переключено', 'info');
  });

  document.getElementById('btn-wireframe')?.addEventListener('click', () => {
    Model3D.toggleWireframe();
  });

  document.getElementById('btn-solid')?.addEventListener('click', () => {
    Model3D.setSolidMode();
  });

  document.getElementById('btn-reset-view')?.addEventListener('click', () => {
    Model3D.resetView();
  });

  document.getElementById('btn-back-result')?.addEventListener('click', () => {
    showModal({
      icon: '🔄',
      title: 'Новое сканирование?',
      message: 'Текущая 3D модель будет потеряна. Скачайте её перед выходом.',
      confirmText: 'Выйти',
      cancelText: 'Остаться',
      onConfirm: () => {
        AppState.modelData = null;
        AppState.scanData = null;
        Scanner.reset();
        navigateTo('welcome');
        resetWelcomeButton();
      }
    });
  });
}

function bindExportButtons() {
  document.getElementById('btn-download-all')?.addEventListener('click', () => {
    if (!AppState.modelData) return;
    
    showModal({
      icon: '📦',
      title: 'Скачать все форматы?',
      message: 'Будет скачано 8 файлов (STL, OBJ, PLY, DAE, GLB, 3MF, FBX, GCODE)',
      confirmText: 'Скачать всё',
      cancelText: 'Отмена',
      onConfirm: () => {
        Exporter.exportAll(AppState.modelData.mesh, AppState.gcodeSettings);
      }
    });
  });

  document.getElementById('btn-new-scan')?.addEventListener('click', () => {
    AppState.modelData = null;
    AppState.scanData = null;
    Scanner.reset();
    navigateTo('welcome');
    resetWelcomeButton();
  });
}

// Глобальная функция экспорта (вызывается из HTML)
window.exportModel = function(format) {
  if (!AppState.modelData) {
    showToast('Модель не готова', 'error');
    return;
  }

  if (format === 'gcode') {
    // Показать настройки G-CODE
    showGCodeSettings();
  } else {
    Exporter.exportFormat(format, AppState.modelData.mesh, {});
  }
};

function showGCodeSettings() {
  const modal = document.getElementById('gcode-modal');
  if (modal) modal.style.display = 'flex';
  
  document.getElementById('gcode-cancel')?.addEventListener('click', () => {
    modal.style.display = 'none';
  }, { once: true });
  
  document.getElementById('gcode-confirm')?.addEventListener('click', () => {
    const settings = {
      printerType: document.getElementById('printer-type').value,
      layerHeight: parseFloat(document.getElementById('layer-height').value),
      printSpeed: parseInt(document.getElementById('print-speed').value),
      nozzleTemp: parseInt(document.getElementById('nozzle-temp').value),
      bedTemp: parseInt(document.getElementById('bed-temp').value),
      infill: parseInt(document.getElementById('infill').value),
      nozzleSize: parseFloat(document.getElementById('nozzle-size').value),
      supports: document.getElementById('supports').value
    };
    
    AppState.gcodeSettings = settings;
    modal.style.display = 'none';
    
    Exporter.exportFormat('gcode', AppState.modelData.mesh, settings);
  }, { once: true });
}

function resetWelcomeButton() {
  const btn = document.getElementById('btn-start');
  if (btn) {
    btn.innerHTML = '<span class="btn-icon">🚀</span> Начать сканирование';
    btn.disabled = false;
  }
}

// ===== КЛАВИАТУРНЫЕ СОКРАЩЕНИЯ =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideModal();
  if (e.key === ' ' && AppState.currentScreen === 'scan') {
    Scanner.captureFrame();
    showCaptureFlash();
  }
});

// ===== ПРЕДОТВРАТИТЬ ЗАКРЫТИЕ =====
window.addEventListener('beforeunload', (e) => {
  if (AppState.scanData || AppState.modelData) {
    e.preventDefault();
    e.returnValue = 'У вас есть несохранённые данные. Покинуть страницу?';
  }
});

console.log('✅ App.js загружен');
