import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'

const MATCH_MS = 30 * 60 * 1000
const WORLD = 180
const $ = (id) => document.getElementById(id)
const TOWN_SCALE = 2.6

const BUILDING_DEFS = [
  { id: 'ayuntamiento', name: 'Ayuntamiento', x: -28, z: -22, rotY: 0 },
  { id: 'monasterio', name: 'Monasterio', x: 26, z: -26, rotY: Math.PI * 0.08 },
  { id: 'posada', name: 'Posada', x: 8, z: 30, rotY: -Math.PI * 0.05 },
]

const TOWN_FILES = [
  'wall.glb',
  'wall-wood.glb',
  'wall-door.glb',
  'wall-wood-door.glb',
  'wall-window-shutters.glb',
  'wall-wood-window-shutters.glb',
  'wall-window-glass.glb',
  'wall-half.glb',
  'wall-corner.glb',
  'wall-wood-corner.glb',
  'wall-doorway-square.glb',
  'wall-wood-doorway-square.glb',
  'wall-arch.glb',
  'roof.glb',
  'roof-gable.glb',
  'roof-corner.glb',
  'roof-window.glb',
  'roof-point.glb',
  'chimney.glb',
  'chimney-top.glb',
  'fountain-round.glb',
  'fountain-round-detail.glb',
  'fountain-square.glb',
  'tree.glb',
  'tree-high.glb',
  'tree-crooked.glb',
  'tree-high-round.glb',
  'hedge.glb',
  'hedge-large.glb',
  'hedge-gate.glb',
  'road.glb',
  'road-corner.glb',
  'road-bend.glb',
  'stall.glb',
  'stall-red.glb',
  'stall-green.glb',
  'cart.glb',
  'fence.glb',
  'fence-gate.glb',
  'lantern.glb',
  'rock-large.glb',
  'rock-wide.glb',
  'stairs-wood.glb',
  'planks.glb',
  'banner-red.glb',
  'banner-green.glb',
]

const state = {
  running: false,
  you: null,
  foe: null,
  youHp: 100,
  foeHp: 100,
  youActions: 10,
  revealedMayor: false,
  night: 0,
  inside: null,
  nearDoor: null,
  startedAt: 0,
  timerId: null,
  move: { x: 0, z: 0 },
  modelsReady: false,
}

let renderer, scene, camera, player, clock, worldRoot, interiorRoot
let colliders = []
let doorMeshes = []
let templates = {}
let mixer = null
let playerActions = null

function show(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.remove('active')
  $(id).classList.add('active')
}

function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.style.display = 'block'
  clearTimeout(toast._t)
  toast._t = setTimeout(() => {
    t.style.display = 'none'
  }, 2200)
}

function crier(t) {
  $('crier').textContent = t
}

function makeSign(text, x, y, z, rotY) {
  const g = new THREE.Group()
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.75, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xf0e0c0 }),
  )
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 1.5, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x3a2a18 }),
  )
  post.position.y = -1
  g.add(board, post)
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f0e0c0'
  ctx.fillRect(0, 0, 256, 64)
  ctx.fillStyle = '#1a1008'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 32)
  const tex = new THREE.CanvasTexture(canvas)
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.6),
    new THREE.MeshBasicMaterial({ map: tex }),
  )
  label.position.z = 0.06
  g.add(label)
  g.position.set(x, y, z)
  g.rotation.y = rotY || 0
  return g
}

async function loadModels() {
  const loader = new GLTFLoader()
  const status = $('loadStatus')
  const jobs = [
    { key: 'xbot.glb', url: './models/xbot.glb' },
    ...TOWN_FILES.map((f) => ({ key: `town/${f}`, url: `./models/town/${f}` })),
  ]
  const total = jobs.length
  for (let i = 0; i < total; i++) {
    const job = jobs[i]
    const pct = Math.round((i / total) * 100)
    status.textContent = `Cargando modelos… ${pct}% (${i}/${total})`
    try {
      const gltf = await loader.loadAsync(job.url)
      templates[job.key] = gltf
    } catch (e) {
      console.error(e)
      status.textContent = `Error en ${job.key}. Tocá reintentar.`
      throw e
    }
  }
  state.modelsReady = true
  status.textContent = 'Listo 100% — ciudad lista para iniciar'
  $('btnStart').disabled = false
}

