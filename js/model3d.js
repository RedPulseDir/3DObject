/**
 * MODEL3D MODULE
 * Three.js 3D вьювер
 */

const Model3D = (() => {
  let scene, camera, renderer, controls;
  let mainMesh = null;
  let wireframeMesh = null;
  let isAutoRotating = false;
  let autoRotateRAF = null;
  let isInitialized = false;
  let currentMeshData = null;
  let pointLights = [];

  /**
   * Инициализация Three.js
   */
  function init(container) {
    const canvas = document.getElementById('three-canvas');
    if (!canvas) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    // Renderer
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080810);
    
    // Туман
    scene.fog = new THREE.FogExp2(0x080810, 0.15);

    // Camera
    camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 100);
    camera.position.set(0, 0.5, 3);

    // Controls
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.5;
    controls.maxDistance = 15;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 2;

    // Освещение
    setupLighting();

    // Grid
    setupGrid();

    // Resize
    const resizeObserver = new ResizeObserver(() => {
      const w2 = container.clientWidth;
      const h2 = container.clientHeight;
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    });
    resizeObserver.observe(container);

    // Render loop
    renderLoop();

    isInitialized = true;
    console.log('Model3D инициализирован');
  }

  /**
   * Настройка освещения
   */
  function setupLighting() {
    // Ambient
    const ambient = new THREE.AmbientLight(0x334466, 0.4);
    scene.add(ambient);

    // Главный свет
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(5, 10, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    scene.add(mainLight);

    // Цветные акценты
    const colors = [0x00f5ff, 0x7b2ff7, 0xff6b6b, 0x4ecdc4];
    const positions = [[3, 2, 3], [-3, 2, -3], [-3, -1, 3], [3, -1, -3]];
    
    colors.forEach((color, i) => {
      const light = new THREE.PointLight(color, 0.8, 10);
      light.position.set(...positions[i]);
      scene.add(light);
      pointLights.push(light);
    });

    // Hemisphere
    const hemi = new THREE.HemisphereLight(0x1a1a2e, 0x0a0a0f, 0.3);
    scene.add(hemi);
  }

  /**
   * Настройка сетки пола
   */
  function setupGrid() {
    const grid = new THREE.GridHelper(10, 20, 0x1a1a2e, 0x111122);
    grid.position.y = -1.5;
    scene.add(grid);
  }

  /**
   * Отрисовать 3D модель
   */
  function displayMesh(meshData) {
    currentMeshData = meshData;
    
    // Удалить предыдущую модель
    if (mainMesh) {
      scene.remove(mainMesh);
      mainMesh.geometry.dispose();
    }
    if (wireframeMesh) {
      scene.remove(wireframeMesh);
      wireframeMesh.geometry.dispose();
    }

    const { vertices, faces, normals, colors } = meshData;

    // Создать геометрию
    const geometry = new THREE.BufferGeometry();

    // Вершины
    const posArray = new Float32Array(vertices);
    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

    // Нормали
    if (normals && normals.length === vertices.length) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    }

    // Цвета вершин
    if (colors && colors.length > 0) {
      const colorArray = new Float32Array(vertices.length);
      const vCount = vertices.length / 3;
      for (let i = 0; i < vCount; i++) {
        const ci = i % colors.length;
        const c = colors[ci] || [200, 200, 200];
        colorArray[i*3]   = c[0] / 255;
        colorArray[i*3+1] = c[1] / 255;
        colorArray[i*3+2] = c[2] / 255;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    }

    // Индексы граней
    if (faces && faces.length > 0) {
      const indexArray = new Uint32Array(faces.flat());
      geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
    }

    // Вычислить нормали если не заданы
    if (!normals || normals.length !== vertices.length) {
      geometry.computeVertexNormals();
    }

    // Центрировать
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);

    // Нормализовать размер
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 2 / (maxDim || 1);
    geometry.scale(scale, scale, scale);

    // Материал
    const material = new THREE.MeshStandardMaterial({
      color: colors ? 0xffffff : 0x88aacc,
      vertexColors: !!(colors && colors.length > 0),
      roughness: 0.4,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    mainMesh = new THREE.Mesh(geometry, material);
    mainMesh.castShadow = true;
    mainMesh.receiveShadow = true;
    scene.add(mainMesh);

    // Wireframe
    const wfMat = new THREE.MeshBasicMaterial({
      color: 0x00f5ff,
      wireframe: true,
      opacity: 0.1,
      transparent: true
    });
    wireframeMesh = new THREE.Mesh(geometry.clone(), wfMat);
    wireframeMesh.visible = false;
    scene.add(wireframeMesh);

    // Анимация появления
    mainMesh.scale.set(0.001, 0.001, 0.001);
    animateScale(mainMesh, 1, 800);

    // Обновить инфо
    const vCount = vertices.length / 3;
    const fCount = faces ? faces.length : 0;
    
    const infoV = document.getElementById('info-vertices');
    const infoF = document.getElementById('info-faces');
    if (infoV) infoV.textContent = vCount.toLocaleString();
    if (infoF) infoF.textContent = fCount.toLocaleString();

    // Включить авто-вращение
    startAutoRotate();
  }

  /**
   * Анимация масштаба
   */
  function animateScale(mesh, targetScale, duration) {
    const start = performance.now();
    const startScale = mesh.scale.x;
    
    function update() {
      const t = Math.min(1, (performance.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
      const s = startScale + (targetScale - startScale) * eased;
      mesh.scale.set(s, s, s);
      if (t < 1) requestAnimationFrame(update);
    }
    
    requestAnimationFrame(update);
  }

  /**
   * Render loop
   */
  function renderLoop() {
    requestAnimationFrame(renderLoop);
    
    if (!renderer) return;
    
    controls.update();
    
    // Анимация огней
    const time = Date.now() * 0.001;
    pointLights.forEach((light, i) => {
      const offset = (i / pointLights.length) * Math.PI * 2;
      light.intensity = 0.5 + Math.sin(time + offset) * 0.3;
    });
    
    renderer.render(scene, camera);
  }

  // ===== УПРАВЛЕНИЕ =====

  function startAutoRotate() {
    controls.autoRotate = true;
    isAutoRotating = true;
  }

  function stopAutoRotate() {
    controls.autoRotate = false;
    isAutoRotating = false;
  }

  function toggleAutoRotate() {
    if (isAutoRotating) stopAutoRotate();
    else startAutoRotate();
  }

  function toggleWireframe() {
    if (!mainMesh || !wireframeMesh) return;
    
    if (wireframeMesh.visible && !mainMesh.visible) {
      // Показать оба
      mainMesh.visible = true;
      wireframeMesh.material.opacity = 0.15;
    } else if (wireframeMesh.material.opacity > 0.1) {
      // Только wireframe
      mainMesh.visible = false;
      wireframeMesh.visible = true;
      wireframeMesh.material.opacity = 0.8;
    } else {
      // Wireframe поверх
      wireframeMesh.visible = true;
      wireframeMesh.material.opacity = 0.3;
      mainMesh.visible = true;
    }
  }

  function setWireframeMode(enabled) {
    if (!mainMesh || !wireframeMesh) return;
    mainMesh.visible = !enabled;
    wireframeMesh.visible = enabled;
    if (enabled) wireframeMesh.material.opacity = 0.9;
  }

  function setSolidMode() {
    if (!mainMesh || !wireframeMesh) return;
    mainMesh.visible = true;
    wireframeMesh.visible = false;
  }

  function resetView() {
    camera.position.set(0, 0.5, 3);
    controls.reset();
  }

  /**
   * Экспортировать геометрию через Three.js
   */
  function getGeometry() {
    return mainMesh ? mainMesh.geometry : null;
  }

  function getMesh() {
    return mainMesh;
  }

  function getCurrentMeshData() {
    return currentMeshData;
  }

  return {
    init,
    displayMesh,
    toggleAutoRotate,
    toggleWireframe,
    setWireframeMode,
    setSolidMode,
    resetView,
    getGeometry,
    getMesh,
    getCurrentMeshData,
    get isReady() { return isInitialized; }
  };
})();
