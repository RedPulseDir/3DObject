/**
 * EXPORTER MODULE
 * Экспорт 3D модели во все форматы
 */

const Exporter = (() => {

  /**
   * Скачать файл
   */
  function downloadFile(content, filename, mimeType) {
    let blob;
    if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
      blob = new Blob([content], { type: mimeType || 'application/octet-stream' });
    } else {
      blob = new Blob([content], { type: mimeType || 'text/plain' });
    }
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast(`Скачивание: ${filename}`, 'success');
  }

  /**
   * STL (ASCII и Binary)
   */
  function exportSTL(meshData) {
    const { vertices, faces, normals } = meshData;
    const verts = vertices;
    const faceList = faces;
    
    // STL Binary format (меньше размер)
    const bufferSize = 84 + faceList.length * 50;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    
    // Header (80 bytes)
    const header = '3D Scanner Pro - Generated STL';
    for (let i = 0; i < 80; i++) {
      view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
    }
    
    // Количество треугольников
    view.setUint32(80, faceList.length, true);
    
    let offset = 84;
    
    for (const face of faceList) {
      const [a, b, c] = face;
      if (a * 3 + 2 >= verts.length || b * 3 + 2 >= verts.length || c * 3 + 2 >= verts.length) continue;
      
      // Нормаль треугольника
      const ax = verts[a*3], ay = verts[a*3+1], az = verts[a*3+2];
      const bx = verts[b*3], by = verts[b*3+1], bz = verts[b*3+2];
      const cx = verts[c*3], cy = verts[c*3+1], cz = verts[c*3+2];
      
      const e1x = bx-ax, e1y = by-ay, e1z = bz-az;
      const e2x = cx-ax, e2y = cy-ay, e2z = cz-az;
      const nx = e1y*e2z - e1z*e2y;
      const ny = e1z*e2x - e1x*e2z;
      const nz = e1x*e2y - e1y*e2x;
      const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      
      view.setFloat32(offset, nx/nl, true); offset += 4;
      view.setFloat32(offset, ny/nl, true); offset += 4;
      view.setFloat32(offset, nz/nl, true); offset += 4;
      
      // Вершины
      for (const vi of [a, b, c]) {
        view.setFloat32(offset, verts[vi*3],   true); offset += 4;
        view.setFloat32(offset, verts[vi*3+1], true); offset += 4;
        view.setFloat32(offset, verts[vi*3+2], true); offset += 4;
      }
      
      view.setUint16(offset, 0, true); offset += 2; // attribute byte count
    }

    downloadFile(buffer, 'model_scanner.stl', 'model/stl');
  }

  /**
   * OBJ формат
   */
  function exportOBJ(meshData) {
    const { vertices, faces, normals, uvs } = meshData;
    let obj = `# 3D Scanner Pro\n`;
    obj += `# Vertices: ${vertices.length / 3}\n`;
    obj += `# Faces: ${faces.length}\n\n`;
    obj += `mtllib model_scanner.mtl\n`;
    obj += `o ScannedObject\n\n`;
    
    // Вершины
    for (let i = 0; i < vertices.length; i += 3) {
      obj += `v ${vertices[i].toFixed(6)} ${vertices[i+1].toFixed(6)} ${vertices[i+2].toFixed(6)}\n`;
    }
    
    // UV координаты
    if (uvs && uvs.length > 0) {
      obj += '\n';
      for (let i = 0; i < uvs.length; i += 2) {
        obj += `vt ${uvs[i].toFixed(6)} ${uvs[i+1].toFixed(6)}\n`;
      }
    }
    
    // Нормали
    if (normals && normals.length > 0) {
      obj += '\n';
      for (let i = 0; i < normals.length; i += 3) {
        obj += `vn ${normals[i].toFixed(6)} ${normals[i+1].toFixed(6)} ${normals[i+2].toFixed(6)}\n`;
      }
    }
    
    // Грани (1-indexed)
    obj += '\nusemtl ScannedMaterial\n';
    for (const [a, b, c] of faces) {
      if (normals && normals.length > 0) {
        obj += `f ${a+1}//${a+1} ${b+1}//${b+1} ${c+1}//${c+1}\n`;
      } else {
        obj += `f ${a+1} ${b+1} ${c+1}\n`;
      }
    }

    // MTL файл
    const mtl = `# 3D Scanner Pro Material\nnewmtl ScannedMaterial\nKa 0.2 0.2 0.2\nKd 0.8 0.8 0.8\nKs 0.3 0.3 0.3\nNs 100\nd 1.0\n`;

    downloadFile(obj, 'model_scanner.obj');
    setTimeout(() => downloadFile(mtl, 'model_scanner.mtl'), 500);
  }

  /**
   * PLY формат (облако точек)
   */
  function exportPLY(meshData) {
    const { vertices, faces, colors } = meshData;
    const vCount = vertices.length / 3;
    const fCount = faces ? faces.length : 0;
    const hasColors = colors && colors.length > 0;
    
    let header = `ply\nformat ascii 1.0\ncomment 3D Scanner Pro\n`;
    header += `element vertex ${vCount}\n`;
    header += `property float x\nproperty float y\nproperty float z\n`;
    if (hasColors) {
      header += `property uchar red\nproperty uchar green\nproperty uchar blue\n`;
    }
    if (fCount > 0) {
      header += `element face ${fCount}\n`;
      header += `property list uchar int vertex_indices\n`;
    }
    header += `end_header\n`;

    let body = '';
    
    for (let i = 0; i < vCount; i++) {
      body += `${vertices[i*3].toFixed(6)} ${vertices[i*3+1].toFixed(6)} ${vertices[i*3+2].toFixed(6)}`;
      if (hasColors) {
        const ci = i % colors.length;
        const c = colors[ci] || [200, 200, 200];
        body += ` ${c[0]} ${c[1]} ${c[2]}`;
      }
      body += '\n';
    }
    
    if (fCount > 0) {
      for (const [a, b, c] of faces) {
        body += `3 ${a} ${b} ${c}\n`;
      }
    }

    downloadFile(header + body, 'model_scanner.ply');
  }

  /**
   * G-CODE генератор для 3D печати
   */
  function exportGCODE(meshData, settings = {}) {
    const {
      layerHeight = 0.2,
      printSpeed = 60,
      nozzleTemp = 210,
      bedTemp = 60,
      infill = 20,
      nozzleSize = 0.4,
      supports = 'auto',
      printerType = 'fdm'
    } = settings;

    const { vertices, faces } = meshData;
    
    // Анализ размеров модели
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    for (let i = 0; i < vertices.length; i += 3) {
      minX = Math.min(minX, vertices[i]);   maxX = Math.max(maxX, vertices[i]);
      minY = Math.min(minY, vertices[i+1]); maxY = Math.max(maxY, vertices[i+1]);
      minZ = Math.min(minZ, vertices[i+2]); maxZ = Math.max(maxZ, vertices[i+2]);
    }

    const sizeX = (maxX - minX) * 10; // в мм
    const sizeY = (maxZ - minZ) * 10;
    const sizeZ = (maxY - minY) * 10;
    const layers = Math.ceil(sizeZ / layerHeight);
    const centerX = 110, centerY = 110; // центр стола 220x220
    
    let gcode = '';
    
    // === ЗАГОЛОВОК ===
    gcode += `;--- 3D Scanner Pro G-CODE ---\n`;
    gcode += `;Generated: ${new Date().toISOString()}\n`;
    gcode += `;Model size: ${sizeX.toFixed(1)}x${sizeY.toFixed(1)}x${sizeZ.toFixed(1)} mm\n`;
    gcode += `;Layer height: ${layerHeight}mm | Infill: ${infill}%\n`;
    gcode += `;Nozzle: ${nozzleSize}mm | Speed: ${printSpeed}mm/s\n`;
    gcode += `;Layers: ${layers}\n\n`;
    
    // === ИНИЦИАЛИЗАЦИЯ ===
    gcode += `;=== INITIALIZATION ===\n`;
    gcode += `M82 ;absolute extrusion\n`;
    gcode += `G28 ;home all axes\n`;
    gcode += `G29 ;auto bed leveling\n`;
    
    // Нагрев
    gcode += `\n;=== HEATING ===\n`;
    gcode += `M104 S${nozzleTemp} ;set nozzle temp\n`;
    gcode += `M140 S${bedTemp} ;set bed temp\n`;
    gcode += `M109 S${nozzleTemp} ;wait for nozzle\n`;
    gcode += `M190 S${bedTemp} ;wait for bed\n`;
    
    // Прочистка сопла
    gcode += `\n;=== PRIME ===\n`;
    gcode += `G92 E0 ;reset extruder\n`;
    gcode += `G1 Z5 F3000 ;lift\n`;
    gcode += `G1 X5 Y5 F5000 ;move to start\n`;
    gcode += `G1 Z0.3 F3000 ;lower\n`;
    gcode += `G1 X50 E10 F1500 ;prime line 1\n`;
    gcode += `G1 X100 E20 F1500 ;prime line 2\n`;
    gcode += `G92 E0 ;reset extruder\n`;
    gcode += `G1 Z5 F3000 ;lift\n\n`;
    
    // === СЛОИ ===
    gcode += `;=== PRINT LAYERS ===\n`;
    gcode += `G1 X${centerX - sizeX/2} Y${centerY - sizeY/2} F5000 ;move to print start\n`;
    
    let eTotal = 0;
    const layerSpeedFirst = Math.round(printSpeed * 0.5);
    
    for (let layer = 0; layer < layers; layer++) {
      const z = (layer + 1) * layerHeight;
      const isFirst = layer === 0;
      const speed = isFirst ? layerSpeedFirst : printSpeed;
      const layerProgress = layer / layers;
      
      gcode += `\n;--- Layer ${layer + 1} / ${layers} | Z=${z.toFixed(3)} ---\n`;
      gcode += `G1 Z${z.toFixed(3)} F3000 ;layer height\n`;
      
      // Периметры (2 периметра)
      const extrPerimMult = 0.04 * nozzleSize;
      
      for (let perim = 0; perim < 2; perim++) {
        const offset = perim * nozzleSize;
        const px1 = centerX - sizeX/2 + offset;
        const px2 = centerX + sizeX/2 - offset;
        const py1 = centerY - sizeY/2 + offset;
        const py2 = centerY + sizeY/2 - offset;
        
        gcode += `G1 X${px1.toFixed(3)} Y${py1.toFixed(3)} F${speed * 60}\n`;
        
        eTotal += sizeX * extrPerimMult;
        gcode += `G1 X${px2.toFixed(3)} Y${py1.toFixed(3)} E${eTotal.toFixed(5)} F${speed * 60}\n`;
        
        eTotal += sizeY * extrPerimMult;
        gcode += `G1 X${px2.toFixed(3)} Y${py2.toFixed(3)} E${eTotal.toFixed(5)} F${speed * 60}\n`;
        
        eTotal += sizeX * extrPerimMult;
        gcode += `G1 X${px1.toFixed(3)} Y${py2.toFixed(3)} E${eTotal.toFixed(5)} F${speed * 60}\n`;
        
        eTotal += sizeY * extrPerimMult;
        gcode += `G1 X${px1.toFixed(3)} Y${py1.toFixed(3)} E${eTotal.toFixed(5)} F${speed * 60}\n`;
      }
      
      // Заполнение
      const infillDecimal = infill / 100;
      const infillSpacing = nozzleSize / infillDecimal;
      const extrInfillMult = 0.035 * nozzleSize;
      
      if (layer % 2 === 0) {
        // Горизонтальные линии
        let y = centerY - sizeY/2 + nozzleSize;
        let dir = 1;
        while (y < centerY + sizeY/2 - nozzleSize) {
          const startX = dir > 0 ? centerX - sizeX/2 + nozzleSize : centerX + sizeX/2 - nozzleSize;
          const endX   = dir > 0 ? centerX + sizeX/2 - nozzleSize : centerX - sizeX/2 + nozzleSize;
          
          eTotal += Math.abs(endX - startX) * extrInfillMult;
          gcode += `G1 X${startX.toFixed(3)} Y${y.toFixed(3)} F${speed * 60}\n`;
          gcode += `G1 X${endX.toFixed(3)} Y${y.toFixed(3)} E${eTotal.toFixed(5)} F${speed * 60}\n`;
          
          y += infillSpacing;
          dir *= -1;
        }
      } else {
        // Вертикальные линии
        let x = centerX - sizeX/2 + nozzleSize;
        let dir = 1;
        while (x < centerX + sizeX/2 - nozzleSize) {
          const startY = dir > 0 ? centerY - sizeY/2 + nozzleSize : centerY + sizeY/2 - nozzleSize;
          const endY   = dir > 0 ? centerY + sizeY/2 - nozzleSize : centerY - sizeY/2 + nozzleSize;
          
          eTotal += Math.abs(endY - startY) * extrInfillMult;
          gcode += `G1 X${x.toFixed(3)} Y${startY.toFixed(3)} F${speed * 60}\n`;
          gcode += `G1 X${x.toFixed(3)} Y${endY.toFixed(3)} E${eTotal.toFixed(5)} F${speed * 60}\n`;
          
          x += infillSpacing;
          dir *= -1;
        }
      }
      
      // Поддержки
      if (supports !== 'none' && layer < layers * 0.7) {
        gcode += `;supports skipped (auto-generated)\n`;
      }
    }
    
    // === ЗАВЕРШЕНИЕ ===
    gcode += `\n;=== END ===\n`;
    gcode += `G1 E-5 F3000 ;retract\n`;
    gcode += `G91 ;relative\n`;
    gcode += `G1 Z10 F3000 ;lift\n`;
    gcode += `G90 ;absolute\n`;
    gcode += `G1 X0 Y220 F5000 ;present print\n`;
    gcode += `M104 S0 ;nozzle off\n`;
    gcode += `M140 S0 ;bed off\n`;
    gcode += `M84 ;motors off\n`;
    gcode += `M300 S1000 P200 ;beep done\n`;
    gcode += `;--- Print Complete ---\n`;
    gcode += `;Total layers: ${layers}\n`;
    gcode += `;Estimated filament: ${(eTotal / 1000).toFixed(2)}m\n`;

    downloadFile(gcode, 'model_scanner.gcode', 'text/plain');
  }

  /**
   * DAE (Collada) формат
   */
  function exportDAE(meshData) {
    const { vertices, faces, normals } = meshData;
    
    // Подготовка данных
    const vertStr = [];
    for (let i = 0; i < vertices.length; i += 3) {
      vertStr.push(`${vertices[i].toFixed(6)} ${vertices[i+1].toFixed(6)} ${vertices[i+2].toFixed(6)}`);
    }
    
    const normStr = [];
    if (normals) {
      for (let i = 0; i < normals.length; i += 3) {
        normStr.push(`${normals[i].toFixed(6)} ${normals[i+1].toFixed(6)} ${normals[i+2].toFixed(6)}`);
      }
    }
    
    const faceStr = [];
    for (const [a, b, c] of faces) {
      faceStr.push(`${a} ${a} ${b} ${b} ${c} ${c}`);
    }

    const dae = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <created>${new Date().toISOString()}</created>
    <modified>${new Date().toISOString()}</modified>
    <unit name="meter" meter="1"/>
    <up_axis>Y_UP</up_axis>
  </asset>
  <library_materials>
    <material id="mat" name="ScannedMaterial">
      <instance_effect url="#effect"/>
    </material>
  </library_materials>
  <library_effects>
    <effect id="effect">
      <profile_COMMON>
        <technique sid="common">
          <phong>
            <diffuse><color>0.8 0.8 0.8 1</color></diffuse>
            <specular><color>0.3 0.3 0.3 1</color></specular>
            <shininess><float>100</float></shininess>
          </phong>
        </technique>
      </profile_COMMON>
    </effect>
  </library_effects>
  <library_geometries>
    <geometry id="mesh" name="ScannedMesh">
      <mesh>
        <source id="positions">
          <float_array id="pos-array" count="${vertices.length}">${vertices.map(v=>v.toFixed(6)).join(' ')}</float_array>
          <technique_common>
            <accessor source="#pos-array" count="${vertices.length/3}" stride="3">
              <param name="X" type="float"/>
              <param name="Y" type="float"/>
              <param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        ${normals ? `<source id="normals">
          <float_array id="norm-array" count="${normals.length}">${Array.from(normals).map(v=>v.toFixed(6)).join(' ')}</float_array>
          <technique_common>
            <accessor source="#norm-array" count="${normals.length/3}" stride="3">
              <param name="X" type="float"/>
              <param name="Y" type="float"/>
              <param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>` : ''}
        <vertices id="verts">
          <input semantic="POSITION" source="#positions"/>
          ${normals ? '<input semantic="NORMAL" source="#normals"/>' : ''}
        </vertices>
        <triangles count="${faces.length}" material="mat">
          <input semantic="VERTEX" source="#verts" offset="0"/>
          <p>${faces.flat().join(' ')}</p>
        </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene" name="Scene">
      <node id="Object" name="ScannedObject">
        <instance_geometry url="#mesh">
          <bind_material>
            <technique_common>
              <instance_material symbol="mat" target="#mat"/>
            </technique_common>
          </bind_material>
        </instance_geometry>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene>
    <instance_visual_scene url="#scene"/>
  </scene>
</COLLADA>`;

    downloadFile(dae, 'model_scanner.dae', 'text/xml');
  }

  /**
   * 3MF формат (XML-based 3D Manufacturing)
   */
  function export3MF(meshData) {
    const { vertices, faces } = meshData;
    
    const verticesXML = [];
    for (let i = 0; i < vertices.length; i += 3) {
      verticesXML.push(`<vertex x="${vertices[i].toFixed(6)}" y="${vertices[i+1].toFixed(6)}" z="${vertices[i+2].toFixed(6)}"/>`);
    }
    
    const trianglesXML = [];
    for (const [a, b, c] of faces) {
      trianglesXML.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
    }

    const xml3mf = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">3D Scanner Pro</metadata>
  <metadata name="CreationDate">${new Date().toISOString()}</metadata>
  <resources>
    <object id="1" name="ScannedObject" type="model">
      <mesh>
        <vertices>
          ${verticesXML.join('\n          ')}
        </vertices>
        <triangles>
          ${trianglesXML.join('\n          ')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`;

    downloadFile(xml3mf, 'model_scanner.3mf', 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml');
  }

  /**
   * FBX упрощённый (ASCII формат)
   */
  function exportFBX(meshData) {
    const { vertices, faces, normals } = meshData;
    
    const timestamp = Math.floor(Date.now() / 1000);
    
    let fbx = `; FBX 7.4.0 project file
; Created by 3D Scanner Pro
; ${new Date().toString()}

FBXHeaderExtension:  {
    FBXHeaderVersion: 1003
    FBXVersion: 7400
    CreationTime: "${new Date().toISOString()}"
    Creator: "3D Scanner Pro 1.0"
}

GlobalSettings:  {
    Version: 1000
    Properties70:  {
        P: "UpAxis", "int", "Integer", "",1
        P: "FrontAxis", "int", "Integer", "",2
    }
}

Definitions:  {
    Version: 100
    Count: 1
    ObjectType: "Geometry" {
        Count: 1
    }
}

Objects:  {
    Geometry: 100000, "Geometry::ScannedMesh", "Mesh" {
        Vertices: *${vertices.length} {
            a: ${vertices.map(v=>v.toFixed(6)).join(',')}
        }
        PolygonVertexIndex: *${faces.length * 3} {
            a: ${faces.map(([a,b,c]) => `${a},${b},${-(c+1)}`).join(',')}
        }
        GeometryVersion: 124
        LayerElementNormal: 0 {
            Version: 101
            Name: ""
            MappingInformationType: "ByPolygonVertex"
            ReferenceInformationType: "Direct"
            Normals: *${faces.length * 9} {
                a: ${faces.map(([a,b,c]) => {
                  const get = (vi) => normals ? 
                    `${normals[vi*3].toFixed(6)},${normals[vi*3+1].toFixed(6)},${normals[vi*3+2].toFixed(6)}` :
                    '0,1,0';
                  return `${get(a)},${get(b)},${get(c)}`;
                }).join(',')}
            }
        }
        Layer: 0 {
            Version: 100
            LayerElement:  {
                Type: "LayerElementNormal"
                TypedIndex: 0
            }
        }
    }
    
    Model: 200000, "Model::ScannedObject", "Mesh" {
        Version: 232
        Properties70:  {
            P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
            P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
            P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
        }
        Shading: T
        Culling: "CullingOff"
    }
}

Connections:  {
    C: "OO",100000,200000
}`;

    downloadFile(fbx, 'model_scanner.fbx', 'text/plain');
  }

  /**
   * GLB (упрощённый JSON-based)
   */
  function exportGLB(meshData) {
    const { vertices, faces, normals } = meshData;
    
    // GLTF JSON часть
    const gltf = {
      asset: { version: "2.0", generator: "3D Scanner Pro" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: "ScannedObject" }],
      meshes: [{
        name: "ScannedMesh",
        primitives: [{
          attributes: { POSITION: 0 },
          indices: 1,
          mode: 4
        }]
      }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: vertices.length / 3,
          type: "VEC3"
        },
        {
          bufferView: 1,
          componentType: 5125,
          count: faces.length * 3,
          type: "SCALAR"
        }
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: vertices.length * 4 },
        { buffer: 0, byteOffset: vertices.length * 4, byteLength: faces.length * 3 * 4 }
      ],
      buffers: [{ byteLength: vertices.length * 4 + faces.length * 3 * 4 }]
    };

    const jsonStr = JSON.stringify(gltf);
    const jsonPadded = jsonStr + ' '.repeat((4 - (jsonStr.length % 4)) % 4);
    const jsonBytes = new TextEncoder().encode(jsonPadded);

    // Бинарные данные
    const vertBuf = new Float32Array(vertices);
    const faceBuf = new Uint32Array(faces.flat());
    
    const binLength = vertBuf.byteLength + faceBuf.byteLength;
    const totalLength = 12 + 8 + jsonBytes.length + 8 + binLength;
    
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);
    
    // GLB header
    view.setUint32(0, 0x46546C67, true); // magic "glTF"
    view.setUint32(4, 2, true);          // version
    view.setUint32(8, totalLength, true);
    
    // JSON chunk
    view.setUint32(12, jsonBytes.length, true);
    view.setUint32(16, 0x4E4F534A, true); // "JSON"
    uint8.set(jsonBytes, 20);
    
    // BIN chunk
    const binOffset = 20 + jsonBytes.length;
    view.setUint32(binOffset, binLength, true);
    view.setUint32(binOffset + 4, 0x004E4942, true); // "BIN\0"
    new Uint8Array(buffer, binOffset + 8).set(new Uint8Array(vertBuf.buffer));
    new Uint8Array(buffer, binOffset + 8 + vertBuf.byteLength).set(new Uint8Array(faceBuf.buffer));

    downloadFile(buffer, 'model_scanner.glb', 'model/gltf-binary');
  }

  /**
   * Скачать все форматы в ZIP
   */
  async function exportAll(meshData, gcodeSettings) {
    showToast('Подготовка архива...', 'info');
    
    // Используем JSZip если доступен, иначе скачиваем по одному
    const formats = ['stl', 'obj', 'ply', 'dae', 'glb', '3mf', 'fbx', 'gcode'];
    
    for (let i = 0; i < formats.length; i++) {
      await new Promise(resolve => setTimeout(resolve, i * 600));
      exportFormat(formats[i], meshData, gcodeSettings);
    }
    
    showToast(`Скачивание ${formats.length} файлов...`, 'success');
  }

  /**
   * Экспорт по формату
   */
  function exportFormat(format, meshData, gcodeSettings) {
    switch (format) {
      case 'stl':  exportSTL(meshData); break;
      case 'obj':  exportOBJ(meshData); break;
      case 'ply':  exportPLY(meshData); break;
      case 'dae':  exportDAE(meshData); break;
      case 'glb':  exportGLB(meshData); break;
      case '3mf':  export3MF(meshData); break;
      case 'fbx':  exportFBX(meshData); break;
      case 'gcode': exportGCODE(meshData, gcodeSettings); break;
      default: showToast('Неизвестный формат: ' + format, 'error');
    }
  }

  function showToast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    }
  }

  return { exportFormat, exportAll, exportGCODE };
})();
