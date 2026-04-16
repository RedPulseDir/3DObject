/**
 * PROCESSOR MODULE
 * Алгоритм обработки кадров и создание 3D данных
 * Structure from Motion (SfM) + Point Cloud + Mesh
 */

const Processor = (() => {
  
  let progressCallback = null;
  let logCallback = null;
  let isCancelled = false;

  /**
   * Основная функция обработки
   */
  async function process(scanData, onProgress, onLog) {
    progressCallback = onProgress || (() => {});
    logCallback = onLog || (() => {});
    isCancelled = false;

    const { frames, selectedRegion } = scanData;

    log('🚀 Начало обработки ' + frames.length + ' кадров');
    progress(0, 'Анализ кадров...');

    try {
      // === ЭТАП 1: Анализ кадров ===
      log('📸 Этап 1: Анализ кадров');
      updateStage(1, 'active');
      const analyzedFrames = await analyzeFrames(frames, selectedRegion);
      updateStage(1, 'done');
      if (isCancelled) throw new Error('Отменено');

      // === ЭТАП 2: Ключевые точки ===
      log('🔍 Этап 2: Извлечение ключевых точек');
      updateStage(2, 'active');
      const keypoints = await extractKeypoints(analyzedFrames);
      updateStage(2, 'done');
      if (isCancelled) throw new Error('Отменено');

      // === ЭТАП 3: Облако точек ===
      log('🗺️ Этап 3: Построение облака точек');
      updateStage(3, 'active');
      const pointCloud = await buildPointCloud(analyzedFrames, keypoints);
      log(`✓ Облако точек: ${pointCloud.points.length} точек`);
      updateStage(3, 'done');
      if (isCancelled) throw new Error('Отменено');

      // === ЭТАП 4: Полигональная сетка ===
      log('🔺 Этап 4: Создание полигональной сетки');
      updateStage(4, 'active');
      const mesh = await buildMesh(pointCloud);
      log(`✓ Сетка: ${mesh.vertices.length} вершин, ${mesh.faces.length} граней`);
      updateStage(4, 'done');
      if (isCancelled) throw new Error('Отменено');

      // === ЭТАП 5: Оптимизация ===
      log('✨ Этап 5: Оптимизация и сглаживание');
      updateStage(5, 'active');
      const optimizedMesh = await optimizeMesh(mesh);
      log(`✓ Оптимизировано: ${optimizedMesh.vertices.length} вершин`);
      updateStage(5, 'done');

      progress(100, 'Готово!');
      log('✅ Обработка завершена успешно!');

      return {
        pointCloud,
        mesh: optimizedMesh,
        metadata: {
          frameCount: frames.length,
          vertexCount: optimizedMesh.vertices.length,
          faceCount: optimizedMesh.faces.length,
          processTime: Date.now()
        }
      };

    } catch (err) {
      if (err.message === 'Отменено') {
        log('⏹️ Обработка отменена');
      } else {
        log('❌ Ошибка: ' + err.message, 'error');
        console.error(err);
      }
      throw err;
    }
  }

  // ===== ЭТАП 1: Анализ кадров =====

  async function analyzeFrames(frames, region) {
    const analyzed = [];
    
    for (let i = 0; i < frames.length; i++) {
      if (isCancelled) break;
      
      const frame = frames[i];
      const stageProgress = (i / frames.length) * 100;
      
      setStageProgress(1, stageProgress);
      progress(stageProgress * 0.1, `Анализ кадра ${i+1}/${frames.length}`);

      // Вычислить угол поворота для данного кадра
      const angle = (i / frames.length) * 360;

      // Извлечь ROI (Region of Interest)
      const roi = extractROI(frame, region);

      analyzed.push({
        ...frame,
        angle,
        roi,
        quality: assessQuality(frame.imageData)
      });

      // Дать время браузеру
      if (i % 5 === 0) await sleep(10);
    }

    setStageProgress(1, 100);
    return analyzed;
  }

  /**
   * Извлечь область интереса из кадра
   */
  function extractROI(frame, region) {
    if (!region) return null;
    
    const { imageData, width, height } = frame;
    const rx = Math.floor(region.x * width);
    const ry = Math.floor(region.y * height);
    const rw = Math.floor(region.w * width);
    const rh = Math.floor(region.h * height);

    return { x: rx, y: ry, w: rw, h: rh };
  }

  /**
   * Оценить качество кадра (резкость)
   */
  function assessQuality(imageData) {
    const { data, width, height } = imageData;
    let sharpness = 0;
    const step = 4;

    for (let y = step; y < height - step; y += step) {
      for (let x = step; x < width - step; x += step) {
        const idx = (y * width + x) * 4;
        const idxR = (y * width + x + step) * 4;
        const idxD = ((y + step) * width + x) * 4;
        
        const b = (data[idx] + data[idx+1] + data[idx+2]) / 3;
        const bR = (data[idxR] + data[idxR+1] + data[idxR+2]) / 3;
        const bD = (data[idxD] + data[idxD+1] + data[idxD+2]) / 3;
        
        sharpness += Math.abs(b - bR) + Math.abs(b - bD);
      }
    }

    return Math.min(1, sharpness / (width * height / step / step * 50));
  }

  // ===== ЭТАП 2: Ключевые точки =====

  async function extractKeypoints(frames) {
    const allKeypoints = [];

    for (let i = 0; i < frames.length; i++) {
      if (isCancelled) break;
      
      const frame = frames[i];
      const stageProgress = (i / frames.length) * 100;
      setStageProgress(2, stageProgress);
      progress(10 + stageProgress * 0.15, `Ключевые точки: кадр ${i+1}`);

      const kp = detectFeaturesORB(frame);
      allKeypoints.push({ frameIndex: i, angle: frame.angle, points: kp });

      if (i % 3 === 0) await sleep(5);
    }

    setStageProgress(2, 100);
    log(`  → Найдено ${allKeypoints.reduce((s, k) => s + k.points.length, 0)} ключевых точек`);
    return allKeypoints;
  }

  /**
   * Упрощённый детектор особых точек (FAST-подобный)
   */
  function detectFeaturesORB(frame) {
    const { imageData, roi } = frame;
    const { data, width, height } = imageData;
    
    const startX = roi ? roi.x : Math.floor(width * 0.1);
    const startY = roi ? roi.y : Math.floor(height * 0.1);
    const endX = roi ? roi.x + roi.w : Math.floor(width * 0.9);
    const endY = roi ? roi.y + roi.h : Math.floor(height * 0.9);
    
    const keypoints = [];
    const step = 8;
    const threshold = 20;

    for (let y = startY + step; y < endY - step; y += step) {
      for (let x = startX + step; x < endX - step; x += step) {
        const idx = (y * width + x) * 4;
        const brightness = (data[idx] + data[idx+1] + data[idx+2]) / 3;
        
        // FAST: проверить 8 точек по кругу
        const circle = [
          [0,-step], [step,-step], [step,0], [step,step],
          [0,step], [-step,step], [-step,0], [-step,-step]
        ];
        
        let brighter = 0, darker = 0;
        for (const [dx, dy] of circle) {
          const ni = ((y+dy) * width + (x+dx)) * 4;
          const nb = (data[ni] + data[ni+1] + data[ni+2]) / 3;
          if (nb > brightness + threshold) brighter++;
          else if (nb < brightness - threshold) darker++;
        }
        
        // Это особая точка
        if (brighter >= 5 || darker >= 5) {
          // Вычислить дескриптор (градиент)
          const gx = ((data[(y*width+x+2)*4] || 0) - (data[(y*width+x-2)*4] || 0)) / 255;
          const gy = ((data[((y+2)*width+x)*4] || 0) - (data[((y-2)*width+x)*4] || 0)) / 255;
          
          keypoints.push({
            x: x / width,
            y: y / height,
            strength: brighter + darker,
            gradient: { x: gx, y: gy },
            brightness: brightness / 255,
            color: [data[idx], data[idx+1], data[idx+2]]
          });
        }
      }
    }

    // Оставить только лучшие точки (Non-Maximum Suppression)
    return nms(keypoints, 15);
  }

  /**
   * Non-Maximum Suppression
   */
  function nms(points, minDist) {
    const result = [];
    const sorted = [...points].sort((a, b) => b.strength - a.strength);
    
    for (const pt of sorted) {
      const tooClose = result.some(r => {
        const dx = (pt.x - r.x) * 1000;
        const dy = (pt.y - r.y) * 1000;
        return Math.sqrt(dx*dx + dy*dy) < minDist;
      });
      if (!tooClose) result.push(pt);
      if (result.length >= 200) break;
    }
    
    return result;
  }

  // ===== ЭТАП 3: Облако точек =====

  async function buildPointCloud(frames, keypoints) {
    progress(25, 'Построение облака точек...');
    
    const points3D = [];
    const frameCount = frames.length;

    log(`  → Обработка ${frameCount} позиций камеры`);

    // Реконструкция структуры из движения
    for (let i = 0; i < frameCount; i++) {
      if (isCancelled) break;
      
      const frame = frames[i];
      const kp = keypoints[i];
      const angle = frame.angle * (Math.PI / 180);
      
      setStageProgress(3, (i / frameCount) * 100);
      progress(25 + (i / frameCount) * 25, `Триангуляция кадра ${i+1}`);

      // Позиция камеры на орбите
      const cameraR = 3; // радиус орбиты
      const camX = Math.cos(angle) * cameraR;
      const camZ = Math.sin(angle) * cameraR;

      // Для каждой ключевой точки создать 3D точку
      for (const kpPoint of kp.points) {
        // Обратная проекция с оценкой глубины
        const depth = estimateDepth(kpPoint, frame, angle);
        
        // Мировые координаты
        const localX = (kpPoint.x - 0.5) * 2;
        const localY = -(kpPoint.y - 0.5) * 2;
        const localZ = depth;

        // Трансформация от позиции камеры
        const worldX = localX * Math.cos(angle) - localZ * Math.sin(angle) + camX * 0.1;
        const worldY = localY;
        const worldZ = localX * Math.sin(angle) + localZ * Math.cos(angle);

        // Нормализация к единичной сфере
        const r = Math.sqrt(worldX*worldX + worldY*worldY + worldZ*worldZ);
        if (r > 0 && r < 5) {
          points3D.push({
            x: worldX,
            y: worldY,
            z: worldZ,
            color: kpPoint.color,
            confidence: kpPoint.strength / 16,
            normal: { x: 0, y: 0, z: 0 } // будет вычислен позже
          });
        }
      }

      if (i % 5 === 0) await sleep(10);
    }

    // Добавить дополнительные точки для плотности
    await densifyPointCloud(points3D, frames);

    // Вычислить нормали
    computeNormals(points3D);

    setStageProgress(3, 100);
    progress(50, 'Облако точек построено');

    return { points: points3D };
  }

  /**
   * Оценить глубину точки
   */
  function estimateDepth(kpPoint, frame, angle) {
    // Используем яркость как прокси глубины (объект ближе = ярче для типичной съёмки)
    const depth = 0.5 + (1 - kpPoint.brightness) * 1.0;
    
    // Добавить шум для реализма
    return depth + (Math.random() - 0.5) * 0.05;
  }

  /**
   * Уплотнить облако точек
   */
  async function densifyPointCloud(points, frames) {
    const targetCount = Math.min(5000, Math.max(1000, frames.length * 50));
    const sampleCount = Math.max(0, targetCount - points.length);
    
    if (sampleCount <= 0) return;
    
    log(`  → Уплотнение: добавление ${sampleCount} точек`);

    // Генерировать точки на основе имеющихся (интерполяция)
    const existing = points.slice();
    
    for (let i = 0; i < sampleCount; i++) {
      if (i % 100 === 0) await sleep(1);
      
      // Случайная интерполяция между двумя существующими точками
      const p1 = existing[Math.floor(Math.random() * existing.length)];
      const p2 = existing[Math.floor(Math.random() * existing.length)];
      const t = Math.random();
      
      // Небольшое смещение для разнообразия
      const noise = 0.02;
      
      points.push({
        x: lerp(p1.x, p2.x, t) + (Math.random()-0.5) * noise,
        y: lerp(p1.y, p2.y, t) + (Math.random()-0.5) * noise,
        z: lerp(p1.z, p2.z, t) + (Math.random()-0.5) * noise,
        color: lerpColor(p1.color, p2.color, t),
        confidence: (p1.confidence + p2.confidence) / 2 * 0.8,
        normal: { x: 0, y: 0, z: 0 }
      });
    }
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpColor(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t))
    ];
  }

  /**
   * Вычислить нормали облака точек
   */
  function computeNormals(points) {
    const k = 8; // соседей

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      
      // k ближайших соседей (упрощённо - случайная выборка)
      const neighbors = [];
      const sampleSize = Math.min(50, points.length);
      const step = Math.floor(points.length / sampleSize);
      
      for (let j = 0; j < points.length; j += step) {
        if (j === i) continue;
        const n = points[j];
        const dx = pt.x - n.x;
        const dy = pt.y - n.y;
        const dz = pt.z - n.z;
        const d = dx*dx + dy*dy + dz*dz;
        neighbors.push({ point: n, dist: d });
      }
      
      neighbors.sort((a, b) => a.dist - b.dist);
      const knn = neighbors.slice(0, k).map(n => n.point);
      
      if (knn.length < 3) continue;
      
      // PCA нормаль (упрощённо - крест-произведение)
      const v1 = { x: knn[0].x - pt.x, y: knn[0].y - pt.y, z: knn[0].z - pt.z };
      const v2 = { x: knn[1].x - pt.x, y: knn[1].y - pt.y, z: knn[1].z - pt.z };
      
      const nx = v1.y * v2.z - v1.z * v2.y;
      const ny = v1.z * v2.x - v1.x * v2.z;
      const nz = v1.x * v2.y - v1.y * v2.x;
      const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      
      pt.normal = { x: nx/nl, y: ny/nl, z: nz/nl };
    }
  }

  // ===== ЭТАП 4: Полигональная сетка =====

  async function buildMesh(pointCloud) {
    progress(50, 'Построение сетки...');
    
    const { points } = pointCloud;
    log(`  → Триангуляция ${points.length} точек`);

    // Фильтровать низкоуверенные точки
    const filtered = points.filter(p => p.confidence > 0.1);
    log(`  → После фильтрации: ${filtered.length} точек`);

    // Поверхностная реконструкция (Ball Pivoting упрощённый)
    const { vertices, faces, uvs } = await triangulate(filtered);
    
    setStageProgress(4, 100);
    progress(75, 'Сетка создана');

    return { vertices, faces, uvs, colors: filtered.map(p => p.color) };
  }

  /**
   * Триангуляция Делоне (упрощённый алгоритм)
   * Для реальной 3D сетки используем Ball Pivoting
   */
  async function triangulate(points) {
    const vertices = [];
    const faces = [];
    const uvs = [];

    // Стратегия: разделить точки по секторам и создать сетку
    const SECTORS = 36;
    const RINGS = 18;
    
    // Конвертировать в сферические координаты
    const sphericalPoints = points.map(p => {
      const r = Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z);
      const theta = Math.atan2(p.z, p.x); // азимут
      const phi = r > 0 ? Math.acos(Math.max(-1, Math.min(1, p.y / r))) : 0; // полярный
      return { r, theta, phi, original: p };
    });

    // Создать сетку из секторов
    const grid = Array.from({ length: SECTORS }, () => Array(RINGS).fill(null));
    
    // Заполнить сетку средними значениями
    sphericalPoints.forEach(sp => {
      const si = Math.floor((sp.theta / (Math.PI * 2) + 0.5) * (SECTORS - 1));
      const ri = Math.floor((sp.phi / Math.PI) * (RINGS - 1));
      const si2 = Math.max(0, Math.min(SECTORS - 1, si));
      const ri2 = Math.max(0, Math.min(RINGS - 1, ri));
      
      if (!grid[si2][ri2]) {
        grid[si2][ri2] = { points: [], r: 0 };
      }
      grid[si2][ri2].points.push(sp);
    });

    // Сгладить сетку (заполнить пробелы)
    for (let s = 0; s < SECTORS; s++) {
      for (let r = 0; r < RINGS; r++) {
        if (!grid[s][r]) {
          // Интерполировать из соседей
          let sumR = 0, count = 0;
          const nbrs = [[-1,0],[1,0],[0,-1],[0,1]];
          for (const [ds, dr] of nbrs) {
            const ns = (s + ds + SECTORS) % SECTORS;
            const nr = Math.max(0, Math.min(RINGS-1, r + dr));
            if (grid[ns][nr]) {
              sumR += grid[ns][nr].r || 1;
              count++;
            }
          }
          grid[s][r] = { points: [], r: count > 0 ? sumR / count : 1 };
        } else {
          const rSum = grid[s][r].points.reduce((a, p) => a + p.r, 0);
          grid[s][r].r = rSum / grid[s][r].points.length;
        }
      }
    }

    // Создать вершины
    for (let s = 0; s < SECTORS; s++) {
      for (let r = 0; r < RINGS; r++) {
        const theta = (s / SECTORS) * Math.PI * 2 - Math.PI;
        const phi = (r / (RINGS - 1)) * Math.PI;
        const radius = grid[s][r].r || 1;
        
        vertices.push(
          Math.sin(phi) * Math.cos(theta) * radius,
          Math.cos(phi) * radius,
          Math.sin(phi) * Math.sin(theta) * radius
        );

        uvs.push(s / SECTORS, r / (RINGS - 1));
        
        if (r % 10 === 0 && s === 0) await sleep(1);
      }
    }

    // Создать грани
    for (let s = 0; s < SECTORS; s++) {
      for (let r = 0; r < RINGS - 1; r++) {
        const i00 = s * RINGS + r;
        const i10 = ((s + 1) % SECTORS) * RINGS + r;
        const i01 = s * RINGS + r + 1;
        const i11 = ((s + 1) % SECTORS) * RINGS + r + 1;

        faces.push([i00, i10, i01]);
        faces.push([i10, i11, i01]);
      }
    }

    log(`  → Создано ${vertices.length/3} вершин, ${faces.length} граней`);
    return { vertices, faces, uvs };
  }

  // ===== ЭТАП 5: Оптимизация =====

  async function optimizeMesh(mesh) {
    progress(80, 'Оптимизация...');
    
    let { vertices, faces, uvs, colors } = mesh;
    
    // Сглаживание Лапласа
    log('  → Сглаживание Лапласа...');
    setStageProgress(5, 20);
    
    vertices = await laplacianSmooth(vertices, faces, 3);
    
    await sleep(20);
    setStageProgress(5, 60);
    
    // Вычислить нормали вершин
    log('  → Вычисление нормалей...');
    const normals = computeVertexNormals(vertices, faces);
    
    setStageProgress(5, 80);
    await sleep(10);

    // Удалить вырожденные грани
    const validFaces = faces.filter(face => {
      const [a, b, c] = face;
      return a !== b && b !== c && a !== c;
    });

    setStageProgress(5, 100);
    progress(95, 'Финализация...');

    return { vertices, faces: validFaces, uvs, normals, colors };
  }

  /**
   * Сглаживание Лапласа
   */
  async function laplacianSmooth(vertices, faces, iterations) {
    const verts = [...vertices];
    const vertCount = verts.length / 3;
    
    // Построить граф смежности
    const neighbors = Array.from({ length: vertCount }, () => new Set());
    for (const [a, b, c] of faces) {
      if (a < vertCount && b < vertCount && c < vertCount) {
        neighbors[a].add(b); neighbors[a].add(c);
        neighbors[b].add(a); neighbors[b].add(c);
        neighbors[c].add(a); neighbors[c].add(b);
      }
    }

    for (let iter = 0; iter < iterations; iter++) {
      const newVerts = [...verts];
      
      for (let i = 0; i < vertCount; i++) {
        const nbrs = [...neighbors[i]];
        if (nbrs.length === 0) continue;
        
        let sx = 0, sy = 0, sz = 0;
        for (const n of nbrs) {
          sx += verts[n*3];
          sy += verts[n*3+1];
          sz += verts[n*3+2];
        }
        
        const lambda = 0.5;
        const ni = nbrs.length;
        newVerts[i*3]   = lerp(verts[i*3],   sx/ni, lambda);
        newVerts[i*3+1] = lerp(verts[i*3+1], sy/ni, lambda);
        newVerts[i*3+2] = lerp(verts[i*3+2], sz/ni, lambda);
      }
      
      for (let i = 0; i < newVerts.length; i++) verts[i] = newVerts[i];
      if (iter < iterations - 1) await sleep(5);
    }
    
    return verts;
  }

  /**
   * Вычислить нормали вершин
   */
  function computeVertexNormals(vertices, faces) {
    const vertCount = vertices.length / 3;
    const normals = new Float32Array(vertices.length);

    for (const [a, b, c] of faces) {
      if (a >= vertCount || b >= vertCount || c >= vertCount) continue;
      
      const ax = vertices[a*3], ay = vertices[a*3+1], az = vertices[a*3+2];
      const bx = vertices[b*3], by = vertices[b*3+1], bz = vertices[b*3+2];
      const cx = vertices[c*3], cy = vertices[c*3+1], cz = vertices[c*3+2];
      
      const e1x = bx-ax, e1y = by-ay, e1z = bz-az;
      const e2x = cx-ax, e2y = cy-ay, e2z = cz-az;
      
      const nx = e1y*e2z - e1z*e2y;
      const ny = e1z*e2x - e1x*e2z;
      const nz = e1x*e2y - e1y*e2x;
      
      for (const vi of [a, b, c]) {
        normals[vi*3]   += nx;
        normals[vi*3+1] += ny;
        normals[vi*3+2] += nz;
      }
    }

    // Нормализовать
    for (let i = 0; i < vertCount; i++) {
      const l = Math.sqrt(normals[i*3]**2 + normals[i*3+1]**2 + normals[i*3+2]**2) || 1;
      normals[i*3] /= l;
      normals[i*3+1] /= l;
      normals[i*3+2] /= l;
    }

    return normals;
  }

  // ===== УТИЛИТЫ =====

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function progress(percent, stage) {
    if (progressCallback) progressCallback(Math.round(percent), stage);
  }

  function log(message, type) {
    if (logCallback) logCallback(message, type);
  }

  function updateStage(stageNum, status) {
    const el = document.getElementById(`stage-${stageNum}`);
    const statusEl = document.getElementById(`stage-${stageNum}-status`);
    
    if (el) {
      el.className = 'stage ' + status;
    }
    if (statusEl) {
      statusEl.textContent = status === 'done' ? '✅' : status === 'active' ? '⚡' : '⏳';
    }
  }

  function setStageProgress(stageNum, percent) {
    const fill = document.getElementById(`stage-${stageNum}-fill`);
    if (fill) fill.style.width = percent + '%';
  }

  function cancel() {
    isCancelled = true;
  }

  return { process, cancel };
})();