function cloneTemplate(key) {
  const gltf = templates[key]
  if (!gltf) throw new Error(`Falta modelo ${key}`)
  let hasSkin = false
  gltf.scene.traverse((c) => {
    if (c.isSkinnedMesh) hasSkin = true
  })
  const root = hasSkin ? skeletonClone(gltf.scene) : gltf.scene.clone(true)
  root.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true
      c.receiveShadow = true
      if (c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material]
        for (const m of mats) {
          if (m && m.map) m.map.colorSpace = THREE.SRGBColorSpace
        }
      }
    }
  })
  return { root, animations: gltf.animations || [] }
}

function boxOf(obj) {
  return new THREE.Box3().setFromObject(obj)
}

function addColliderFromBox(box, pad = 0.15) {
  colliders.push({
    minX: box.min.x - pad,
    maxX: box.max.x + pad,
    minZ: box.min.z - pad,
    maxZ: box.max.z + pad,
  })
}

function place(key, x, y, z, rotY = 0, scale = TOWN_SCALE, parent = worldRoot) {
  const { root } = cloneTemplate(key)
  root.scale.setScalar(scale)
  root.rotation.y = rotY
  root.position.set(x, y, z)
  parent.add(root)
  return root
}

function makeDoorProxy(buildingId, name, x, z, rotY = 0) {
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.5, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0x2a180c,
      emissive: 0x000000,
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0.4,
    }),
  )
  door.position.set(x, 1.25, z)
  door.rotation.y = rotY
  door.userData = { doorId: buildingId, label: name }
  worldRoot.add(door)
  doorMeshes.push(door)
  worldRoot.add(makeSign(name, x + 1.8, 2.4, z + 0.6, rotY))
}

/** Casa rectangular con paredes, puerta al frente (+Z) y techo */
function buildHouse(cx, cz, opts) {
  const {
    id,
    name,
    w = 3,
    d = 3,
    wood = false,
    rotY = 0,
    tall = false,
  } = opts
  const g = new THREE.Group()
  g.position.set(cx, 0, cz)
  g.rotation.y = rotY
  worldRoot.add(g)

  const wallKey = wood ? 'town/wall-wood.glb' : 'town/wall.glb'
  const doorKey = wood ? 'town/wall-wood-door.glb' : 'town/wall-door.glb'
  const winKey = wood ? 'town/wall-wood-window-shutters.glb' : 'town/wall-window-shutters.glb'
  const cornerKey = wood ? 'town/wall-wood-corner.glb' : 'town/wall-corner.glb'
  const s = TOWN_SCALE
  const halfW = ((w - 1) * s) / 2
  const halfD = ((d - 1) * s) / 2

  // Frente (+Z): puerta al centro
  for (let i = 0; i < w; i++) {
    const x = -halfW + i * s
    const key = i === Math.floor(w / 2) ? doorKey : i % 2 === 0 ? winKey : wallKey
    place(key, x, 0, halfD, 0, s, g)
  }
  // Fondo (-Z)
  for (let i = 0; i < w; i++) {
    const x = -halfW + i * s
    place(i % 2 ? winKey : wallKey, x, 0, -halfD, Math.PI, s, g)
  }
  // Laterales
  for (let i = 1; i < d - 1; i++) {
    const z = -halfD + i * s
    place(wallKey, -halfW, 0, z, Math.PI / 2, s, g)
    place(i % 2 ? winKey : wallKey, halfW, 0, z, -Math.PI / 2, s, g)
  }
  place(cornerKey, -halfW, 0, -halfD, Math.PI / 2, s, g)
  place(cornerKey, halfW, 0, -halfD, 0, s, g)

  // Segundo piso opcional (monasterio)
  if (tall) {
    for (let i = 0; i < w; i++) {
      const x = -halfW + i * s
      place(wallKey, x, s, halfD, 0, s, g)
      place(wallKey, x, s, -halfD, Math.PI, s, g)
    }
  }

  // Techo
  const roofY = tall ? s * 2 : s
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < d; j++) {
      const x = -halfW + i * s
      const z = -halfD + j * s
      const isEdge = i === 0 || i === w - 1 || j === 0 || j === d - 1
      place(isEdge ? 'town/roof-gable.glb' : 'town/roof.glb', x, roofY, z, 0, s, g)
    }
  }
  place('town/chimney.glb', halfW * 0.4, roofY, -halfD * 0.3, 0, s, g)
  place('town/chimney-top.glb', halfW * 0.4, roofY + s * 0.55, -halfD * 0.3, 0, s, g)
  if (name.includes('Ayuntamiento') || name.includes('Monasterio')) {
    place('town/banner-red.glb', 0, roofY + s * 0.2, halfD + 0.2, 0, s * 0.9, g)
  }

  g.updateMatrixWorld(true)
  const box = boxOf(g)
  addColliderFromBox(box, 0.25)

  // puerta mundo: frente del grupo
  const doorLocal = new THREE.Vector3(0, 0, halfD + 1.2)
  doorLocal.applyMatrix4(g.matrixWorld)
  makeDoorProxy(id, name, doorLocal.x, doorLocal.z, rotY)
  return g
}

