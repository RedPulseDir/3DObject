/**
 * SEGMENTATION.JS
 * Сегментация объекта на фото — выделяем что важно, убираем фон.
 * Использует комбинацию: GrabCut-like алгоритм + edge detection + color clustering
 */
const Segmentation = (() => {

  /**
   * Главная функция — автоматически найти и вырезать объект
   * Возвращает маску (Uint8Array, 1 = объект, 0 = фон) и boundingBox
   */
  async function segment(imageData, options = {}) {
    const { width, height, data } = imageData;
    const { onProgress } = options;
    
    prog(onProgress, 10, 'Анализ цветов...');

    // 1. Конвертировать в LAB для лучшей цветовой сегментации
    const labData = rgbToLab(data, width, height);
    prog(onProgress, 25, 'Кластеризация...');

    // 2. K-means кластеризация (объект vs фон)
    const clusters = await kMeansClustering(labData, width, height, 4);
    prog(onProgress, 45, 'Определение объекта...');

    // 3. Найти центральный кластер (объект обычно в центре)
    const objectCluster = findObjectCluster(clusters, width, height);
    prog(onProgress, 60, 'Детектирование краёв...');

    // 4. Детектирование краёв (Canny-like)
    const edges = detectEdges(data, width, height);
    prog(onProgress, 75, 'Уточнение маски...');

    // 5. Создать финальную маску
    const mask = createMask(clusters, objectCluster, edges, width, height);
    prog(onProgress, 88, 'Заполнение дыр...');

    // 6. Морфологические операции (закрыть дыры, убрать шум)
    const cleanMask = morphologicalClose(mask, width, height, 4);
    const finalMask = removeSmallRegions(cleanMask, width, height, 200);
    prog(onProgress, 95, 'Вычисление границ...');

    // 7. Найти bounding box объекта
    const bbox = getBoundingBox(finalMask, width, height);
    prog(onProgress, 100, 'Готово');

    return { mask: finalMask, bbox, width, height };
  }

  function prog(cb, val, msg) {
    if (typeof cb === 'function') cb(val, msg);
  }

  // ===== RGB → LAB =====
  function rgbToLab(data, w, h) {
    const out = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      const r = data[i*4] / 255;
      const g = data[i*4+1] / 255;
      const b = data[i*4+2] / 255;

      // sRGB → Linear
      const rl = r > .04045 ? Math.pow((r+.055)/1.055, 2.4) : r/12.92;
      const gl = g > .04045 ? Math.pow((g+.055)/1.055, 2.4) : g/12.92;
      const bl = b > .04045 ? Math.pow((b+.055)/1.055, 2.4) : b/12.92;

      // Linear → XYZ (D65)
      let x = rl*.4124564 + gl*.3575761 + bl*.1804375;
      let y = rl*.2126729 + gl*.7151522 + bl*.0721750;
      let z = rl*.0193339 + gl*.1191920 + bl*.9503041;

      // XYZ → LAB
      x /= .95047; y /= 1.0; z /= 1.08883;
      const fx = x>.008856 ? Math.cbrt(x) : x*7.787+16/116;
      const fy = y>.008856 ? Math.cbrt(y) : y*7.787+16/116;
      const fz = z>.008856 ? Math.cbrt(z) : z*7.787+16/116;

      out[i*3]   = 116*fy - 16;   // L
      out[i*3+1] = 500*(fx - fy); // A
      out[i*3+2] = 200*(fy - fz); // B
    }
    return out;
  }

  // ===== K-MEANS =====
  async function kMeansClustering(labData, w, h, k) {
    const n = w * h;
    // Инициализация центроидов (равномерно по изображению)
    const centroids = [];
    for (let i = 0; i < k; i++) {
      const idx = Math.floor((i / k) * n);
      centroids.push([labData[idx*3], labData[idx*3+1], labData[idx*3+2]]);
    }

    const labels = new Int32Array(n);
    const ITER = 8;

    for (let iter = 0; iter < ITER; iter++) {
      // Назначить точки кластерам
      for (let i = 0; i < n; i++) {
        let best = 0, bestDist = Infinity;
        const L = labData[i*3], A = labData[i*3+1], B = labData[i*3+2];
        for (let c = 0; c < k; c++) {
          const d = (L-centroids[c][0])**2 + (A-centroids[c][1])**2 + (B-centroids[c][2])**2;
          if (d < bestDist) { bestDist = d; best = c; }
        }
        labels[i] = best;
      }

      // Обновить центроиды
      const sums = Array.from({length:k}, () => [0,0,0]);
      const counts = new Int32Array(k);
      for (let i = 0; i < n; i++) {
        const c = labels[i];
        sums[c][0] += labData[i*3];
        sums[c][1] += labData[i*3+1];
        sums[c][2] += labData[i*3+2];
        counts[c]++;
      }
      for (let c = 0; c < k; c++) {
        if (counts[c] > 0) {
          centroids[c][0] = sums[c][0] / counts[c];
          centroids[c][1] = sums[c][1] / counts[c];
          centroids[c][2] = sums[c][2] / counts[c];
        }
      }
      // yield
      if (iter % 2 === 0) await new Promise(r => setTimeout(r, 0));
    }

    return { labels, centroids, k, w, h };
  }

  // ===== Найти кластер объекта =====
  function findObjectCluster({ labels, centroids, k, w, h }) {
    // Объект обычно находится в центральной зоне изображения
    const centerZone = {
      x1: Math.floor(w * 0.2), y1: Math.floor(h * 0.15),
      x2: Math.floor(w * 0.8), y2: Math.floor(h * 0.85)
    };

    // Считаем сколько пикселей каждого кластера в центре
    const centerCount = new Float32Array(k);
    const totalCount  = new Float32Array(k);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const c = labels[idx];
        totalCount[c]++;
        if (x >= centerZone.x1 && x <= centerZone.x2 && y >= centerZone.y1 && y <= centerZone.y2) {
          centerCount[c]++;
        }
      }
    }

    // Кластер с максимальной концентрацией в центре
    let bestCluster = 0, bestScore = -1;
    for (let c = 0; c < k; c++) {
      const ratio = totalCount[c] > 0 ? centerCount[c] / totalCount[c] : 0;
      const score = ratio * (totalCount[c] / (w * h));
      if (score > bestScore) { bestScore = score; bestCluster = c; }
    }

    return bestCluster;
  }

  // ===== Детектор краёв (Sobel) =====
  function detectEdges(data, w, h) {
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      gray[i] = (.299 * data[i*4] + .587 * data[i*4+1] + .114 * data[i*4+2]) / 255;
    }

    const edges = new Float32Array(w * h);
    const sobelX = [-1,0,1,-2,0,2,-1,0,1];
    const sobelY = [-1,-2,-1,0,0,0,1,2,1];

    for (let y = 1; y < h-1; y++) {
      for (let x = 1; x < w-1; x++) {
        let gx = 0, gy = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const v = gray[(y+ky)*w + (x+kx)];
            const ki = (ky+1)*3 + (kx+1);
            gx += sobelX[ki] * v;
            gy += sobelY[ki] * v;
          }
        }
        edges[y*w+x] = Math.min(1, Math.sqrt(gx*gx + gy*gy));
      }
    }
    return edges;
  }

  // ===== Создать маску =====
  function createMask({ labels, k }, objectCluster, edges, w, h) {
    const mask = new Uint8Array(w * h);

    // Для каждого пикселя определить объект/фон
    for (let i = 0; i < w * h; i++) {
      const isObjCluster = labels[i] === objectCluster;
      const edgeStrength = edges[i];
      // Если это кластер объекта ИЛИ около сильного края
      mask[i] = (isObjCluster || edgeStrength > 0.25) ? 1 : 0;
    }

    // Seed fill от центра (убеждаемся что центр включён)
    floodFillCenter(mask, w, h);

    return mask;
  }

  // ===== Заполнение от центра =====
  function floodFillCenter(mask, w, h) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);

    // Если центральный пиксель уже в маске — хорошо
    if (mask[cy * w + cx] === 1) return;

    // Ищем ближайший маскированный пиксель к центру
    let foundX = cx, foundY = cy;
    for (let r = 1; r < Math.min(w, h) / 4; r++) {
      let found = false;
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny*w+nx] === 1) {
            foundX = nx; foundY = ny; found = true;
          }
        }
      }
      if (found) break;
    }

    // Включить центральную область принудительно
    const zone = 30;
    for (let dy = -zone; dy <= zone; dy++) {
      for (let dx = -zone; dx <= zone; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          if (Math.sqrt(dx*dx + dy*dy) < zone) mask[ny*w+nx] = 1;
        }
      }
    }
  }

  // ===== Морфологическое закрытие =====
  function morphologicalClose(mask, w, h, radius) {
    // Dilate
    const dilated = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let found = false;
        outer: for (let dy = -radius; dy <= radius && !found; dy++) {
          for (let dx = -radius; dx <= radius && !found; dx++) {
            if (dx*dx + dy*dy > radius*radius) continue;
            const nx = x+dx, ny = y+dy;
            if (nx>=0&&nx<w&&ny>=0&&ny<h && mask[ny*w+nx]===1) { found=true; }
          }
        }
        dilated[y*w+x] = found ? 1 : 0;
      }
    }
    // Erode
    const eroded = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let allSet = true;
        outer2: for (let dy = -radius; dy <= radius && allSet; dy++) {
          for (let dx = -radius; dx <= radius && allSet; dx++) {
            if (dx*dx + dy*dy > radius*radius) continue;
            const nx = x+dx, ny = y+dy;
            if (nx<0||nx>=w||ny<0||ny>=h||dilated[ny*w+nx]!==1) allSet=false;
          }
        }
        eroded[y*w+x] = allSet ? 1 : 0;
      }
    }
    return eroded;
  }

  // ===== Удалить маленькие регионы =====
  function removeSmallRegions(mask, w, h, minSize) {
    const visited = new Uint8Array(w * h);
    const result = new Uint8Array(w * h);
    
    for (let startY = 0; startY < h; startY++) {
      for (let startX = 0; startX < w; startX++) {
        const si = startY*w+startX;
        if (visited[si] || mask[si]===0) { visited[si]=1; continue; }

        // BFS для нахождения региона
        const region = [];
        const queue = [si];
        visited[si] = 1;
        while (queue.length) {
          const idx = queue.pop();
          region.push(idx);
          const x = idx % w, y = Math.floor(idx/w);
          for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nx=x+dx, ny=y+dy;
            if (nx<0||nx>=w||ny<0||ny>=h) continue;
            const ni=ny*w+nx;
            if (!visited[ni] && mask[ni]===1) { visited[ni]=1; queue.push(ni); }
          }
        }

        // Включить в результат если регион достаточно большой
        if (region.length >= minSize) {
          for (const idx of region) result[idx] = 1;
        }
      }
    }
    return result;
  }

  // ===== Bounding Box =====
  function getBoundingBox(mask, w, h) {
    let minX=w, maxX=0, minY=h, maxY=0;
    for (let y=0; y<h; y++) {
      for (let x=0; x<w; x++) {
        if (mask[y*w+x]===1) {
          if (x<minX) minX=x; if (x>maxX) maxX=x;
          if (y<minY) minY=y; if (y>maxY) maxY=y;
        }
      }
    }
    // Добавить небольшой отступ
    const pad = 5;
    return {
      x: Math.max(0, minX-pad), y: Math.max(0, minY-pad),
      w: Math.min(w, maxX+pad) - Math.max(0, minX-pad),
      h: Math.min(h, maxY+pad) - Math.max(0, minY-pad)
    };
  }

  /**
   * Применить маску к ImageData — вернуть только объект (фон прозрачный)
   */
  function applyMask(imageData, mask) {
    const result = new ImageData(imageData.width, imageData.height);
    for (let i = 0; i < imageData.width * imageData.height; i++) {
      if (mask[i] === 1) {
        result.data[i*4]   = imageData.data[i*4];
        result.data[i*4+1] = imageData.data[i*4+1];
        result.data[i*4+2] = imageData.data[i*4+2];
        result.data[i*4+3] = 255;
      } else {
        result.data[i*4+3] = 0; // прозрачный
      }
    }
    return result;
  }

  /**
   * Отрисовать маску на canvas (для визуализации)
   */
  function drawMaskOnCanvas(canvas, mask, width, height) {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const v = mask[i] === 1 ? 255 : 0;
      imgData.data[i*4]   = mask[i] === 1 ? 0 : 0;
      imgData.data[i*4+1] = mask[i] === 1 ? 245 : 0;
      imgData.data[i*4+2] = mask[i] === 1 ? 255 : 0;
      imgData.data[i*4+3] = mask[i] === 1 ? 180 : 40;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return { segment, applyMask, drawMaskOnCanvas };
})();
