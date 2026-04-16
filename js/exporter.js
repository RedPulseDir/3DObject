/**
 * EXPORTER
 * Экспорт во все форматы: STL, OBJ+MTL+PNG, GLTF/GLB, PLY, G-CODE
 */
const Exporter = (() => {

  function download(content, filename, mime) {
    const isBuffer = content instanceof ArrayBuffer || content instanceof Uint8Array || content instanceof Float32Array;
    const blob = isBuffer
      ? new Blob([content], { type: mime || 'application/octet-stream' })
      : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ===== STL BINARY =====
  function exportSTL(meshData) {
    const { vertices, faces } = meshData;
    const buf = new ArrayBuffer(84 + faces.length * 50);
    const view = new DataView(buf);
    const hdr = 'AI 3D Creator - STL Export';
    for (let i=0;i<80;i++) view.setUint8(i, i<hdr.length ? hdr.charCodeAt(i) : 0);
    view.setUint32(80, faces.length, true);
    let off = 84;
    for (const [a,b,c] of faces) {
      const max = vertices.length/3;
      if (a>=max||b>=max||c>=max) { off+=50; continue; }
      const ax=vertices[a*3],ay=vertices[a*3+1],az=vertices[a*3+2];
      const bx=vertices[b*3],by=vertices[b*3+1],bz=vertices[b*3+2];
      const cx=vertices[c*3],cy=vertices[c*3+1],cz=vertices[c*3+2];
      const e1x=bx-ax,e1y=by-ay,e1z=bz-az;
      const e2x=cx-ax,e2y=cy-ay,e2z=cz-az;
      let nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x;
      const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      nx/=nl; ny/=nl; nz/=nl;
      view.setFloat32(off,nx,true);off+=4;
      view.setFloat32(off,ny,true);off+=4;
      view.setFloat32(off,nz,true);off+=4;
      for (const vi of [a,b,c]) {
        view.setFloat32(off,vertices[vi*3],true);off+=4;
        view.setFloat32(off,vertices[vi*3+1],true);off+=4;
        view.setFloat32(off,vertices[vi*3+2],true);off+=4;
      }
      view.setUint16(off,0,true);off+=2;
    }
    download(buf, 'ai_3d_model.stl', 'model/stl');
    showToast('STL скачан ✓', 'ok');
  }

  // ===== OBJ + MTL + PNG TEXTURE =====
  function exportOBJ(meshData, textureData) {
    const { vertices, faces, normals, uvs } = meshData;
    let obj = `# AI 3D Creator\nmtllib ai_3d_model.mtl\no AI_Object\n\n`;

    for (let i=0;i<vertices.length;i+=3)
      obj += `v ${vertices[i].toFixed(6)} ${vertices[i+1].toFixed(6)} ${vertices[i+2].toFixed(6)}\n`;

    if (uvs) {
      obj += '\n';
      for (let i=0;i<uvs.length;i+=2)
        obj += `vt ${uvs[i].toFixed(6)} ${uvs[i+1].toFixed(6)}\n`;
    }

    if (normals) {
      obj += '\n';
      for (let i=0;i<normals.length;i+=3)
        obj += `vn ${normals[i].toFixed(6)} ${normals[i+1].toFixed(6)} ${normals[i+2].toFixed(6)}\n`;
    }

    obj += '\nusemtl AI_Material\n';
    for (const [a,b,c] of faces) {
      if (uvs && normals)
        obj += `f ${a+1}/${a+1}/${a+1} ${b+1}/${b+1}/${b+1} ${c+1}/${c+1}/${c+1}\n`;
      else
        obj += `f ${a+1} ${b+1} ${c+1}\n`;
    }

    const mtl = `newmtl AI_Material\nKa 0.1 0.1 0.1\nKd 1.0 1.0 1.0\nKs 0.2 0.2 0.2\nNs 50\nd 1.0\nillum 2\nmap_Kd ai_3d_texture.png\n`;

    download(obj, 'ai_3d_model.obj');
    setTimeout(() => download(mtl, 'ai_3d_model.mtl'), 300);

    if (textureData?.dataURL) {
      // Скачать текстуру
      const a2 = document.createElement('a');
      a2.href = textureData.dataURL;
      a2.download = 'ai_3d_texture.png';
      setTimeout(() => a2.click(), 600);
    }

    showToast('OBJ + MTL + PNG скачаны ✓', 'ok');
  }

  // ===== PLY =====
  function exportPLY(meshData) {
    const { vertices, faces, normals } = meshData;
    const vn = vertices.length/3, fn = faces.length;
    let ply = `ply\nformat ascii 1.0\ncomment AI 3D Creator\nelement vertex ${vn}\n`;
    ply += `property float x\nproperty float y\nproperty float z\n`;
    if (normals) ply += `property float nx\nproperty float ny\nproperty float nz\n`;
    ply += `element face ${fn}\nproperty list uchar int vertex_indices\nend_header\n`;

    for (let i=0;i<vn;i++) {
      ply += `${vertices[i*3].toFixed(6)} ${vertices[i*3+1].toFixed(6)} ${vertices[i*3+2].toFixed(6)}`;
      if (normals) ply += ` ${normals[i*3].toFixed(6)} ${normals[i*3+1].toFixed(6)} ${normals[i*3+2].toFixed(6)}`;
      ply += '\n';
    }
    for (const [a,b,c] of faces) ply += `3 ${a} ${b} ${c}\n`;

    download(ply, 'ai_3d_model.ply');
    showToast('PLY скачан ✓', 'ok');
  }

  // ===== GLTF/GLB =====
  function exportGLTF(meshData, textureData) {
    const { vertices, faces, normals, uvs } = meshData;

    // Бинарные буферы
    const vertBuf = new Float32Array(vertices);
    const idxBuf  = new Uint32Array(faces.flat());
    const normBuf = normals ? new Float32Array(normals) : null;
    const uvBuf   = uvs ? new Float32Array(uvs) : null;

    // Собрать буфер данных
    const parts = [vertBuf, normBuf, uvBuf, idxBuf].filter(Boolean);
    const totalBytes = parts.reduce((s,p)=>s+p.byteLength,0);
    const binBuf = new ArrayBuffer(totalBytes);
    const binView = new Uint8Array(binBuf);
    const bufferViews = [];
    let offset = 0;

    for (const part of parts) {
      binView.set(new Uint8Array(part.buffer), offset);
      bufferViews.push({ offset, length: part.byteLength });
      offset += part.byteLength;
    }

    let bvIdx = 0;
    const vertBV = bvIdx++;
    const normBV = normBuf ? bvIdx++ : -1;
    const uvBV   = uvBuf ? bvIdx++ : -1;
    const idxBV  = bvIdx++;

    // Bounding box для accessors
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for (let i=0;i<vertices.length/3;i++) {
      const x=vertices[i*3],y=vertices[i*3+1],z=vertices[i*3+2];
      if(x<minX)minX=x; if(x>maxX)maxX=x;
      if(y<minY)minY=y; if(y>maxY)maxY=y;
      if(z<minZ)minZ=z; if(z>maxZ)maxZ=z;
    }

    const accessors = [
      { bufferView:vertBV, componentType:5126, count:vertices.length/3, type:'VEC3',
        min:[minX,minY,minZ], max:[maxX,maxY,maxZ] }
    ];
    if (normBV>=0) accessors.push({ bufferView:normBV, componentType:5126, count:normals.length/3, type:'VEC3' });
    if (uvBV>=0)   accessors.push({ bufferView:uvBV,   componentType:5126, count:uvs.length/2,     type:'VEC2' });
    accessors.push({ bufferView:idxBV, componentType:5125, count:faces.length*3, type:'SCALAR' });

    let accIdx = 0;
    const posAcc  = accIdx++;
    const normAcc = normBuf ? accIdx++ : -1;
    const uvAcc   = uvBuf  ? accIdx++ : -1;
    const idxAcc  = accIdx++;

    const attrs = { POSITION: posAcc };
    if (normAcc>=0) attrs.NORMAL = normAcc;
    if (uvAcc>=0)   attrs.TEXCOORD_0 = uvAcc;

    const gltf = {
      asset: { version:'2.0', generator:'AI 3D Creator' },
      scene: 0,
      scenes: [{ nodes:[0] }],
      nodes: [{ mesh:0, name:'AI_Object' }],
      meshes: [{
        name: 'AI_Mesh',
        primitives: [{ attributes:attrs, indices:idxAcc, mode:4, material:0 }]
      }],
      materials: [{
        name: 'AI_Material',
        pbrMetallicRoughness: {
          baseColorFactor: [1,1,1,1],
          metallicFactor: 0.1,
          roughnessFactor: 0.6,
          ...(textureData ? { baseColorTexture:{ index:0 } } : {})
        },
        doubleSided: true
      }],
      accessors,
      bufferViews: bufferViews.map(bv => ({
        buffer:0, byteOffset:bv.offset, byteLength:bv.length,
        target: bv === bufferViews[bufferViews.length-1] ? 34963 : 34962
      })),
      buffers: [{ byteLength: totalBytes }]
    };

    if (textureData?.dataURL) {
      gltf.images = [{ uri: 'ai_3d_texture.png' }];
      gltf.textures = [{ source: 0 }];
    }

    // GLB упаковка
    const jsonStr = JSON.stringify(gltf);
    const jsonPad = jsonStr + ' '.repeat((4-(jsonStr.length%4))%4);
    const jsonEnc = new TextEncoder().encode(jsonPad);
    const binPad  = totalBytes % 4 !== 0 ? 4 - totalBytes%4 : 0;
    const total   = 12 + 8 + jsonEnc.length + 8 + totalBytes + binPad;

    const glb = new ArrayBuffer(total);
    const dv  = new DataView(glb);
    const u8  = new Uint8Array(glb);

    dv.setUint32(0, 0x46546C67, true); // glTF
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);

    dv.setUint32(12, jsonEnc.length, true);
    dv.setUint32(16, 0x4E4F534A, true); // JSON
    u8.set(jsonEnc, 20);

    const binStart = 20 + jsonEnc.length;
    dv.setUint32(binStart, totalBytes + binPad, true);
    dv.setUint32(binStart+4, 0x004E4942, true); // BIN
    u8.set(new Uint8Array(binBuf), binStart+8);

    download(glb, 'ai_3d_model.glb', 'model/gltf-binary');
    if (textureData?.dataURL) {
      const a2 = document.createElement('a');
      a2.href = textureData.dataURL;
      a2.download = 'ai_3d_texture.png';
      setTimeout(() => a2.click(), 400);
    }
    showToast('GLB + текстура скачаны ✓', 'ok');
  }

  // ===== G-CODE =====
  function exportGCODE(meshData, settings = {}) {
    const {
      layerHeight=0.2, printSpeed=60,
      nozzleTemp=210, bedTemp=60,
      infill=20, nozzleSize=0.4
    } = settings;

    const { vertices, faces } = meshData;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for (let i=0;i<vertices.length/3;i++) {
      const x=vertices[i*3],y=vertices[i*3+1],z=vertices[i*3+2];
      if(x<minX)minX=x;if(x>maxX)maxX=x;
      if(y<minY)minY=y;if(y>maxY)maxY=y;
      if(z<minZ)minZ=z;if(z>maxZ)maxZ=z;
    }

    const sX=(maxX-minX)*10, sY=(maxY-minY)*10, sZ=(maxZ-minZ)*10;
    const layers = Math.ceil(sZ / layerHeight);
    const cx=110, cy=110;

    let g = `;--- AI 3D Creator G-CODE ---\n`;
    g += `;${new Date().toISOString()}\n`;
    g += `;Size: ${sX.toFixed(1)}x${sY.toFixed(1)}x${sZ.toFixed(1)}mm, Layers:${layers}\n\n`;
    g += `M82\nG28\nG29\n`;
    g += `M104 S${nozzleTemp}\nM140 S${bedTemp}\n`;
    g += `M109 S${nozzleTemp}\nM190 S${bedTemp}\n`;
    g += `G92 E0\nG1 Z5 F3000\nG1 X5 Y5 F5000\nG1 Z0.3 F3000\n`;
    g += `G1 X60 E12 F1500\nG92 E0\nG1 Z5 F3000\n\n`;

    let E = 0;
    const eMult = nozzleSize * layerHeight * 1.1;

    for (let layer=0; layer<layers; layer++) {
      const z = (layer+1)*layerHeight;
      const spd = layer===0 ? Math.round(printSpeed*0.5) : printSpeed;
      g += `\n;Layer ${layer+1}/${layers} Z=${z.toFixed(3)}\n`;
      g += `G1 Z${z.toFixed(3)} F3000\n`;

      const px1=cx-sX/2, px2=cx+sX/2, py1=cy-sY/2, py2=cy+sY/2;

      // 2 периметра
      for (let p=0; p<2; p++) {
        const off = p*nozzleSize;
        const x1=px1+off, x2=px2-off, y1=py1+off, y2=py2-off;
        g += `G1 X${x1.toFixed(3)} Y${y1.toFixed(3)} F${spd*60}\n`;
        E+=sX*eMult; g+=`G1 X${x2.toFixed(3)} Y${y1.toFixed(3)} E${E.toFixed(5)} F${spd*60}\n`;
        E+=sY*eMult; g+=`G1 X${x2.toFixed(3)} Y${y2.toFixed(3)} E${E.toFixed(5)} F${spd*60}\n`;
        E+=sX*eMult; g+=`G1 X${x1.toFixed(3)} Y${y2.toFixed(3)} E${E.toFixed(5)} F${spd*60}\n`;
        E+=sY*eMult; g+=`G1 X${x1.toFixed(3)} Y${y1.toFixed(3)} E${E.toFixed(5)} F${spd*60}\n`;
      }

      // Заполнение
      const spacing = nozzleSize/(infill/100);
      if (layer%2===0) {
        let gy=py1+nozzleSize, dir=1;
        while(gy<py2-nozzleSize) {
          const sx=dir>0?px1+nozzleSize:px2-nozzleSize;
          const ex=dir>0?px2-nozzleSize:px1+nozzleSize;
          g+=`G1 X${sx.toFixed(3)} Y${gy.toFixed(3)} F${spd*60}\n`;
          E+=Math.abs(ex-sx)*eMult;
          g+=`G1 X${ex.toFixed(3)} Y${gy.toFixed(3)} E${E.toFixed(5)} F${spd*60}\n`;
          gy+=spacing; dir*=-1;
        }
      } else {
        let gx=px1+nozzleSize, dir=1;
        while(gx<px2-nozzleSize) {
          const sy=dir>0?py1+nozzleSize:py2-nozzleSize;
          const ey=dir>0?py2-nozzleSize:py1+nozzleSize;
          g+=`G1 X${gx.toFixed(3)} Y${sy.toFixed(3)} F${spd*60}\n`;
          E+=Math.abs(ey-sy)*eMult;
          g+=`G1 X${gx.toFixed(3)} Y${ey.toFixed(3)} E${E.toFixed(5)} F${spd*60}\n`;
          gx+=spacing; dir*=-1;
        }
      }
    }

    g += `\nG1 E-5 F3000\nG91\nG1 Z10 F3000\nG90\nG1 X0 Y220 F5000\n`;
    g += `M104 S0\nM140 S0\nM84\nM300 S880 P300\n`;
    g += `;Total E: ${E.toFixed(2)}mm\n;Layers: ${layers}\n`;

    download(g, 'ai_3d_model.gcode', 'text/plain');
    showToast('G-CODE скачан ✓', 'ok');
  }

  // ===== PNG TEXTURE =====
  function exportTexturePNG(textureData) {
    if (!textureData?.dataURL) { showToast('Текстура недоступна', 'err'); return; }
    const a = document.createElement('a');
    a.href = textureData.dataURL;
    a.download = 'ai_3d_texture.png';
    a.click();
    showToast('PNG текстура скачана ✓', 'ok');
  }

  function showToast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
  }

  return { exportSTL, exportOBJ, exportPLY, exportGLTF, exportGCODE, exportTexturePNG };
})();
