import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'

const MATCH_MS = 30 * 60 * 1000
const WORLD = 180
const $ = (id) => document.getElementById(id)
const TOWN_SCALE = 1
const WALL_W = 2

const BUILDING_DEFS = [
  { id: 'ayuntamiento', name: 'Ayuntamiento', x: -24, z: -20, rotY: 0 },
  { id: 'monasterio', name: 'Monasterio', x: 22, z: -22, rotY: Math.PI * 0.08 },
  { id: 'posada', name: 'Posada', x: 6, z: 26, rotY: -Math.PI * 0.05 },
]

const VILLAGE_FILES = [
  'Wall_UnevenBrick_Straight.gltf',
  'Wall_UnevenBrick_Door_Flat.gltf',
  'Wall_UnevenBrick_Window_Wide_Flat.gltf',
  'Wall_Plaster_Straight.gltf',
  'Wall_Plaster_Door_Round.gltf',
  'Wall_Plaster_Window_Wide_Round.gltf',
  'Corner_Exterior_Wood.gltf',
  'Corner_Exterior_Brick.gltf',
  'Roof_RoundTiles_4x4.gltf',
  'Roof_RoundTiles_6x6.gltf',
  'Roof_Front_Brick4.gltf',
  'Prop_Chimney.gltf',
  'Prop_Chimney2.gltf',
  'Door_1_Flat.gltf',
  'Floor_UnevenBrick.gltf',
  'Prop_WoodenFence_Single.gltf',
  'Prop_Wagon.gltf',
  'Prop_Crate.gltf',
  'Prop_Vine1.gltf',
  'Prop_Vine2.gltf',
  'Stairs_Exterior_Straight.gltf',
]
const NATURE_FILES = ['tree.glb', 'tree-high.glb', 'tree-crooked.glb', 'tree-high-round.glb', 'rock-wide.glb']