function buildPlaza() {
  const s = TOWN_SCALE
  // fuente
  place('town/fountain-round-detail.glb', 0, 0, 0, 0, s * 1.4)
  place('town/fountain-round.glb', 0, 0, 0, 0, s * 1.15)
  worldRoot.add(makeSign('Plaza', -4, 2.1, 5, 0))

  // caminos en cruz
  for (let i = -6; i <= 6; i++) {
    if (Math.abs(i) < 2) continue
    place('town/road.glb', i * s, 0.01, 0, 0, s)
    place('town/road.glb', 0, 0.01, i * s, Math.PI / 2, s)
  }
  for (const [x, z, ry] of [
    [-2, -2, 0],
    [2, -2, Math.PI / 2],
    [2, 2, Math.PI],
    [-2, 2, -Math.PI / 2],
  ]) {
    place('town/road-corner.glb', x * s, 0.01, z * s, ry, s)
  }

  // puestos de mercado
  place('town/stall-red.glb', -10, 0, 8, 0.4, s)
  place('town/stall-green.glb', 11, 0, 7, -0.3, s)
  place('town/stall.glb', -8, 0, -9, 0.2, s)
  place('town/cart.glb', 9, 0, -8, 1.2, s * 0.9)

  // faroles
  for (const [x, z] of [
    [-6, 6],
    [6, 6],
    [-6, -6],
    [6, -6],
  ]) {
    place('town/lantern.glb', x, 0, z, 0, s)
  }
}

function scatterNature() {
  const s = TOWN_SCALE
  const trees = [
    [-42, -18, 'town/tree-high.glb'],
    [-38, 8, 'town/tree.glb'],
    [-45, 22, 'town/tree-crooked.glb'],
    [40, -20, 'town/tree-high-round.glb'],
    [44, 5, 'town/tree-high.glb'],
    [38, 28, 'town/tree.glb'],
    [-20, 42, 'town/tree-crooked.glb'],
    [18, 44, 'town/tree-high.glb'],
    [-50, -5, 'town/tree.glb'],
    [50, -8, 'town/tree-high-round.glb'],
    [-15, -40, 'town/tree.glb'],
    [12, -42, 'town/tree-high.glb'],
  ]
  for (const [x, z, key] of trees) {
    const t = place(key, x, 0, z, Math.random() * Math.PI, s * (0.9 + Math.random() * 0.4))
    addColliderFromBox(boxOf(t), 0.6)
  }
  for (const [x, z] of [
    [-32, 12],
    [32, 14],
    [-25, -32],
    [22, 38],
  ]) {
    place('town/hedge-large.glb', x, 0, z, 0, s)
  }
  for (const [x, z] of [
    [-12, 18],
    [14, -14],
    [-30, 30],
  ]) {
    place('town/rock-wide.glb', x, 0, z, Math.random(), s)
  }
  // cercas cerca de posada
  for (let i = 0; i < 5; i++) {
    place('town/fence.glb', 18 + i * s * 0.95, 0, 38, 0, s)
  }
  place('town/fence-gate.glb', 18 + 2.5 * s, 0, 38, 0, s)
}

