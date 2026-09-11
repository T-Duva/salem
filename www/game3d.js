import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const MATCH_MS = 30 * 60 * 1000
const WORLD = 140
const $ = (id) => document.getElementById(id)

const BUILDING_DEFS = [
  {
    id: 'ayuntamiento',
    name: 'Ayuntamiento',
    file: 'building-small-c.glb',
    x: -24,
    z: -20,
    scale: 6,
    rotY: 0,
  },
  {
    id: 'monasterio',
    name: 'Monasterio',
    file: 'building-small-b.glb',
    x: 22,
    z: -24,
    scale: 7,
    rotY: Math.PI * 0.15,
  },
  {
    id: 'posada',
    name: 'Posada',
    file: 'building-small-a.glb',
    x: 10,
    z: 26,
    scale: 6.5,
    rotY: -Math.PI * 0.1,
  },
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
  ctx.font = 'bold 30px sans-serif'
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
  const files = [
    ...new Set([...BUILDING_DEFS.map((b) => b.file), 'soldier.glb', 'grass-trees.glb', 'pavement-fountain.glb']),
  ]
  for (const f of files) {
    status.textContent = `Cargando ${f}…`
    const gltf = await loader.loadAsync(`./models/${f}`)
    templates[f] = gltf
  }
  state.modelsReady = true
  status.textContent = 'Listo'
  $('btnStart').disabled = false
}

function cloneTemplate(file) {
  const gltf = templates[file]
  const root = gltf.scene.clone(true)
  root.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true
      c.receiveShadow = true
    }
  })
  return { root, animations: gltf.animations }
}

function boxOf(obj) {
  const box = new THREE.Box3().setFromObject(obj)
  return box
}

function addColliderFromBox(box, pad = 0.15) {
  colliders.push({
    minX: box.min.x - pad,
    maxX: box.max.x + pad,
    minZ: box.min.z - pad,
    maxZ: box.max.z + pad,
  })
}

function makeDoorProxy(buildingId, name, box) {
  // Door at the +Z side of building footprint, center
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 2.4, 0.25),
    new THREE.MeshStandardMaterial({
      color: 0x1a1008,
      emissive: 0x000000,
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0.35,
    }),
  )
  const x = (box.min.x + box.max.x) / 2
  const z = box.max.z + 0.2
  door.position.set(x, 1.2, z)
  door.userData = { doorId: buildingId, label: name }
  worldRoot.add(door)
  doorMeshes.push(door)
  worldRoot.add(makeSign(name, box.max.x + 0.4, 2.3, box.max.z + 0.8, 0))
}

function buildExterior() {
  colliders = []
  doorMeshes = []
  while (worldRoot.children.length) worldRoot.remove(worldRoot.children[0])

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD * 2, WORLD * 2),
    new THREE.MeshStandardMaterial({ color: 0x6e5a3d }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  worldRoot.add(ground)

  // plaza fountain
  if (templates['pavement-fountain.glb']) {
    const f = cloneTemplate('pavement-fountain.glb').root
    f.scale.setScalar(4)
    f.position.set(0, 0, 0)
    worldRoot.add(f)
  }
  worldRoot.add(makeSign('Plaza', -3, 1.7, 4, 0))

  // trees around
  if (templates['grass-trees.glb']) {
    for (const p of [
      [-35, -10],
      [35, -8],
      [-30, 30],
      [32, 28],
      [-40, 5],
      [40, 0],
    ]) {
      const t = cloneTemplate('grass-trees.glb').root
      t.scale.setScalar(3.5)
      t.position.set(p[0], 0, p[1])
      worldRoot.add(t)
      addColliderFromBox(boxOf(t), 0.5)
    }
  }

  for (const def of BUILDING_DEFS) {
    const { root } = cloneTemplate(def.file)
    root.scale.setScalar(def.scale)
    root.rotation.y = def.rotY
    root.position.set(def.x, 0, def.z)
    worldRoot.add(root)
    // ground align
    const b0 = boxOf(root)
    root.position.y -= b0.min.y
    const box = boxOf(root)
    addColliderFromBox(box, 0.2)
    makeDoorProxy(def.id, def.name, box)
  }

  worldRoot.visible = true
  interiorRoot.visible = false
  $('sectorTag').textContent = 'Salem · exterior'
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
  let bestDist = 2.0
  for (const door of doorMeshes) {
    door.updateWorldMatrix(true, false)
    const wp = new THREE.Vector3()
    door.getWorldPosition(wp)
    const dx = player.position.x - wp.x
    const dz = player.position.z - wp.z
    const dist = Math.hypot(dx, dz)
    const mat = door.material
    const facingOk = state.inside || door.userData.exit ? true : dz > 0.1
    if (dist < 2.0 && facingOk) {
      mat.emissive.setHex(0xc45c26)
      mat.emissiveIntensity = 0.55 + Math.sin(performance.now() / 180) * 0.25
      mat.opacity = 0.85
      if (dist < bestDist) {
        bestDist = dist
        best = door.userData
      }
    } else if (!door.userData.exit) {
      mat.emissive.setHex(0x000000)
      mat.emissiveIntensity = 0
      mat.opacity = 0.35
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

function spawnPlayer() {
  const { root, animations } = cloneTemplate('soldier.glb')
  root.scale.setScalar(1.15)
  // soldier often faces -Z; adjust
  root.rotation.y = Math.PI
  player = root
  player.userData.radius = 0.45
  scene.add(player)
  if (animations?.length) {
    mixer = new THREE.AnimationMixer(player)
    const clip = animations.find((a) => /walk|run|idle/i.test(a.name)) || animations[0]
    playerActions = mixer.clipAction(clip)
    playerActions.play()
  }
  // NPC alcalde visual
  const npc = cloneTemplate('soldier.glb').root
  npc.scale.setScalar(1.1)
  npc.position.set(4, 0, -3)
  npc.rotation.y = Math.PI
  scene.add(npc)
}

function initThree() {
  const canvas = $('c')
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x87a0b4)
  scene.fog = new THREE.Fog(0x87a0b4, 45, 110)
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 220)
  clock = new THREE.Clock()
  scene.add(new THREE.HemisphereLight(0xfff2dd, 0x3a2a18, 1.1))
  const sun = new THREE.DirectionalLight(0xffe6c0, 1.0)
  sun.position.set(25, 35, 12)
  sun.castShadow = true
  scene.add(sun)
  worldRoot = new THREE.Group()
  interiorRoot = new THREE.Group()
  interiorRoot.visible = false
  scene.add(worldRoot)
  scene.add(interiorRoot)
  spawnPlayer()
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
    camera.position.set(player.position.x, 9, player.position.z + 11)
    camera.lookAt(player.position.x, 1.4, player.position.z)
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
  player.position.set(0, 0, 12)
  show('game')
  resize()
  clearInterval(state.timerId)
  state.timerId = setInterval(updateTimer, 250)
  updateTimer()
  crier(`Sos ${state.you}. Edificios con modelos 3D. No se atraviesan. Puerta brillante = ENTRAR.`)
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
    if (def) {
      // spawn in front of door (+Z of building roughly)
      player.position.set(def.x, 0, def.z + 8)
    } else player.position.set(0, 0, 12)
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
      if (state.inside || Math.hypot(player.position.x, player.position.z) > 12) {
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