const state = {
  running: false,
  you: null,
  foe: null,
  youHp: 100,
  foeHp: 100,
  youActions: 10,
  revealedMayor: false,
  night: 0,
  isNight: false,
  inside: null,
  nearDoor: null,
  doorHold: 0,
  startedAt: 0,
  timerId: null,
  move: { x: 0, z: 0 },
  modelsReady: false,
  camZoom: 1,
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
    ...VILLAGE_FILES.map((f) => ({ key: `village/${f}`, url: `./models/village/${f}` })),
    ...NATURE_FILES.map((f) => ({ key: `town/${f}`, url: `./models/town/${f}` })),
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
          if (!m) continue
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace
          if (m.color && key.startsWith('town/')) {
            m.color.multiplyScalar(0.45)
            m.roughness = 1
          }
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

function buildHouse(cx, cz, opts) {
  const { id, name, w = 3, d = 3, plaster = false, rotY = 0 } = opts
  const g = new THREE.Group()
  g.position.set(cx, 0, cz)
  g.rotation.y = rotY
  worldRoot.add(g)

  const wallKey = plaster ? 'village/Wall_Plaster_Straight.gltf' : 'village/Wall_UnevenBrick_Straight.gltf'
  const doorKey = plaster ? 'village/Wall_Plaster_Door_Round.gltf' : 'village/Wall_UnevenBrick_Door_Flat.gltf'
  const winKey = plaster
    ? 'village/Wall_Plaster_Window_Wide_Round.gltf'
    : 'village/Wall_UnevenBrick_Window_Wide_Flat.gltf'
  const s = WALL_W
  const halfW = ((w - 1) * s) / 2
  const halfD = ((d - 1) * s) / 2

  for (let i = 0; i < w; i++) {
    const x = -halfW + i * s
    place(i === Math.floor(w / 2) ? doorKey : i % 2 ? winKey : wallKey, x, 0, halfD, 0, 1, g)
  }
  for (let i = 0; i < w; i++) {
    const x = -halfW + i * s
    place(i % 2 ? winKey : wallKey, x, 0, -halfD, Math.PI, 1, g)
  }
  for (let i = 1; i < d - 1; i++) {
    const z = -halfD + i * s
    place(wallKey, -halfW, 0, z, Math.PI / 2, 1, g)
    place(i % 2 ? winKey : wallKey, halfW, 0, z, -Math.PI / 2, 1, g)
  }
  // techo
  const roofKey = w >= 3 ? 'village/Roof_RoundTiles_6x6.gltf' : 'village/Roof_RoundTiles_4x4.gltf'
  place(roofKey, 0, 0.05, 0, 0, 1, g)
  place('village/Prop_Chimney.gltf', halfW * 0.35, 0, -halfD * 0.2, 0, 1, g)
  if (templates['village/Prop_Vine1.gltf']) {
    place('village/Prop_Vine1.gltf', -halfW - 0.2, 0, 0, Math.PI / 2, 1, g)
  }

  g.updateMatrixWorld(true)
  const box = boxOf(g)
  addColliderFromBox(box, 0.2)
  const doorLocal = new THREE.Vector3(0, 0, halfD + 1.1)
  doorLocal.applyMatrix4(g.matrixWorld)
  makeDoorProxy(id, name, doorLocal.x, doorLocal.z, rotY)
  return g
}

function buildPlaza() {
  for (let ix = -3; ix <= 3; ix++) {
    for (let iz = -3; iz <= 3; iz++) {
      if (Math.abs(ix) < 1 && Math.abs(iz) < 1) continue
      place('village/Floor_UnevenBrick.gltf', ix * WALL_W, 0.02, iz * WALL_W, 0, 1)
    }
  }
  worldRoot.add(makeSign('Plaza', -3.2, 2.0, 4.5, 0))
  place('village/Prop_Wagon.gltf', -8, 0, 7, 0.5, 1)
  place('village/Prop_Crate.gltf', 7, 0, 6, -0.3, 1)
  place('village/Prop_Crate.gltf', 8.2, 0, 5.5, 0.4, 1)
  for (const [x, z] of [
    [-5, 5],
    [5, 5],
    [-5, -5],
    [5, -5],
    [0, 8],
    [0, -8],
  ]) {
    worldRoot.add(makeCandle(x, z))
  }
}

function makeCandle(x, z) {
  const g = new THREE.Group()
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 0.9, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 1 }),
  )
  stick.position.y = 0.45
  const wax = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.04, 0.28, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8c9a0, roughness: 0.7 }),
  )
  wax.position.y = 1.0
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffaa44,
      emissive: 0xff6611,
      emissiveIntensity: 1.6,
      roughness: 1,
    }),
  )
  flame.position.y = 1.2
  flame.userData.flame = true
  g.add(stick, wax, flame)
  g.position.set(x, 0, z)
  const light = new THREE.PointLight(0xff8a3a, 0.45, 8, 2)
  light.position.set(0, 1.15, 0)
  g.add(light)
  return g
}

function scatterNature() {
  const trees = [
    [-36, -16, 'town/tree-high.glb'],
    [-32, 10, 'town/tree.glb'],
    [34, -18, 'town/tree-high-round.glb'],
    [38, 8, 'town/tree-high.glb'],
    [-18, 36, 'town/tree-crooked.glb'],
    [16, 38, 'town/tree.glb'],
    [-42, 4, 'town/tree.glb'],
    [42, -4, 'town/tree-high.glb'],
  ]
  for (const [x, z, key] of trees) {
    if (!templates[key]) continue
    const t = place(key, x, 0, z, Math.random() * Math.PI, 2.2)
    addColliderFromBox(boxOf(t), 0.5)
  }
  for (let i = 0; i < 6; i++) {
    place('village/Prop_WoodenFence_Single.gltf', 14 + i * 1.6, 0, 34, 0, 1)
  }
}

function buildExtraHouses() {
  // casas de relleno para sensación de ciudad
  const extras = [
    { x: -40, z: -26, w: 2, d: 2, plaster: true },
    { x: -44, z: 8, w: 2, d: 3, plaster: false },
    { x: 40, z: -10, w: 3, d: 2, plaster: true },
    { x: 38, z: 18, w: 2, d: 2, plaster: false },
    { x: -16, z: 40, w: 2, d: 2, plaster: true },
    { x: 26, z: 40, w: 3, d: 2, plaster: false },
  ]
  extras.forEach((e, i) => {
    buildHouse(e.x, e.z, {
      id: `casa-${i}`,
      name: `Casa ${i + 1}`,
      w: e.w,
      d: e.d,
      plaster: e.plaster,
      rotY: (i % 4) * (Math.PI / 8),
    })
  })
}

