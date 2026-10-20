/* Blend Battles — Three.js viewers (optional GLB/glTF inspection) */
import { esc } from './ui.js';

let threePromise = null;
function loadThree() {
  if (!threePromise) {
    threePromise = Promise.all([
      import('three'),
      import('/vendor/OrbitControls.js'),
      import('/vendor/GLTFLoader.js'),
    ]).then(([THREE, controls, loader]) => ({ THREE, OrbitControls: controls.OrbitControls, GLTFLoader: loader.GLTFLoader }));
  }
  return threePromise;
}

/** Procedural fallback model so the viewer is never empty in demo mode. */
function buildDemoScene(THREE, hue = 265) {
  const group = new THREE.Group();
  const c1 = new THREE.Color(`hsl(${hue}, 85%, 62%)`);
  const c2 = new THREE.Color(`hsl(${(hue + 60) % 360}, 85%, 60%)`);
  const c3 = new THREE.Color(`hsl(${(hue + 180) % 360}, 80%, 62%)`);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 2.3, 0.22, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b1b26, roughness: 0.55, metalness: 0.5 })
  );
  platform.position.y = -1.15;
  group.add(platform);

  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.05, 1),
    new THREE.MeshStandardMaterial({ color: c1, roughness: 0.3, metalness: 0.25, flatShading: true })
  );
  body.position.y = -0.05;
  group.add(body);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.55, 0.07, 16, 72),
    new THREE.MeshStandardMaterial({ color: c2, roughness: 0.2, metalness: 0.85 })
  );
  ring.rotation.x = Math.PI / 2.35;
  group.add(ring);

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 32, 32),
    new THREE.MeshStandardMaterial({ color: c3, emissive: c3, emissiveIntensity: 1.4, roughness: 0.25 })
  );
  orb.position.set(1.5, 0.95, 0.2);
  group.add(orb);

  for (let i = 0; i < 3; i++) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.34, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x8892aa, roughness: 0.4, metalness: 0.7 })
    );
    const a = (i / 3) * Math.PI * 2;
    box.position.set(Math.cos(a) * 1.9, -0.75, Math.sin(a) * 1.9);
    box.rotation.set(a, a * 0.7, 0);
    group.add(box);
  }
  group.userData.spin = true;
  return group;
}

export async function createViewer(container, { hue = 265, label = 'Demo model', autoRotate = true } = {}) {
  if (!container) return null;
  const { THREE, OrbitControls, GLTFLoader } = await loadThree();

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(3.4, 2.4, 4.6);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x20202c, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(4, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8b5cf6, 1.8);
  rim.position.set(-5, 2, -4);
  scene.add(rim);
  const warm = new THREE.PointLight(0xff8a3d, 12, 12);
  warm.position.set(2, -1, 3);
  scene.add(warm);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 1.8;
  controls.maxDistance = 14;
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = 0.75;
  controls.target.set(0, 0, 0);

  let root = buildDemoScene(THREE, hue);
  scene.add(root);
  let disposed = false;
  let triangles = 0;

  const resize = () => {
    const w = container.clientWidth || 320;
    const h = container.clientHeight || 240;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const loop = () => {
    if (disposed) return;
    requestAnimationFrame(loop);
    if (root && root.userData.spin) root.rotation.y += 0.004;
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  const api = {
    get triangles() { return triangles; },
    dispose() {
      disposed = true;
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    },
    setDemo(h) {
      scene.remove(root);
      root = buildDemoScene(THREE, h ?? hue);
      scene.add(root);
    },
    async loadGLB(url) {
      const loader = new GLTFLoader();
      const gltf = await new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
      const model = gltf.scene;
      let tris = 0;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = 3 / maxDim;
      model.scale.setScalar(scale);
      model.traverse((o) => {
        if (o.isMesh && o.geometry) {
          const idx = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position?.count || 0;
          tris += idx / 3;
        }
      });
      triangles = Math.round(tris);
      scene.remove(root);
      root = new THREE.Group();
      root.add(model);
      if (triangles > 1_500_000) {
        root.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0xb9c2da, roughness: 0.6, metalness: 0.2 }); });
      }
      scene.add(root);
      const dist = Math.max(3.2, maxDim * 1.6);
      camera.position.set(dist * 0.7, dist * 0.5, dist * 0.95);
      controls.target.set(0, 0, 0);
      controls.update();
      return { triangles, dims: size.toArray().map((n) => +n.toFixed(2)) };
    },
  };
  return api;
}

/** Full-screen GLB inspector used from the gallery. */
export async function openFullscreenViewer({ modelUrl = null, hue = 265, title = 'Model viewer', onDispose = null }) {
  const overlay = document.createElement('div');
  overlay.className = 'viewer-fs';
  overlay.innerHTML = `
    <div class="viewer-fs__bar">
      <strong style="font-size:13.5px">${esc(title)}</strong>
      <span class="pill pill--purple pill--sm">${modelUrl ? 'GLB / glTF' : 'Demo geometry'}</span>
      <span class="spacer"></span>
      <span class="note" id="fsStats"></span>
      <button class="icon-btn" id="fsClose" aria-label="Close viewer">✕</button>
    </div>
    <div class="viewer-fs__stage" id="fsStage"><div class="viewer-loader"><div class="spinner"></div><div>Starting 3D viewer…</div></div></div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');
  const stage = overlay.querySelector('#fsStage');
  const stats = overlay.querySelector('#fsStats');
  const close = () => {
    viewer?.dispose();
    overlay.remove();
    document.body.classList.remove('no-scroll');
    if (onDispose) onDispose();
  };
  overlay.querySelector('#fsClose').addEventListener('click', close);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  let viewer = null;
  try {
    viewer = await createViewer(stage, { hue, autoRotate: true });
    if (modelUrl) {
      const info = await viewer.loadGLB(modelUrl);
      stats.textContent = `${info.triangles.toLocaleString()} tris · ${info.dims.join(' × ')} units`;
    } else {
      stage.querySelector('.viewer-loader')?.remove();
      stats.textContent = 'No GLB supplied — showing demo geometry';
    }
  } catch (err) {
    stage.innerHTML = `<div class="viewer-loader" style="color:#ffb4b4;text-align:center;padding:24px">
      <div style="font-size:22px">⚠</div>
      <div><b>3D preview failed</b></div>
      <div class="note" style="max-width:380px">${esc(err.message || 'The model could not be parsed. This entry may not include a GLB, or the file is invalid.')}</div>
    </div>`;
  }
}