function buildExtraHouses() {
  // casas de relleno para sensación de ciudad
  const extras = [
    { x: -48, z: -30, w: 2, d: 2, wood: true },
    { x: -52, z: 10, w: 2, d: 3, wood: false },
    { x: 48, z: -12, w: 3, d: 2, wood: true },
    { x: 46, z: 20, w: 2, d: 2, wood: false },
    { x: -18, z: 48, w: 2, d: 2, wood: true },
    { x: 30, z: 48, w: 3, d: 2, wood: false },
    { x: -40, z: 40, w: 2, d: 2, wood: true },
  ]
  extras.forEach((e, i) => {
    buildHouse(e.x, e.z, {
      id: `casa-${i}`,
      name: `Casa ${i + 1}`,
      w: e.w,
      d: e.d,
      wood: e.wood,
      rotY: (i % 4) * (Math.PI / 8),
    })
  })
}

function buildExterior() {
  colliders = []
  doorMeshes = []
  while (worldRoot.children.length) worldRoot.remove(worldRoot.children[0])

  // suelo: tierra + manchas de pasto
  const dirt = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD * 2, WORLD * 2),
    new THREE.MeshStandardMaterial({ color: 0x7a6548, roughness: 0.95 }),
  )
  dirt.rotation.x = -Math.PI / 2
  dirt.receiveShadow = true
  worldRoot.add(dirt)

  for (const [x, z, r, c] of [
    [0, 0, 28, 0x5f8a4a],
    [-35, 15, 16, 0x567e42],
    [30, -20, 18, 0x628f4c],
    [10, 40, 14, 0x5a8340],
    [-25, -35, 15, 0x4f7638],
  ]) {
    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(r, 28),
      new THREE.MeshStandardMaterial({ color: c, roughness: 1 }),
    )
    grass.rotation.x = -Math.PI / 2
    grass.position.set(x, 0.02, z)
    grass.receiveShadow = true
    worldRoot.add(grass)
  }

  buildPlaza()
  buildHouse(-28, -22, {
    id: 'ayuntamiento',
    name: 'Ayuntamiento',
    w: 4,
    d: 3,
    wood: false,
    rotY: 0,
  })
  buildHouse(26, -26, {
    id: 'monasterio',
    name: 'Monasterio',
    w: 3,
    d: 4,
    wood: false,
    tall: true,
    rotY: Math.PI * 0.08,
  })
  buildHouse(8, 30, {
    id: 'posada',
    name: 'Posada',
    w: 4,
    d: 3,
    wood: true,
    rotY: -Math.PI * 0.05,
  })
  buildExtraHouses()
  scatterNature()

  worldRoot.visible = true
  interiorRoot.visible = false
  $('sectorTag').textContent = 'Salem · ciudad'
}

function buildInterior(id) {
  while (interiorRoot.children.length) interiorRoot.remove(interiorRoot.children[0])
  const def = BUILDING_DEFS.find((x) => x.id === id)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 16),
    new THREE.MeshStandardMaterial({ color: 0x5a4030 }),
  )
  floor.rotation.x = -Math.PI / 2
  interiorRoot.add(floor)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a2a22 })
  ;[
    [0, 2.2, -7.5, 14, 4.4, 0.4],
    [0, 2.2, 7.5, 14, 4.4, 0.4],
    [-7.5, 2.2, 0, 0.4, 4.4, 14],
    [7.5, 2.2, 0, 0.4, 4.4, 14],
  ].forEach(([x, y, z, sx, sy, sz]) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat)
    w.position.set(x, y, z)
    interiorRoot.add(w)
  })
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.4, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0xc45c26, emissiveIntensity: 0.7 }),
  )
  door.position.set(0, 1.2, 7.3)
  door.userData = { doorId: id, label: 'Salida', exit: true }
  interiorRoot.add(door)
  doorMeshes = [door]
  interiorRoot.add(makeSign(def?.name || id, -2.4, 2.5, 7.1, 0))

  state.inside = id
  worldRoot.visible = false
  interiorRoot.visible = true
  player.position.set(0, 0, 3)
  $('sectorTag').textContent = def?.name || id
  $('btnEnter').textContent = 'SALIR'
  crier(`Dentro de ${def?.name || id}. Puerta brillante = salir.`)
}