function buildExterior() {
  colliders = []
  doorMeshes = []
  while (worldRoot.children.length) worldRoot.remove(worldRoot.children[0])

  // suelo sucio tipo Salem: barro / tierra oscura + pasto seco
  const dirt = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD * 2, WORLD * 2),
    new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 1 }),
  )
  dirt.rotation.x = -Math.PI / 2
  dirt.receiveShadow = true
  worldRoot.add(dirt)

  for (const [x, z, r, c] of [
    [0, 0, 26, 0x3f4a2e],
    [-35, 15, 16, 0x3a4528],
    [30, -20, 18, 0x45502e],
    [10, 40, 14, 0x384226],
    [-25, -35, 15, 0x334022],
    [20, 10, 8, 0x5a4028],
    [-15, 8, 6, 0x523820],
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
  // charcos de barro
  for (const [x, z, r] of [
    [4, 3, 2.2],
    [-7, -2, 1.6],
    [12, 16, 1.8],
    [-18, 6, 2.4],
  ]) {
    const mud = new THREE.Mesh(
      new THREE.CircleGeometry(r, 16),
      new THREE.MeshStandardMaterial({ color: 0x2e2218, roughness: 0.85, metalness: 0.05 }),
    )
    mud.rotation.x = -Math.PI / 2
    mud.position.set(x, 0.03, z)
    worldRoot.add(mud)
  }

  buildPlaza()
  buildHouse(-24, -20, {
    id: 'ayuntamiento',
    name: 'Ayuntamiento',
    w: 4,
    d: 3,
    plaster: false,
    rotY: 0,
  })
  buildHouse(22, -22, {
    id: 'monasterio',
    name: 'Monasterio',
    w: 3,
    d: 4,
    plaster: true,
    rotY: Math.PI * 0.08,
  })
  buildHouse(6, 26, {
    id: 'posada',
    name: 'Posada',
    w: 4,
    d: 3,
    plaster: false,
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
  crier(`Dentro de ${def?.name || id}. Acercate a la puerta para salir.`)
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


function canUseDoors() {
  // De día cerradas; de noche abiertas (hora límite exacta: después)
  return !!state.isNight || !!state.inside
}

function updateDoors() {
  state.nearDoor = null
  let best = null
  let bestDist = 2.0
  for (const door of doorMeshes) {
    door.updateWorldMatrix(true, false)
    const wp = new THREE.Vector3()
    door.getWorldPosition(wp)
    const dx = player.position.x - wp.x
    const dz = player.position.z - wp.z
    const dist = Math.hypot(dx, dz)
    const mat = door.material
    const open = canUseDoors() || door.userData.exit
    if (dist < 2.0 && open) {
      mat.emissive.setHex(0x8a3a18)
      mat.emissiveIntensity = 0.35 + Math.sin(performance.now() / 200) * 0.15
      mat.opacity = 0.75
      if (dist < bestDist) {
        bestDist = dist
        best = door.userData
      }
    } else {
      mat.emissive.setHex(0x000000)
      mat.emissiveIntensity = 0
      mat.opacity = state.isNight ? 0.35 : 0.15
      if (dist < 2.0 && !open && !door.userData.exit) {
        // cerca pero cerrado de día
        best = { ...door.userData, locked: true }
        bestDist = dist
      }
    }
  }
  state.nearDoor = best
}

function applyRoleLook(root, role) {
  root.traverse((c) => {
    if (!c.isMesh || !c.material) return
    const mats = Array.isArray(c.material) ? c.material : [c.material]
    const next = mats.map((m) => {
      const mat = m.clone()
      const name = `${c.name || ''} ${mat.name || ''}`.toLowerCase()
      if (/eye|teeth|cornea/.test(name)) return mat
      if (/skin|face|head|hand|arm|neck|body/.test(name) && !/shirt|cloth|suit|pant|boot/.test(name)) {
        mat.color = new THREE.Color(0x8d5a3c)
        mat.roughness = 0.8
        return mat
      }
      if (role === 'Alcalde') {
        mat.color = new THREE.Color(/pant|leg|boot/.test(name) ? 0x1a2838 : 0x2a5080)
      } else if (role === 'Pregonero') {
        mat.color = new THREE.Color(/pant|leg|boot/.test(name) ? 0x3a2818 : 0x6a4a28)
      } else {
        mat.color = new THREE.Color(0x2a2220)
      }
      mat.metalness = 0.05
      mat.roughness = 0.85
      return mat
    })
    c.material = Array.isArray(c.material) ? next : next[0]
  })
  // sin armas visibles
  const kill = []
  root.traverse((c) => {
    const n = `${c.name || ''}`.toLowerCase()
    if (/weapon|gun|rifle|sword|knife|pistol|blade|axe|bow|arrow|shield|spear/.test(n)) kill.push(c)
  })
  for (const c of kill) c.parent?.remove(c)

  if (role === 'Alcalde') {
    const hat = new THREE.Group()
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.13, 0.18, 12),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 }),
    )
    top.position.y = 1.78
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.03, 14),
      new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.95 }),
    )
    brim.position.y = 1.68
    hat.add(top, brim)
    root.add(hat)
  } else if (role === 'Asesino') {
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.7),
      new THREE.MeshStandardMaterial({ color: 0x050505, side: THREE.DoubleSide, roughness: 1 }),
    )
    hood.position.set(0, 1.65, 0)
    root.add(hood)
  }
}

