import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'

const MATCH_MS = 30 * 60 * 1000
const WORLD = 180
const $ = (id) => document.getElementById(id)
const TOWN_SCALE = 1
const WALL_W = 2

const BUILDING_DEFS = [
  { id: 'ayuntamiento', name: 'Ayuntamiento', x: -28, z: -24, rotY: 0 },
  { id: 'monasterio', name: 'Monasterio', x: 30, z: -28, rotY: Math.PI * 0.05 },
  { id: 'posada', name: 'Posada', x: 8, z: 34, rotY: -Math.PI * 0.04 },
]
const PLAYABLE_ROLES = ['Alcalde', 'Asesino', 'Dama de compañía']

const CHAR_FILES = {
  'Alcalde': 'chars/Knight.glb',
  'Asesino': 'chars/Rogue_Hooded.glb',
  'Dama de compañía': 'chars/Mage.glb',
  'Pregonero': 'chars/Barbarian.glb',
}
const CHAR_SCALE = 0.52 // KayKit ~3.3u → ~1.75 m


const VILLAGE_FILES = [
  'DoorFrame_Flat_WoodDark.gltf',
  'Stairs_Exterior_Platform.gltf',
  'WindowShutters_Wide_Flat_Closed.gltf',
  'Prop_Vine5.gltf',
  'Prop_Vine4.gltf',
  'Roof_RoundTiles_8x8.gltf',
  'Wall_Arch.gltf',
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
let mixers = []

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

function makeGroundTex(cA, cB, contrast) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#' + cA.toString(16).padStart(6, '0')
  ctx.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 900; i++) {
    const t = Math.random()
    const col = t > contrast ? cA : cB
    ctx.fillStyle = '#' + col.toString(16).padStart(6, '0')
    ctx.globalAlpha = 0.35 + Math.random() * 0.45
    ctx.fillRect((Math.random() * 128) | 0, (Math.random() * 128) | 0, 1 + (Math.random() * 3) | 0, 1 + (Math.random() * 3) | 0)
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
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
    ...Object.values(CHAR_FILES).map((f) => ({ key: f, url: `./models/${f}` })),
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
    { x: -55, z: -35, w: 2, d: 2, plaster: true },
    { x: 55, z: -30, w: 2, d: 2, plaster: false },
    { x: -50, z: 45, w: 2, d: 2, plaster: true },
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

  const dirtTex = makeGroundTex(0x5a4030, 0x3a2818, 0.55)
  const grassTex = makeGroundTex(0x4a6a38, 0x2a4018, 0.35)
  const mudTex = makeGroundTex(0x3a2818, 0x1a1008, 0.7)
  dirtTex.wrapS = dirtTex.wrapT = THREE.RepeatWrapping
  dirtTex.repeat.set(40, 40)
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping
  grassTex.repeat.set(8, 8)
  mudTex.wrapS = mudTex.wrapT = THREE.RepeatWrapping
  mudTex.repeat.set(3, 3)
  const dirt = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD * 2, WORLD * 2),
    new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 }),
  )
  dirt.rotation.x = -Math.PI / 2
  dirt.receiveShadow = true
  worldRoot.add(dirt)
  for (const [x, z, r] of [
    [0, 12, 22],
    [-38, 18, 14],
    [36, -16, 16],
    [8, 42, 12],
    [-28, -38, 14],
  ]) {
    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(r, 32),
      new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }),
    )
    grass.rotation.x = -Math.PI / 2
    grass.position.set(x, 0.03, z)
    grass.receiveShadow = true
    worldRoot.add(grass)
  }
  for (const [x, z, r] of [
    [3, 2, 3.2],
    [-8, -3, 2.4],
    [14, 14, 2.8],
    [-20, 5, 3.5],
    [6, -10, 2.2],
  ]) {
    const mud = new THREE.Mesh(
      new THREE.CircleGeometry(r, 20),
      new THREE.MeshStandardMaterial({ map: mudTex, roughness: 0.95, metalness: 0.02 }),
    )
    mud.rotation.x = -Math.PI / 2
    mud.position.set(x, 0.05, z)
    worldRoot.add(mud)
  }

  buildPlaza()
  buildHouse(-28, -24, {
    id: 'ayuntamiento',
    name: 'Ayuntamiento',
    w: 5,
    d: 4,
    plaster: false,
    rotY: 0,
  })
  if (templates['village/Stairs_Exterior_Straight.gltf']) {
    place('village/Stairs_Exterior_Straight.gltf', -28, 0, -24 + 5, 0, 1)
  }
  worldRoot.add(makeSign('AYUNTAMIENTO', -28, 4.2, -18, 0))

  buildHouse(30, -28, {
    id: 'monasterio',
    name: 'Monasterio',
    w: 4,
    d: 5,
    plaster: true,
    rotY: Math.PI * 0.05,
  })
  place('village/Prop_Chimney2.gltf', 32, 0, -30, 0, 1)
  worldRoot.add(makeSign('MONASTERIO', 30, 4.5, -22, 0))

  buildHouse(8, 34, {
    id: 'posada',
    name: 'Posada',
    w: 4,
    d: 3,
    plaster: false,
    rotY: -Math.PI * 0.04,
  })
  place('village/Prop_Wagon.gltf', 14, 0, 36, 0.8, 1)
  place('village/Prop_Crate.gltf', 12, 0, 32, 0.2, 1)
  worldRoot.add(makeSign('POSADA', 8, 3.8, 38, 0))
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
        mat.color = new THREE.Color(role === 'Dama de compañía' ? 0xc49a78 : 0x9a6540)
        mat.roughness = 0.75
        return mat
      }
      if (role === 'Alcalde') {
        mat.color = new THREE.Color(/pant|leg|boot/.test(name) ? 0x1a2838 : 0x2a5a90)
      } else if (role === 'Pregonero') {
        mat.color = new THREE.Color(/pant|leg|boot/.test(name) ? 0x3a2818 : 0x7a5530)
      } else if (role === 'Dama de compañía') {
        mat.color = new THREE.Color(/pant|leg|boot/.test(name) ? 0x1a0a10 : 0x8a2040)
      } else {
        mat.color = new THREE.Color(0x1a1816)
      }
      mat.metalness = 0.05
      mat.roughness = 0.8
      return mat
    })
    c.material = Array.isArray(c.material) ? next : next[0]
  })
  const kill = []
  root.traverse((c) => {
    const n = `${c.name || ''}`.toLowerCase()
    if (/weapon|gun|rifle|sword|knife|pistol|blade|axe|bow|arrow|shield|spear/.test(n)) kill.push(c)
  })
  for (const c of kill) c.parent?.remove(c)

  if (role === 'Alcalde') {
    const hat = new THREE.Group()
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.13, 0.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.85 }),
    )
    top.position.y = 1.8
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.035, 14),
      new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 }),
    )
    brim.position.y = 1.7
    const chain = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.02, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.3 }),
    )
    chain.position.set(0, 1.35, 0.12)
    chain.rotation.x = Math.PI / 2
    hat.add(top, brim, chain)
    root.add(hat)
  } else if (role === 'Asesino') {
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.6),
      new THREE.MeshStandardMaterial({ color: 0x0a0808, side: THREE.DoubleSide, roughness: 1 }),
    )
    hood.position.set(0, 1.68, 0)
    const mask = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.08, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
    )
    mask.position.set(0, 1.55, 0.12)
    const cloak = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.95, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x0c0a0a, roughness: 0.95, side: THREE.DoubleSide }),
    )
    cloak.position.set(0, 1.15, -0.2)
    root.add(hood, mask, cloak)
  } else if (role === 'Dama de compañía') {
    // look adulto llamativo: vestido abierto, escote, pelo
    const dress = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.55, 1.05, 14),
      new THREE.MeshStandardMaterial({ color: 0x8b1537, roughness: 0.55, metalness: 0.08 }),
    )
    dress.position.set(0, 0.85, 0)
    const bodice = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xc49a78, roughness: 0.7 }),
    )
    bodice.position.set(0, 1.38, 0.06)
    bodice.scale.set(1.35, 0.75, 0.85)
    const cleavage = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xc49a78, roughness: 0.65 }),
    )
    cleavage.position.set(-0.07, 1.4, 0.16)
    const cleavage2 = cleavage.clone()
    cleavage2.position.x = 0.07
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x1a0a08, roughness: 0.8 }),
    )
    hair.position.set(0, 1.72, -0.02)
    hair.scale.set(1.15, 1.05, 1.2)
    const earring = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.25 }),
    )
    earring.position.set(0.16, 1.58, 0.02)
    const earring2 = earring.clone()
    earring2.position.x = -0.16
    root.add(dress, bodice, cleavage, cleavage2, hair, earring, earring2)
  }
}