function hits(x, z, radius) {
  for (const c of colliders) {
    const nx = THREE.MathUtils.clamp(x, c.minX, c.maxX)
    const nz = THREE.MathUtils.clamp(z, c.minZ, c.maxZ)
    const dx = x - nx
    const dz = z - nz
    if (dx * dx + dz * dz < radius * radius) return true
  }
  return false
}

function resolveMove(fromX, fromZ, toX, toZ, radius) {
  if (state.inside) {
    return {
      x: THREE.MathUtils.clamp(toX, -6.5, 6.5),
      z: THREE.MathUtils.clamp(toZ, -6.5, 6.5),
    }
  }
  if (!hits(toX, toZ, radius)) return { x: toX, z: toZ }
  if (!hits(toX, fromZ, radius)) return { x: toX, z: fromZ }
  if (!hits(fromX, toZ, radius)) return { x: fromX, z: toZ }
  return { x: fromX, z: fromZ }
}

function updateDoors() {
  state.nearDoor = null
  let best = null
  let bestDist = 2.2
  for (const door of doorMeshes) {
    door.updateWorldMatrix(true, false)
    const wp = new THREE.Vector3()
    door.getWorldPosition(wp)
    const dx = player.position.x - wp.x
    const dz = player.position.z - wp.z
    const dist = Math.hypot(dx, dz)
    const mat = door.material
    const facingOk = state.inside || door.userData.exit ? true : true
    if (dist < 2.2 && facingOk) {
      mat.emissive.setHex(0xc45c26)
      mat.emissiveIntensity = 0.55 + Math.sin(performance.now() / 180) * 0.25
      mat.opacity = 0.9
      if (dist < bestDist) {
        bestDist = dist
        best = door.userData
      }
    } else if (!door.userData.exit) {
      mat.emissive.setHex(0x000000)
      mat.emissiveIntensity = 0
      mat.opacity = 0.4
    }
  }
  state.nearDoor = best
  const btn = $('btnEnter')
  if (state.inside) {
    btn.disabled = !best
    btn.textContent = 'SALIR'
  } else if (best) {
    btn.disabled = false
    btn.textContent = `ENTRAR · ${best.label}`
  } else {
    btn.disabled = true
    btn.textContent = 'ENTRAR'
  }
}

function stripWeapons(root) {
  const kill = []
  root.traverse((c) => {
    const n = `${c.name || ''}`.toLowerCase()
    if (/weapon|gun|rifle|sword|knife|pistol|blade|axe|bow|arrow|shield|spear/.test(n)) {
      kill.push(c)
    }
  })
  for (const c of kill) {
    if (c.parent) c.parent.remove(c)
  }
}

function tintCharacter(root, clothesHex, accentHex) {
  root.traverse((c) => {
    if (!c.isMesh || !c.material) return
    const wasArray = Array.isArray(c.material)
    const mats = wasArray ? c.material : [c.material]
    const next = mats.map((m) => {
      const mat = m.clone()
      const name = `${c.name || ''} ${mat.name || ''}`.toLowerCase()
      if (/eye|teeth|tooth|cornea/.test(name)) return mat
      if (/skin|face|head|hand|arm|neck|body/.test(name) && !/shirt|pant|boot|cloth|suit/.test(name)) {
        mat.color = new THREE.Color(0xc68642)
        mat.metalness = 0.05
        mat.roughness = 0.75
        return mat
      }
      if (/hair|beard/.test(name)) {
        mat.color = new THREE.Color(0x2a1a12)
        return mat
      }
      mat.color = new THREE.Color(
        /boot|shoe|pant|leg/.test(name) && accentHex ? accentHex : clothesHex,
      )
      mat.metalness = 0.1
      mat.roughness = 0.65
      return mat
    })
    c.material = wasArray ? next : next[0]
  })
}