function makeRoleCharacter(role) {
  if (!templates['xbot.glb']) return makeColonialPerson(role)
  try {
    const { root, animations } = cloneTemplate('xbot.glb')
    // xbot YA está en metros (~1.8). NO escalar a 0.01 (eso lo hacía fantasma).
    root.scale.setScalar(1)
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    root.position.y -= box.min.y
    // ocultar esqueleto "joints" (bolitas) que parece fantasma
    root.traverse((c) => {
      const n = `${c.name || ''} ${c.material?.name || ''}`.toLowerCase()
      if (/joint|beta_joints/.test(n)) c.visible = false
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material]
        for (const m of mats) {
          if (!m) continue
          m.metalness = 0.05
          m.roughness = 0.85
          m.transparent = false
          m.opacity = 1
          m.depthWrite = true
          m.side = THREE.FrontSide
        }
      }
    })
    applyRoleLook(root, role)
    root.userData.radius = 0.4
    root.userData.role = role
    root.userData.animations = animations
    return root
  } catch (e) {
    console.error(e)
    return makeColonialPerson(role)
  }
}


function makeColonialPerson(role) {
  const g = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0xb9805a, roughness: 0.8 })
  const isMayor = role === 'Alcalde'
  const isCrier = role === 'Pregonero'
  const coat = new THREE.MeshStandardMaterial({
    color: isMayor ? 0x1f4f7a : isCrier ? 0x6b4a28 : 0x1a1412,
    roughness: 0.85,
  })
  const pants = new THREE.MeshStandardMaterial({
    color: isMayor ? 0x1a2e3d : isCrier ? 0x3a2a18 : 0x0e0c0b,
    roughness: 0.9,
  })
  const boot = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 1 })

  const hips = new THREE.Group()
  hips.position.y = 0.95
  g.add(hips)

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.24), coat)
  torso.position.y = 0.28
  hips.add(torso)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), skin)
  head.position.y = 0.72
  hips.add(head)

  const armL = new THREE.Group()
  armL.position.set(-0.28, 0.45, 0)
  const armLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 0.1), coat)
  armLMesh.position.y = -0.22
  armL.add(armLMesh)
  const armR = new THREE.Group()
  armR.position.set(0.28, 0.45, 0)
  const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 0.1), coat)
  armRMesh.position.y = -0.22
  armR.add(armRMesh)
  hips.add(armL, armR)

  const legL = new THREE.Group()
  legL.position.set(-0.12, 0, 0)
  const thighL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.45, 0.14), pants)
  thighL.position.y = -0.22
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.18, 0.22), boot)
  bootL.position.set(0, -0.52, 0.02)
  legL.add(thighL, bootL)
  const legR = new THREE.Group()
  legR.position.set(0.12, 0, 0)
  const thighR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.45, 0.14), pants)
  thighR.position.y = -0.22
  const bootR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.18, 0.22), boot)
  bootR.position.set(0, -0.52, 0.02)
  legR.add(thighR, bootR)
  hips.add(legL, legR)

  if (isMayor) {
    const collar = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.08, 0.28),
      new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.7 }),
    )
    collar.position.y = 0.55
    hips.add(collar)
    const hat = new THREE.Group()
    hat.position.y = 0.88
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.15, 0.22, 10),
      new THREE.MeshStandardMaterial({ color: 0x111118 }),
    )
    top.position.y = 0.12
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.26, 0.03, 12),
      new THREE.MeshStandardMaterial({ color: 0x0d0d10 }),
    )
    hat.add(top, brim)
    hips.add(hat)
  } else if (isCrier) {
    const bell = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.6, roughness: 0.35 }),
    )
    bell.position.set(0.35, 0.2, 0.1)
    armR.add(bell)
    const sash = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.08, 0.26),
      new THREE.MeshStandardMaterial({ color: 0x8a1e1e }),
    )
    sash.position.y = 0.1
    hips.add(sash)
  } else {
    const cloak = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.7, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 0.95, side: THREE.DoubleSide }),
    )
    cloak.position.set(0, 0.25, -0.18)
    hips.add(cloak)
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 10, 10, 0, Math.PI * 2, 0, Math.PI / 1.6),
      new THREE.MeshStandardMaterial({ color: 0x0c0a09, side: THREE.DoubleSide, roughness: 1 }),
    )
    hood.position.set(0, 0.78, -0.02)
    hips.add(hood)
  }

  g.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true
      c.receiveShadow = true
    }
  })

  g.userData.radius = 0.35
  g.userData.role = role
  g.userData.walk = { phase: 0, armL, armR, legL, legR, hips }
  g.userData.moving = false
  return g
}