function makeRoleCharacter(role) {
  const file = CHAR_FILES[role] || CHAR_FILES['Alcalde']
  if (!templates[file]) return makeColonialPerson(role)
  try {
    const { root, animations } = cloneTemplate(file)
    root.scale.setScalar(CHAR_SCALE)
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    root.position.y -= box.min.y
    // quitar armas sueltas del pack (daga/arco visibles)
    const kill = []
    root.traverse((c) => {
      const n = `${c.name || ''}`.toLowerCase()
      if (/weapon|sword|axe|bow|arrow|shield|staff|wand|dagger|knife|spear|crossbow/.test(n)) kill.push(c)
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material]
        for (const m of mats) {
          if (!m) continue
          m.metalness = Math.min(m.metalness ?? 0.2, 0.35)
          m.roughness = Math.max(m.roughness ?? 0.6, 0.45)
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace
        }
      }
    })
    for (const c of kill) c.parent?.remove(c)

    // acentos de rol encima del modelo serio
    if (role === 'Alcalde') {
      const chain = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.015, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.25 }),
      )
      chain.position.set(0, 1.15, 0.1)
      chain.rotation.x = Math.PI / 2
      root.add(chain)
    } else if (role === 'Dama de compañía') {
      const dress = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.38, 0.85, 14),
        new THREE.MeshStandardMaterial({ color: 0x8b1537, roughness: 0.5, transparent: true, opacity: 0.92 }),
      )
      dress.position.set(0, 0.7, 0)
      root.add(dress)
    }

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
  for (const m of mixers) {
    try { m.stopAllAction() } catch {}
  }
  mixers = []
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