function makeSimplePerson(role) {
  // respaldo si el modelo animado falla: figura clara, no sombra
  const g = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.7 })
  const cloth =
    role === 'Alcalde'
      ? new THREE.MeshStandardMaterial({ color: 0x2f6fad, roughness: 0.6 })
      : new THREE.MeshStandardMaterial({ color: 0x3a2a28, roughness: 0.7 })
  const pants = new THREE.MeshStandardMaterial({
    color: role === 'Alcalde' ? 0x1e3348 : 0x15120f,
    roughness: 0.8,
  })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.7, 6, 10), cloth)
  body.position.y = 1.05
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), skin)
  head.position.y = 1.72
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.35, 4, 8), pants)
  legL.position.set(-0.12, 0.4, 0)
  const legR = legL.clone()
  legR.position.x = 0.12
  g.add(body, head, legL, legR)
  if (role === 'Alcalde') {
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.3, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: 0x1a1a22 }),
    )
    hat.position.y = 1.95
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.04, 12),
      new THREE.MeshStandardMaterial({ color: 0x111118 }),
    )
    brim.position.y = 1.87
    g.add(hat, brim)
  } else {
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1a1210, side: THREE.DoubleSide }),
    )
    hood.position.y = 1.78
    g.add(hood)
  }
  g.userData.radius = 0.45
  g.userData.role = role
  g.userData.animations = []
  g.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true
      c.receiveShadow = true
    }
  })
  return g
}

function makeRoleCharacter(role) {
  try {
    if (!templates['xbot.glb']) return makeSimplePerson(role)
    const { root, animations } = cloneTemplate('xbot.glb')
    stripWeapons(root)
    // Mixamo suele venir enorme: normalizar altura ~1.8
    const box = boxOf(root)
    const h = Math.max(0.01, box.max.y - box.min.y)
    const targetH = 1.85
    root.scale.setScalar(targetH / h)
    root.position.y = 0
    // realinear al suelo
    const box2 = boxOf(root)
    root.position.y -= box2.min.y

    if (role === 'Alcalde') {
      tintCharacter(root, 0x2f6fad, 0x1e3348)
      const hat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.34, 0.18, 12),
        new THREE.MeshStandardMaterial({ color: 0x1a1a22 }),
      )
      hat.position.set(0, 1.85, 0)
      root.add(hat)
      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.04, 12),
        new THREE.MeshStandardMaterial({ color: 0x111118 }),
      )
      brim.position.set(0, 1.76, 0)
      root.add(brim)
    } else {
      tintCharacter(root, 0x3d2c28, 0x1a1410)
      const hood = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 10, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x241816, side: THREE.DoubleSide }),
      )
      hood.position.set(0, 1.72, 0)
      root.add(hood)
    }
    root.userData.radius = 0.45
    root.userData.role = role
    root.userData.animations = animations
    return root
  } catch (e) {
    console.error(e)
    return makeSimplePerson(role)
  }
}

function clearCharacters() {
  const remove = []
  scene.traverse((c) => {
    if (c.userData?.role) remove.push(c)
  })
  for (const c of remove) {
    if (c.parent) c.parent.remove(c)
  }
  player = null
  mixer = null
  playerActions = null
}

function attachCharacter(role, isPlayer, x, z) {
  const root = makeRoleCharacter(role)
  root.position.x = x
  root.position.z = z
  scene.add(root)
  if (isPlayer) {
    player = root
    const animations = root.userData.animations || []
    if (animations.length) {
      mixer = new THREE.AnimationMixer(player)
      const clip =
        animations.find((a) => /walk|run|idle/i.test(a.name)) || animations[0]
      playerActions = mixer.clipAction(clip)
      playerActions.play()
      playerActions.paused = true
    }
  }
  return root
}

