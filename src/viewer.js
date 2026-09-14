import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';

function basic3mf(buffer) {
  const archive = unzipSync(new Uint8Array(buffer));
  const modelName = Object.keys(archive).find(name => /(^|\/)3d\/.*\.model$/i.test(name));
  if (!modelName) throw new Error('No 3D model document was found.');
  const xml = new DOMParser().parseFromString(strFromU8(archive[modelName]), 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('The 3MF model document is invalid.');
  const material = () => new THREE.MeshStandardMaterial({ color: 0xeeb36e, roughness: .48, metalness: .12, side: THREE.DoubleSide });
  const definitions = new Map();
  for (const element of xml.getElementsByTagNameNS('*', 'object')) definitions.set(element.getAttribute('id'), element);
  const create = (id, stack = new Set()) => {
    if (stack.has(id)) return new THREE.Group(); stack = new Set(stack).add(id);
    const element = definitions.get(id), group = new THREE.Group(); if (!element) return group;
    const vertices = [...element.getElementsByTagNameNS('*', 'vertex')].map(v => [Number(v.getAttribute('x')), Number(v.getAttribute('y')), Number(v.getAttribute('z'))]);
    const positions = [];
    for (const triangle of element.getElementsByTagNameNS('*', 'triangle')) for (const key of ['v1', 'v2', 'v3']) { const vertex = vertices[Number(triangle.getAttribute(key))]; if (vertex?.every(Number.isFinite)) positions.push(...vertex); }
    if (positions.length) { const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals(); group.add(new THREE.Mesh(geometry, material())); }
    for (const component of element.getElementsByTagNameNS('*', 'component')) { const child = create(component.getAttribute('objectid'), stack); apply3mfTransform(child, component.getAttribute('transform')); group.add(child); }
    return group;
  };
  const result = new THREE.Group(), items = [...xml.getElementsByTagNameNS('*', 'item')];
  if (items.length) for (const item of items) { const child = create(item.getAttribute('objectid')); apply3mfTransform(child, item.getAttribute('transform')); result.add(child); }
  else for (const [id, element] of definitions) if (element.getElementsByTagNameNS('*', 'vertex').length) result.add(create(id));
  return result;
}
function apply3mfTransform(object, value) {
  if (!value) return; const n = value.trim().split(/\s+/).map(Number); if (n.length !== 12 || !n.every(Number.isFinite)) return;
  object.applyMatrix4(new THREE.Matrix4().set(n[0], n[1], n[2], n[9], n[3], n[4], n[5], n[10], n[6], n[7], n[8], n[11], 0, 0, 0, 1));
}

export class ModelViewer {
  constructor(host, status, dimensions) {
    this.host = host; this.status = status; this.dimensions = dimensions;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, .1, 10000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x394554, 2.5));
    const key = new THREE.DirectionalLight(0xffe8ca, 3); key.position.set(150, 250, 200); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8dbaff, 1.8); fill.position.set(-150, 100, -100); this.scene.add(fill);
    this.grid = new THREE.GridHelper(200, 20, 0x567088, 0x36495e); this.scene.add(this.grid);
    new ResizeObserver(() => this.resize()).observe(host);
    this.renderer.setAnimationLoop(() => { this.controls.update(); this.renderer.render(this.scene, this.camera); });
  }
  resize() { const { width, height } = this.host.getBoundingClientRect(); if (!width || !height) return; this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); }
  clear(message = '') {
    if (this.object) { this.scene.remove(this.object); this.object.traverse(obj => { obj.geometry?.dispose(); const mats = Array.isArray(obj.material) ? obj.material : [obj.material]; for (const mat of mats) { mat?.map?.dispose(); mat?.dispose(); } }); this.object = null; }
    this.status.textContent = message; this.status.hidden = !message; this.dimensions.textContent = '—';
  }
  show(buffer, type) {
    this.clear();
    let object;
    if (type === '3mf') {
      // Bound declared ZIP expansion before the loader allocates decompressed data.
      const view = new DataView(buffer); let total = 0;
      for (let offset = Math.max(0, buffer.byteLength - 65557); offset + 22 <= buffer.byteLength; offset++) {
        if (view.getUint32(offset, true) !== 0x06054b50) continue;
        let pos = view.getUint32(offset + 16, true), count = view.getUint16(offset + 10, true);
        for (let i = 0; i < count; i++) {
          if (pos + 46 > buffer.byteLength || view.getUint32(pos, true) !== 0x02014b50) break;
          total += view.getUint32(pos + 24, true);
          if (total > 512 * 1048576) throw new Error('This 3MF is too large to unpack in the browser. Export an STL from your slicer.');
          pos += 46 + view.getUint16(pos + 28, true) + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
        }
        break;
      }
      // Model textures stay within the archive; block any external asset URLs.
      const manager = new THREE.LoadingManager(); manager.setURLModifier(url => url.startsWith('blob:') || url.startsWith('data:') ? url : 'data:,');
      try { object = new ThreeMFLoader(manager).parse(buffer); }
      catch (error) { console.warn('3MF project data could not be fully loaded; using geometry fallback.', error); object = basic3mf(buffer); }
      object.traverse(child => { if (child.isMesh) { child.material.side = THREE.DoubleSide; } });
    } else {
      const geometry = new STLLoader().parse(buffer);
      if (!geometry.attributes.position?.count) throw new Error('This STL has no visible triangles.');
      geometry.computeVertexNormals();
      object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xeeb36e, roughness: .48, metalness: .12, side: THREE.DoubleSide }));
    }
    // Printing uses Z-up. Three.js uses Y-up.
    object.rotation.x = -Math.PI / 2;
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3());
    if (box.isEmpty() || ![size.x, size.y, size.z].every(Number.isFinite)) throw new Error('No supported geometry was found in this file.');
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center); object.position.y += size.y / 2;
    this.scene.add(object); this.object = object; this.size = size;
    const longest = Math.max(size.x, size.y, size.z, 1);
    this.grid.scale.setScalar(longest / 100); this.grid.position.y = -longest * .002;
    this.dimensions.textContent = `${size.x.toFixed(1)} × ${size.z.toFixed(1)} × ${size.y.toFixed(1)} ${type === '3mf' ? 'model units' : 'mm*'}`;
    this.dimensions.title = 'X × Y × Z. STL has no unit metadata; millimeters are assumed. 3MF dimensions use the coordinate units supplied to the viewer.';
    this.setWireframe(this.wireframe || false); this.fit(); this.resize();
  }
  fit() {
    if (!this.size) return;
    const radius = Math.max(this.size.length() / 2, 1);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.min(1, this.camera.aspect);
    this.controls.target.set(0, this.size.y / 2, 0);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(1, .7, 1).normalize().multiplyScalar(distance * 1.15));
    this.camera.near = Math.max(.001, radius / 1000); this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix(); this.controls.update();
  }
  setWireframe(enabled) { this.wireframe = enabled; this.object?.traverse(obj => { if (obj.isMesh) for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) material.wireframe = enabled; }); }
}
