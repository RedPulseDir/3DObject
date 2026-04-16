/**
 * TEXTURE MAPPER
 * Создаёт реальную текстуру из исходного фото с учётом маски.
 * Убирает фон, улучшает цвет, создаёт UV-текстуру.
 */
const TextureMapper = (() => {

  /**
   * Создать текстуру для 3D модели
   */
  async function createTexture(imageData, mask, meshData, options = {}) {
    const { width, height } = imageData;
    const { textureMode = 'photo', onProgress } = options;
    const { bbox } = meshData;

    prog(onProgress, 10, 'Извлечение области объекта...');

    // Создать canvas с объектом (без фона)
    const objCanvas = document.createElement('canvas');
    const texSize = 512; // Размер текстуры

    objCanvas.width  = texSize;
    objCanvas.height = texSize;
    const ctx = objCanvas.getContext('2d');

    prog(onProgress, 30, 'Наложение маски...');

    // Нарисовать исходное изображение в bbox
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width  = width;
    tempCanvas.height = height;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.putImageData(imageData, 0, 0);

    // Вырезать bbox и масштабировать в текстуру
    ctx.save();
    ctx.clearRect(0, 0, texSize, texSize);

    // Нарисовать область объекта
    ctx.drawImage(tempCanvas,
      bbox.x, bbox.y, bbox.w, bbox.h,
      0, 0, texSize, texSize
    );

    prog(onProgress, 50, 'Применение маски...');

    // Применить маску — убрать фон
    const texData = ctx.getImageData(0, 0, texSize, texSize);
    applyMaskToTexture(texData, mask, width, height, bbox, texSize);
    ctx.putImageData(texData, 0, 0);

    prog(onProgress, 65, 'Улучшение цвета...');

    // Улучшить цвет если нужно
    if (textureMode === 'enhanced') {
      enhanceColors(texData, texSize);
      ctx.putImageData(texData, 0, 0);
    } else if (textureMode === 'smooth') {
      smoothTexture(ctx, texSize);
    }

    prog(onProgress, 80, 'Генерация боковой текстуры...');

    // Добавить интерполированные боковые цвета (для стенок)
    addSideColors(ctx, texData, texSize);

    prog(onProgress, 95, 'Финализация...');

    const finalTexData = ctx.getImageData(0, 0, texSize, texSize);

    return {
      canvas: objCanvas,
      imageData: finalTexData,
      size: texSize,
      dataURL: objCanvas.toDataURL('image/png')
    };
  }

  // ===== Применить маску к текстуре =====
  function applyMaskToTexture(texData, mask, maskW, maskH, bbox, texSize) {
    const { data, width, height } = texData;
    const scaleX = bbox.w / texSize;
    const scaleY = bbox.h / texSize;

    for (let y = 0; y < texSize; y++) {
      for (let x = 0; x < texSize; x++) {
        // Координаты в исходном изображении
        const origX = Math.floor(bbox.x + x * scaleX);
        const origY = Math.floor(bbox.y + y * scaleY);

        const ox2 = Math.max(0, Math.min(maskW-1, origX));
        const oy2 = Math.max(0, Math.min(maskH-1, origY));

        const maskVal = mask[oy2 * maskW + ox2];
        const idx = (y * texSize + x) * 4;

        if (maskVal === 0) {
          // Фон — сделать прозрачным
          data[idx+3] = 0;
        } else {
          data[idx+3] = 255;
          // Мягкое edge feathering
          const edgeDist = getEdgeDistance(x, y, texSize, texSize, mask, maskW, maskH, bbox, scaleX, scaleY);
          if (edgeDist < 3) {
            data[idx+3] = Math.floor(255 * edgeDist / 3);
          }
        }
      }
    }
  }

  function getEdgeDistance(tx, ty, texW, texH, mask, maskW, maskH, bbox, scaleX, scaleY) {
    let minDist = 10;
    for (let d = 1; d <= 3; d++) {
      for (const [dx, dy] of [[-d,0],[d,0],[0,-d],[0,d]]) {
        const nx = tx+dx, ny = ty+dy;
        if (nx<0||nx>=texW||ny<0||ny>=texH) { minDist=Math.min(minDist,d); break; }
        const ox = Math.floor(bbox.x + nx*scaleX);
        const oy = Math.floor(bbox.y + ny*scaleY);
        const ox2 = Math.max(0,Math.min(maskW-1,ox));
        const oy2 = Math.max(0,Math.min(maskH-1,oy));
        if (mask[oy2*maskW+ox2] === 0) { minDist=Math.min(minDist,d); break; }
      }
    }
    return minDist;
  }

  // ===== Улучшить цвета =====
  function enhanceColors(texData, texSize) {
    const { data } = texData;
    // Увеличить насыщенность и контраст
    for (let i = 0; i < texSize*texSize; i++) {
      if (data[i*4+3] === 0) continue;
      let r = data[i*4]/255, g = data[i*4+1]/255, b = data[i*4+2]/255;

      // Увеличить контраст
      r = (r - 0.5) * 1.3 + 0.5;
      g = (g - 0.5) * 1.3 + 0.5;
      b = (b - 0.5) * 1.3 + 0.5;

      // Насыщенность
      const gray = .299*r + .587*g + .114*b;
      r = gray + (r-gray)*1.4;
      g = gray + (g-gray)*1.4;
      b = gray + (b-gray)*1.4;

      data[i*4]   = Math.max(0,Math.min(255,r*255));
      data[i*4+1] = Math.max(0,Math.min(255,g*255));
      data[i*4+2] = Math.max(0,Math.min(255,b*255));
    }
  }

  // ===== Сглаженная текстура =====
  function smoothTexture(ctx, texSize) {
    ctx.filter = 'blur(1px)';
    ctx.drawImage(ctx.canvas, 0, 0);
    ctx.filter = 'none';
  }

  // ===== Боковые цвета =====
  function addSideColors(ctx, texData, texSize) {
    // Создать градиент из средних цветов краёв для боков
    const { data } = texData;
    let r=0,g=0,b=0,n=0;
    // Собрать средний цвет объекта
    for (let i=0; i<texSize*texSize; i++) {
      if (data[i*4+3] > 128) { r+=data[i*4]; g+=data[i*4+1]; b+=data[i*4+2]; n++; }
    }
    if (n > 0) {
      r=Math.floor(r/n); g=Math.floor(g/n); b=Math.floor(b/n);
      // Сохранить как метаданные
      ctx._avgColor = { r, g, b };
    }
  }

  /**
   * Создать Three.js материал с текстурой
   */
  function createThreeMaterial(textureData, THREE) {
    const loader = new THREE.TextureLoader();
    const texture = loader.load(textureData.dataURL);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;

    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.6,
      metalness: 0.1,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.1
    });
  }

  function prog(cb,v,m){if(typeof cb==='function')cb(v,m)}

  return { createTexture, createThreeMaterial };
})();