function updateWalk(root, dt, moving) {
  const w = root.userData.walk
  if (!w) return
  root.userData.moving = moving
  if (moving) {
    w.phase += dt * 9
    const s = Math.sin(w.phase)
    w.legL.rotation.x = s * 0.7
    w.legR.rotation.x = -s * 0.7
    w.armL.rotation.x = -s * 0.55
    w.armR.rotation.x = s * 0.55
    w.hips.position.y = 0.95 + Math.abs(Math.sin(w.phase * 2)) * 0.03
  } else {
    w.legL.rotation.x *= 0.7
    w.legR.rotation.x *= 0.7
    w.armL.rotation.x *= 0.7
    w.armR.rotation.x *= 0.7
    w.hips.position.y = 0.95
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
  root.position.set(x, root.position.y || 0, z)
  scene.add(root)
  if (isPlayer) {
    player = root
    const animations = root.userData.animations || []
    if (animations.length) {
      mixer = new THREE.AnimationMixer(player)
      const clip =
        animations.find((a) => /walk|run/i.test(a.name)) ||
        animations.find((a) => /idle/i.test(a.name)) ||
        animations[0]
      playerActions = mixer.clipAction(clip)
      playerActions.play()
      playerActions.paused = true
    }
  }
  return root
}

function attachCrier() {
  const c = makeRoleCharacter('Pregonero')
  c.position.set(-3.5, c.position.y || 0, 4.5)
  c.rotation.y = Math.PI * 0.25
  scene.add(c)
  return c
}

function setDayNight(night) {
  state.isNight = night
  if (!scene) return
  scene.background = new THREE.Color(night ? 0x0a0c12 : 0x4a5248)
  scene.fog = new THREE.Fog(night ? 0x0a0c12 : 0x4a5248, night ? 28 : 45, night ? 90 : 120)
  scene.traverse((o) => {
    if (o.isDirectionalLight) {
      o.intensity = night ? 0.25 : 0.75
      o.color.setHex(night ? 0x8899bb : 0xd8c090)
    }
    if (o.isHemisphereLight) o.intensity = night ? 0.35 : 0.85
    if (o.isAmbientLight) o.intensity = night ? 0.12 : 0.25
    if (o.isPointLight) o.intensity = night ? 1.1 : 0.35
  })
  $('sectorTag').textContent = night ? 'Salem · Noche' : 'Salem · Día'
}


function initThree() {
  const canvas = $('c')
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.outputColorSpace = THREE.SRGBColorSpace
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x4a5248)
  scene.fog = new THREE.Fog(0x4a5248, 45, 120)
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 280)
  clock = new THREE.Clock()
  scene.add(new THREE.HemisphereLight(0xb8a888, 0x1a1510, 0.85))
  const sun = new THREE.DirectionalLight(0xd8c090, 0.75)
  sun.position.set(22, 28, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  scene.add(sun)
  scene.add(new THREE.AmbientLight(0x8a7a68, 0.25))
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
    const speed = 4.2
    const fromX = player.position.x
    const fromZ = player.position.z
    const toX = fromX + state.move.x * speed * dt
    const toZ = fromZ + state.move.z * speed * dt
    const next = resolveMove(fromX, fromZ, toX, toZ, player.userData.radius || 0.35)
    player.position.x = next.x
    player.position.z = next.z
    const moving = !!(state.move.x || state.move.z)
    if (moving) {
      player.rotation.y = Math.atan2(state.move.x, state.move.z)
      if (playerActions) playerActions.paused = false
    } else if (playerActions) {
      playerActions.paused = true
    }
    if (player.userData.walk) updateWalk(player, dt, moving)
    updateDoors()
    // entrada automática (sin botón): cerca de puerta abierta
    if (state.nearDoor && !state.nearDoor.locked) {
      state.doorHold += dt
      if (state.doorHold > 0.45) {
        state.doorHold = 0
        doEnter()
      }
    } else {
      state.doorHold = 0
      if (state.nearDoor?.locked && moving) {
        // aviso suave
        if (!updateDoors._lockToast || performance.now() - updateDoors._lockToast > 2500) {
          toast('Cerrado de día. De noche se abre.')
          updateDoors._lockToast = performance.now()
        }
      }
    }
    const z = state.camZoom || 1
    camera.position.set(player.position.x, 11 * z, player.position.z + 14 * z)
    camera.lookAt(player.position.x, 1.3, player.position.z)
  }
  if (worldRoot) {
    worldRoot.traverse((c) => {
      if (c.userData?.flame && c.material) {
        c.material.emissiveIntensity = 1.1 + Math.sin(performance.now() / 120 + c.id) * 0.35
        c.scale.setScalar(0.9 + Math.sin(performance.now() / 90 + c.id) * 0.15)
      }
    })
  }
  renderer.render(scene, camera)
}