function initThree() {
  const canvas = $('c')
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.outputColorSpace = THREE.SRGBColorSpace
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x8eb0c8)
  scene.fog = new THREE.Fog(0x8eb0c8, 55, 140)
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 260)
  clock = new THREE.Clock()
  scene.add(new THREE.HemisphereLight(0xfff5e6, 0x3d4a28, 1.25))
  const sun = new THREE.DirectionalLight(0xffe8c8, 1.15)
  sun.position.set(30, 40, 18)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  scene.add(sun)
  scene.add(new THREE.AmbientLight(0xffffff, 0.35))
  worldRoot = new THREE.Group()
  interiorRoot = new THREE.Group()
  interiorRoot.visible = false
  scene.add(worldRoot)
  scene.add(interiorRoot)
  buildExterior()
  window.addEventListener('resize', resize)
  resize()
}

function resize() {
  if (!renderer) return
  const w = innerWidth
  const h = innerHeight
  renderer.setSize(w, h, false)
  if (camera) {
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
}

function tick() {
  requestAnimationFrame(tick)
  if (!renderer) return
  const dt = Math.min(clock.getDelta(), 0.05)
  if (mixer) mixer.update(dt)
  if (state.running && $('game').classList.contains('active') && player) {
    const speed = 5.8
    const fromX = player.position.x
    const fromZ = player.position.z
    const toX = fromX + state.move.x * speed * dt
    const toZ = fromZ + state.move.z * speed * dt
    const next = resolveMove(fromX, fromZ, toX, toZ, player.userData.radius || 0.45)
    player.position.x = next.x
    player.position.z = next.z
    if (state.move.x || state.move.z) {
      player.rotation.y = Math.atan2(state.move.x, state.move.z) + Math.PI
      if (playerActions) playerActions.paused = false
    } else if (playerActions) {
      playerActions.paused = true
    }
    updateDoors()
    camera.position.set(player.position.x, 10, player.position.z + 12)
    camera.lookAt(player.position.x, 1.5, player.position.z)
  }
  renderer.render(scene, camera)
}

function setupJoystick() {
  const zone = $('joyZone')
  const knob = $('joyKnob')
  const base = $('joyBase')
  let pid = null
  const maxR = 38
  function setKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`
  }
  function onStart(e) {
    const t = e.changedTouches ? e.changedTouches[0] : e
    pid = t.identifier ?? 'mouse'
    onMove(e)
  }
  function onMove(e) {
    if (pid === null) return
    const t = e.changedTouches
      ? [...e.changedTouches].find((x) => x.identifier === pid) || e.touches[0]
      : e
    if (!t) return
    const rect = base.getBoundingClientRect()
    let dx = t.clientX - (rect.left + rect.width / 2)
    let dy = t.clientY - (rect.top + rect.height / 2)
    const len = Math.hypot(dx, dy) || 1
    if (len > maxR) {
      dx = (dx / len) * maxR
      dy = (dy / len) * maxR
    }
    setKnob(dx, dy)
    state.move.x = dx / maxR
    state.move.z = dy / maxR
  }
  function onEnd() {
    pid = null
    state.move.x = 0
    state.move.z = 0
    setKnob(0, 0)
  }
  zone.addEventListener('touchstart', onStart, { passive: false })
  zone.addEventListener('touchmove', onMove, { passive: false })
  zone.addEventListener('touchend', onEnd)
  zone.addEventListener('touchcancel', onEnd)
  zone.addEventListener('mousedown', onStart)
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onEnd)
}

function startMatch() {
  if (!state.modelsReady) return toast('Todavía cargan los modelos')
  if (!renderer) initThree()
  state.you = Math.random() < 0.5 ? 'Alcalde' : 'Asesino'
  state.foe = state.you === 'Alcalde' ? 'Asesino' : 'Alcalde'
  state.youHp = 100
  state.foeHp = 100
  state.youActions = 10
  state.night = 0
  state.inside = null
  state.running = true
  state.startedAt = Date.now()
  $('roleTag').textContent = state.you
  buildExterior()
  clearCharacters()
  attachCharacter(state.you, true, 0, 14)
  attachCharacter(state.foe, false, 6, -5)
  show('game')
  resize()
  clearInterval(state.timerId)
  state.timerId = setInterval(updateTimer, 250)
  updateTimer()
  crier(
    `Sos ${state.you}. Plaza grande, casas y árboles. El ${state.foe} está quieto. Puerta brillante = ENTRAR.`,
  )
}

function updateTimer() {
  const left = Math.max(0, MATCH_MS - (Date.now() - state.startedAt))
  const m = Math.floor(left / 60000)
  const s = Math.floor((left % 60000) / 1000)
  $('timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  if (left <= 0 && state.running) {
    state.running = false
    $('endTitle').textContent = 'Tiempo'
    $('endText').textContent = 'Se cumplieron 30 minutos.'
    show('end')
  }
}

function doEnter() {
  if (state.inside) {
    if (!state.nearDoor) return toast('Acercate a la puerta para salir')
    const id = state.inside
    const def = BUILDING_DEFS.find((x) => x.id === id)
    state.inside = null
    buildExterior()
    if (def) player.position.set(def.x, 0, def.z + 10)
    else player.position.set(0, 0, 14)
    $('btnEnter').textContent = 'ENTRAR'
    toast('Salís del edificio')
    return
  }
  if (!state.nearDoor || state.nearDoor.exit) return
  buildInterior(state.nearDoor.id)
  toast(`Entras a ${state.nearDoor.label}`)
}

function openNightPanel() {
  const body = $('panelBody')
  body.innerHTML = ''
  $('panelTitle').textContent = `Noche ${state.night + 1}`
  const mk = (label, fn) => {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = () => {
      fn()
      $('panel').classList.add('hidden')
    }
    body.appendChild(b)
  }
  mk('Pasar noche (sin acción)', () => {
    state.night += 1
    crier(`Amanece. Noche ${state.night}.`)
  })
  if (state.you === 'Asesino') {
    mk('Atacar rival aquí (50%)', () => {
      state.night += 1
      if (state.inside !== 'posada') {
        state.youActions = Math.max(0, state.youActions - 1)
        crier('El rival no estaba acá.')
      } else {
        state.foeHp = Math.max(0, state.foeHp - 50)
        crier(`Acuchillado: rival ${state.foeHp}`)
        if (state.foeHp <= 0) {
          state.running = false
          $('endTitle').textContent = 'Victoria'
          $('endText').textContent = 'Eliminaste al rival.'
          show('end')
        }
      }
    })
  }
  if (state.you === 'Alcalde') {
    mk('Revelar identidad (Plaza)', () => {
      if (state.inside || Math.hypot(player.position.x, player.position.z) > 14) {
        toast('Solo en la Plaza exterior')
        return
      }
      state.revealedMayor = true
      state.youActions += 10
      crier('¡El Alcalde se revela!')
    })
  }
  $('panel').classList.remove('hidden')
}

$('btnStart').onclick = () => startMatch()
$('btnRetryLoad')?.addEventListener('click', () => {
  $('btnStart').disabled = true
  $('loadStatus').textContent = 'Reintentando… 0%'
  loadModels().catch((e) => {
    $('loadStatus').textContent = 'Error cargando modelos — Reintentar'
    console.error(e)
  })
})
$('btnAgain').onclick = () => show('menu')
$('btnMenu').onclick = () => {
  state.running = false
  clearInterval(state.timerId)
  show('menu')
}
$('btnEnter').onclick = () => doEnter()
$('btnNight').onclick = () => openNightPanel()
$('panelClose').onclick = () => $('panel').classList.add('hidden')
$('btnExit').onclick = () => {
  try {
    if (window.SalemAndroid?.exitApp) window.SalemAndroid.exitApp()
  } catch {}
}

setupJoystick()
show('menu')
requestAnimationFrame(tick)
loadModels().catch((e) => {
  $('loadStatus').textContent = 'Error cargando modelos'
  console.error(e)
  toast('No se pudieron cargar los modelos 3D')
})
