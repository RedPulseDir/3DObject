/**
 * VIEWER 3D
 * Three.js вьювер для отображения 3D модели с текстурой
 */
const Viewer3D = (() => {
  let scene, camera, renderer, controls;
  let mainMesh = null;
  let wireMesh = null;
  let depthMesh = null;
  let solidMesh = null;
  let currentMode = 'textured';
  let autoRotating = true;
  let isInit = false;
  let lights = [];

  function init(canvas) {
    const w = canvas.parentElement.clientWidth || window.innerWidth;
    const h = canvas.parentElement.clientHeight || window.innerHeight * 0.45;

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputEncoding = THREE.sRGBEncoding;

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510);

    // Camera
    camera = new THREE.PerspectiveCamera(55, w / h, 0.01, 100);
    camera.position.set(0, 1.5, 3.5);

    // Controls
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.5;
    controls.maxDistance = 12;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;
    controls.enablePan = true;

    // Освещение
    setupLighting();

    // Пол с отражением
    setupFloor();

    // Resize
    const ro = new ResizeObserver(() => {
      const w2 = canvas.parentElement.clientWidth;
      const h2 = canvas.parentElement.clientHeight;
      if (w2 > 0 && h2 > 0) {
        camera.aspect = w2 / h2;
        camera.updateProjectionMatrix();
        renderer.setSize(w2, h2);
      }
    });
    ro.observe(canvas.parentElement);

    // Render loop
    loop();
    isInit = true;
    console.log('Viewer3D инициализирован');
  }

  function setupLighting() {
    // Ambient мягкий
    scene.add(new THREE.AmbientLight(0x223366, 0.5));

    // Основной свет сверху
    const main = new THREE.DirectionalLight(0xffffff, 1.5);
    main.position.set(3, 8, 5);
    main.castShadow = true;
    main.shadow.mapSize.set(2048, 2048);
    main.shadow.camera.near = 0.1;
    main.shadow.camera.far = 50;
    main.shadow.bias = -0.001;
    scene.add(main);
    lights.push(main);

    // Заполняющий свет слева
    const fill = new THREE.DirectionalLight(0x4488ff, 0.6);
    fill.position.set(-5, 3, -2);
    scene.add(fill);
    lights.push(fill);

    // Контровой свет
    const back = new THREE.DirectionalLight(0xffaaff, 0.4);
    back.position.set(0, -3, -5);
    scene.add(back);
    lights.push(back);

    // Цветные point lights для атмосферы
    const pl1 = new THREE.PointLight(0x00f5ff, 0.8, 10);
    pl1.position.set(4, 4, 4);
    scene.add(pl1);

    const pl2 = new THREE.PointLight(0x7b2ff7, 0.6, 8);
    pl2.position.set(-4, 2, -4);
    scene.add(pl2);
  }

  function setupFloor() {
    const geo = new THREE.PlaneGeometry(20, 20);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x080820,
      roughness: 0.8,
      metalness: 0.1
    });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    scene.add(floor);

    // Сетка
    const grid = new THREE.GridHelper(20, 40, 0x1a1a3a, 0x0e0e20);
    grid.position.y = 0;
    scene.add(grid);
  }

  function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }

  /**
   * Показать 3D модель
   */
  function displayModel(meshData, textureData) {
    // Очистить старое
    clearMeshes();

    const { vertices, faces, normals, uvs } = meshData;

    // Геометрия
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    if (normals) geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (uvs) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const indexArr = new Uint32Array(faces.flat());
    geo.setIndex(new THREE.BufferAttribute(indexArr, 1));

    if (!normals) geo.computeVertexNormals();
    geo.computeBoundingBox();

    // ===== ТЕКСТУРИРОВАННЫЙ =====
    let material;
    if (textureData && textureData.dataURL) {
      material = TextureMapper.createThreeMaterial(textureData, THREE);
    } else {
      material = new THREE.MeshStandardMaterial({
        color: 0x88aadd, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide
      });
    }

    mainMesh = new THREE.Mesh(geo, material);
    mainMesh.castShadow = true;
    mainMesh.receiveShadow = true;
    scene.add(mainMesh);

    // ===== WIREFRAME =====
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00f5ff, wireframe: true, opacity: 0.3, transparent: true
    });
    wireMesh = new THREE.Mesh(geo.clone(), wireMat);
    wireMesh.visible = false;
    scene.add(wireMesh);

    // ===== SOLID =====
    const solidMat = new THREE.MeshPhongMaterial({
      color: 0x99bbdd, shininess: 60, specular: 0x334455, side: THREE.DoubleSide
    });
    solidMesh = new THREE.Mesh(geo.clone(), solidMat);
    solidMesh.visible = false;
    solidMesh.castShadow = true;
    scene.add(solidMesh);

    // ===== DEPTH ВИЗУАЛИЗАЦИЯ =====
    const depthGeo = geo.clone();
    const vCount = vertices.length / 3;
    const depthColors = new Float32Array(vCount * 3);
    for (let i = 0; i < vCount; i++) {
      const z = vertices[i*3+2];
      const d = Math.max(0, Math.min(1, z));
      depthColors[i*3]   = d;
      depthColors[i*3+1] = 1 - Math.abs(d-0.5)*2;
      depthColors[i*3+2] = 1 - d;
    }
    depthGeo.setAttribute('color', new THREE.BufferAttribute(depthColors, 3));
    const depthMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    depthMesh = new THREE.Mesh(depthGeo, depthMat);
    depthMesh.visible = false;
    scene.add(depthMesh);

    // Камера на модель
    fitCamera();

    // Анимация появления
    animateIn(mainMesh);

    // Обновить статистику
    const verts = vertices.length / 3;
    const faceCnt = faces.length;
    updateStats(verts, faceCnt);

    return { verts, faces: faceCnt };
  }

  function animateIn(mesh) {
    mesh.scale.set(0.001, 0.001, 0.001);
    const start = performance.now();
    function a() {
      const t = Math.min(1, (performance.now()-start)/700);
      const e = 1-Math.pow(1-t,3);
      mesh.scale.setScalar(e);
      if (t<1) requestAnimationFrame(a);
    }
    requestAnimationFrame(a);
  }

  function fitCamera() {
    if (!mainMesh) return;
    const box = new THREE.Box3().setFromObject(mainMesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(center.x, center.y + maxDim * 0.5, center.z + maxDim * 2);
    controls.target.copy(center);
    controls.update();
  }

  function clearMeshes() {
    for (const m of [mainMesh, wireMesh, solidMesh, depthMesh]) {
      if (m) { scene.remove(m); m.geometry.dispose(); }
    }
    mainMesh = wireMesh = solidMesh = depthMesh = null;
  }

  function setMode(mode) {
    currentMode = mode;
    if (!mainMesh) return;
    mainMesh.visible  = (mode === 'textured');
    wireMesh.visible  = (mode === 'wireframe');
    solidMesh.visible = (mode === 'solid');
    depthMesh.visible = (mode === 'depth');
  }

  function toggleAutoRotate() {
    autoRotating = !autoRotating;
    controls.autoRotate = autoRotating;
    return autoRotating;
  }

  function resetView() { fitCamera(); }

  function zoomIn()  { camera.position.multiplyScalar(0.85); }
  function zoomOut() { camera.position.multiplyScalar(1.15); }

  function updateStats(verts, faceCount) {
    const vEl = document.querySelector('#vio-verts .vio-val');
    const fEl = document.querySelector('#vio-faces .vio-val');
    if (vEl) vEl.textContent = verts.toLocaleString();
    if (fEl) fEl.textContent = faceCount.toLocaleString();
  }

  function getMesh() { return mainMesh; }
  function getScene() { return scene; }
  function getCamera() { return camera; }

  return {
    init, displayModel, setMode,
    toggleAutoRotate, resetView, zoomIn, zoomOut,
    getMesh, getScene, getCamera,
    get isReady() { return isInit; },
    get currentMode() { return currentMode; }
  };
})();