function setupPinchZoom() {
  let lastDist = 0
  const el = $('c') || document.body
  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        lastDist = Math.hypot(dx, dy)
      }
    },
    { passive: true },
  )
  el.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 2) return
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      if (!lastDist) {
        lastDist = dist
        return
      }
      const delta = (lastDist - dist) / 180
      lastDist = dist
      state.camZoom = THREE.MathUtils.clamp((state.camZoom || 1) + delta, 1, 2)
    },
    { passive: true },
  )
  el.addEventListener(
    'touchend',
    () => {
      lastDist = 0
    },
    { passive: true },
  )
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
  state.isNight = false
  state.inside = null
  state.doorHold = 0
  state.camZoom = 1
  state.running = true
  state.startedAt = Date.now()
  $('roleTag').textContent = state.you
  buildExterior()
  setDayNight(false)
  clearCharacters()
  attachCharacter(state.you, true, 0, 14)
  attachCharacter(state.foe, false, 6, -5)
  attachCrier()
  show('game')
  resize()
  clearInterval(state.timerId)
  state.timerId = setInterval(updateTimer, 250)
  updateTimer()
  crier(
    `Día: puertas cerradas. Noche: se abren (acercate y entrás solo). Pellizcá para alejar la cámara. Sos ${state.you}.`,
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
    if (!state.nearDoor || state.nearDoor.locked) return
    const id = state.inside
    const def = BUILDING_DEFS.find((x) => x.id === id)
    state.inside = null
    buildExterior()
    setDayNight(state.isNight)
    if (def) player.position.set(def.x, player.position.y, def.z + 10)
    else player.position.set(0, player.position.y, 14)
    toast('Salís del edificio')
    return
  }
  if (!state.nearDoor || state.nearDoor.exit || state.nearDoor.locked) return
  if (!state.isNight) {
    toast('Cerrado de día')
    return
  }
  buildInterior(state.nearDoor.doorId || state.nearDoor.id)
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
  mk(state.isNight ? 'Pasar a Día (puertas cierran)' : 'Pasar a Noche (puertas abren)', () => {
    setDayNight(!state.isNight)
    if (state.isNight) {
      state.night += 1
      crier(`Cae la noche ${state.night}. Las puertas se abren. Acercate y entrás solo.`)
    } else {
      crier('Amanece. Las puertas quedan cerradas.')
    }
  })
  mk('Pasar turno (sin acción)', () => {
    crier(state.isNight ? 'La noche sigue…' : 'El día sigue…')
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
$('btnNight').onclick = () => openNightPanel()
setupPinchZoom()
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
