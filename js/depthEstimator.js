/**
 * DEPTH ESTIMATOR
 * Оценка карты глубины из одного изображения.
 * Использует несколько эвристик: градиент яркости, текстурный анализ,
 * атмосферная перспектива, анализ краёв, позиционные подсказки.
 */
const DepthEstimator = (() => {

  /**
   * Основная функция — создать карту глубины
   * Возвращает Float32Array [0..1], где 1 = близко, 0 = далеко
   */
  async function estimate(imageData, mask, options = {}) {
    const { width, height, data } = imageData;
    const { onProgress, objectType = 'auto' } = options;

    prog(onProgress, 5, 'Анализ градиентов...');
    const gray = toGrayscale(data, width, height);

    prog(onProgress, 20, 'Текстурный анализ...');
    const texture = analyzeTexture(gray, width, height);

    prog(onProgress, 35, 'Оценка краёв...');
    const edgeDepth = edgeBasedDepth(gray, width, height);

    prog(onProgress, 50, 'Позиционная перспектива...');
    const positional = positionalDepth(width, height, mask);

    prog(onProgress, 65, 'Цветовая глубина...');
    const colorDepth = colorBasedDepth(data, width, height);

    prog(onProgress, 78, 'Объединение карт...');
    const combined = combineDepthMaps(
      { texture, edgeDepth, positional, colorDepth },
      width, height, mask
    );

    prog(onProgress, 88, 'Сглаживание...');
    const smoothed = gaussianBlur(combined, width, height, 3);

    prog(onProgress, 95, 'Нормализация...');
    const normalized = normalize(smoothed, width, height, mask);

    prog(onProgress, 100, 'Готово');
    return normalized;
  }

  // ===== GRAYSCALE =====
  function toGrayscale(data, w, h) {
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w*h; i++) {
      gray[i] = (.299*data[i*4] + .587*data[i*4+1] + .114*data[i*4+2]) / 255;
    }
    return gray;
  }

  // ===== TEXTURE ANALYSIS =====
  // Богатая текстура = поверхность близко; гладкая = далеко
  function analyzeTexture(gray, w, h) {
    const result = new Float32Array(w * h);
    const WINDOW = 5;

    for (let y = WINDOW; y < h-WINDOW; y++) {
      for (let x = WINDOW; x < w-WINDOW; x++) {
        let sum = 0, sumSq = 0, n = 0;
        for (let dy = -WINDOW; dy <= WINDOW; dy++) {
          for (let dx = -WINDOW; dx <= WINDOW; dx++) {
            const v = gray[(y+dy)*w + (x+dx)];
            sum += v; sumSq += v*v; n++;
          }
        }
        const mean = sum / n;
        const variance = sumSq/n - mean*mean;
        result[y*w+x] = Math.sqrt(Math.max(0, variance)) * 8; // нормализованная дисперсия
      }
    }
    return result;
  }

  // ===== EDGE-BASED DEPTH =====
  // Резкие края = объект впереди
  function edgeBasedDepth(gray, w, h) {
    const result = new Float32Array(w * h);
    for (let y = 1; y < h-1; y++) {
      for (let x = 1; x < w-1; x++) {
        const dx = gray[y*w+x+1] - gray[y*w+x-1];
        const dy = gray[(y+1)*w+x] - gray[(y-1)*w+x];
        result[y*w+x] = Math.min(1, Math.sqrt(dx*dx + dy*dy) * 4);
      }
    }
    // Диффузия края вокруг
    return gaussianBlur(result, w, h, 5);
  }

  // ===== POSITIONAL DEPTH =====
  // Нижняя часть = ближе (напольная перспектива)
  // Центр = ближе (объектив)
  function positionalDepth(w, h, mask) {
    const result = new Float32Array(w * h);
    const cx = w / 2, cy = h / 2;
    const maxR = Math.sqrt(cx*cx + cy*cy);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y*w+x;
        if (!mask || mask[i] === 1) {
          // Расстояние от центра [0..1], 0=центр
          const dx = (x - cx) / cx;
          const dy = (y - cy) / cy;
          const distFromCenter = Math.sqrt(dx*dx + dy*dy) / 1.414;
          // Вертикальная позиция (нижняя = ближе)
          const vertPos = y / h;
          // Комбинация: центр ближе, низ ближе
          result[i] = 0.6*(1 - distFromCenter*0.8) + 0.4*(vertPos*0.5 + 0.25);
        }
      }
    }
    return result;
  }

  // ===== COLOR-BASED DEPTH =====
  // Тёплые насыщенные цвета = ближе (атмосферная перспектива)
  function colorBasedDepth(data, w, h) {
    const result = new Float32Array(w * h);
    for (let i = 0; i < w*h; i++) {
      const r = data[i*4]/255, g = data[i*4+1]/255, b = data[i*4+2]/255;
      // Насыщенность
      const max = Math.max(r,g,b), min = Math.min(r,g,b);
      const sat = max > 0 ? (max-min)/max : 0;
      // Яркость
      const bright = (r+g+b)/3;
      // Теплота (красный > синий)
      const warmth = (r - b + 1) / 2;
      // Высокая насыщенность + яркость = ближе
      result[i] = sat * 0.5 + bright * 0.3 + warmth * 0.2;
    }
    return result;
  }

  // ===== ОБЪЕДИНЕНИЕ КАРТ =====
  function combineDepthMaps({ texture, edgeDepth, positional, colorDepth }, w, h, mask) {
    const result = new Float32Array(w * h);
    for (let i = 0; i < w*h; i++) {
      if (mask && mask[i] === 0) { result[i] = 0; continue; }

      // Взвешенная сумма
      result[i] =
        texture[i]    * 0.30 +
        edgeDepth[i]  * 0.25 +
        positional[i] * 0.30 +
        colorDepth[i] * 0.15;
    }
    return result;
  }

  // ===== GAUSSIAN BLUR =====
  function gaussianBlur(data, w, h, sigma) {
    const result = new Float32Array(w * h);
    const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
    const kernel = makeGaussianKernel(kernelSize, sigma);

    // Горизонтальный проход
    const temp = new Float32Array(w * h);
    const half = Math.floor(kernelSize / 2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, wsum = 0;
        for (let k = 0; k < kernelSize; k++) {
          const nx = Math.max(0, Math.min(w-1, x + k - half));
          sum += data[y*w+nx] * kernel[k];
          wsum += kernel[k];
        }
        temp[y*w+x] = sum / wsum;
      }
    }
    // Вертикальный проход
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, wsum = 0;
        for (let k = 0; k < kernelSize; k++) {
          const ny = Math.max(0, Math.min(h-1, y + k - half));
          sum += temp[ny*w+x] * kernel[k];
          wsum += kernel[k];
        }
        result[y*w+x] = sum / wsum;
      }
    }
    return result;
  }

  function makeGaussianKernel(size, sigma) {
    const k = new Float32Array(size);
    const half = Math.floor(size/2);
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const x = i - half;
      k[i] = Math.exp(-(x*x)/(2*sigma*sigma));
      sum += k[i];
    }
    for (let i = 0; i < size; i++) k[i] /= sum;
    return k;
  }

  // ===== НОРМАЛИЗАЦИЯ =====
  function normalize(data, w, h, mask) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < w*h; i++) {
      if (!mask || mask[i] === 1) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
      }
    }
    const range = max - min || 1;
    const result = new Float32Array(w * h);
    for (let i = 0; i < w*h; i++) {
      if (!mask || mask[i] === 1) {
        result[i] = (data[i] - min) / range;
      }
    }
    return result;
  }

  // ===== Визуализировать карту глубины =====
  function drawDepthOnCanvas(canvas, depthMap, width, height) {
    canvas.width = Math.min(width, 200);
    canvas.height = Math.min(height, 200);
    const ctx = canvas.getContext('2d');
    const scaleX = width / canvas.width;
    const scaleY = height / canvas.height;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const sx = Math.floor(x * scaleX);
        const sy = Math.floor(y * scaleY);
        const d = depthMap[sy * width + sx];
        // Горячая цветовая карта
        const r = Math.floor(Math.max(0, Math.min(255, d * 2 * 255)));
        const g = Math.floor(Math.max(0, Math.min(255, (1 - Math.abs(d - 0.5)*2) * 255)));
        const b = Math.floor(Math.max(0, Math.min(255, (1 - d) * 2 * 255)));
        const idx = (y * canvas.width + x) * 4;
        imgData.data[idx]   = r;
        imgData.data[idx+1] = g;
        imgData.data[idx+2] = b;
        imgData.data[idx+3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function prog(cb, v, m) { if (typeof cb === 'function') cb(v, m); }

  return { estimate, drawDepthOnCanvas };
})();