function bindCharacterAnims(root, isPlayer) {
  const animations = root.userData.animations || []
  if (!animations.length) return
  const m = new THREE.AnimationMixer(root)
  const walkClip =
    animations.find((a) => /^Walking_A$/i.test(a.name)) ||
    animations.find((a) => /walking_a/i.test(a.name)) ||
    animations.find((a) => /walk/i.test(a.name) && !/back/i.test(a.name)) ||
    animations.find((a) => /running_a/i.test(a.name))
  const idleClip =
    animations.find((a) => /^Idle$/i.test(a.name)) ||
    animations.find((a) => /unarmed_idle/i.test(a.name)) ||
    animations.find((a) => /idle/i.test(a.name) && !/jump|lie|sit|pose/i.test(a.name)) ||
    animations[0]
  const actIdle = m.clipAction(idleClip)
  if (/t-pose/i.test(idleClip.name)) {
    console.warn('idle era T-Pose, usando Unarmed_Idle/Idle fallback')
  }
  actIdle.play()
  actIdle.setEffectiveWeight(1)
  let actWalk = null
  if (walkClip) {
    actWalk = m.clipAction(walkClip)
    actWalk.play()
    actWalk.setEffectiveWeight(0)
  }
  root.userData.mixer = m
  root.userData.actIdle = actIdle
  root.userData.actWalk = actWalk
  mixers.push(m)
  if (isPlayer) {
    player = root
    mixer = m
    playerActions = actWalk || actIdle
  }
}

function setCharMoving(root, moving) {
  const idle = root.userData.actIdle
  const walk = root.userData.actWalk
  if (!idle) return
  if (walk) {
    walk.setEffectiveWeight(moving ? 1 : 0)
    idle.setEffectiveWeight(moving ? 0 : 1)
  }
}

function attachCharacter(role, isPlayer, x, z) {
  const root = makeRoleCharacter(role)
  root.position.set(x, root.position.y || 0, z)
  scene.add(root)
  bindCharacterAnims(root, isPlayer)
  if (isPlayer) player = root
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
  scene.background = new THREE.Color(night ? 0x1a2230 : 0x87a090)
  scene.fog = new THREE.Fog(night ? 0x1a2230 : 0x87a090, night ? 35 : 55, night ? 110 : 150)
  scene.traverse((o) => {
    if (o.isDirectionalLight) {
      o.intensity = night ? 0.45 : 1.15
      o.color.setHex(night ? 0xaabbdd : 0xffe6c0)
    }
    if (o.isHemisphereLight) o.intensity = night ? 0.5 : 1.2
    if (o.isAmbientLight) o.intensity = night ? 0.22 : 0.45
    if (o.isPointLight) o.intensity = night ? 1.3 : 0.55
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
  scene.background = new THREE.Color(0x87a090)
  scene.fog = new THREE.Fog(0x87a090, 55, 150)
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 280)
  clock = new THREE.Clock()
  scene.add(new THREE.HemisphereLight(0xfff0d8, 0x3a4a28, 1.2))
  const sun = new THREE.DirectionalLight(0xffe6c0, 1.15)
  sun.position.set(22, 28, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  scene.add(sun)
  scene.add(new THREE.AmbientLight(0xd8c8a8, 0.45))
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
  for (const m of mixers) m.update(dt)
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
    if (moving) player.rotation.y = Math.atan2(state.move.x, state.move.z)
    setCharMoving(player, moving)
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
  state.you = PLAYABLE_ROLES[Math.floor(Math.random() * PLAYABLE_ROLES.length)]
  const others = PLAYABLE_ROLES.filter((r) => r !== state.you)
  state.foe = others[Math.floor(Math.random() * others.length)]
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
  attachCharacter(state.foe, false, 8, -6)
  attachCrier()
  show('game')
  resize()
  clearInterval(state.timerId)
  state.timerId = setInterval(updateTimer, 250)
  updateTimer()
  crier(
    `Sos ${state.you}. Rival: ${state.foe} (quieto). Día/noche y puertas como antes.`,
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
  if (state.you === 'Dama de compañía') {
    mk('Llamar la atención (Plaza)', () => {
      if (state.inside || Math.hypot(player.position.x, player.position.z) > 14) {
        toast('Mejor en la Plaza')
        return
      }
      crier('La Dama llama todas las miradas en la Plaza…')
      toast('Todos te miran')
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
