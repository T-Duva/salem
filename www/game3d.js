/* global THREE */
const MATCH_MS = 30 * 60 * 1000
const WORLD = 120
const $ = (id) => document.getElementById(id)

const BUILDINGS = [
  {
    id: 'ayuntamiento',
    name: 'Ayuntamiento',
    x: -22,
    z: -18,
    w: 10,
    d: 8,
    h: 6,
    color: 0x6b5344,
    roof: 0x3a2a22,
  },
  {
    id: 'monasterio',
    name: 'Monasterio',
    x: 20,
    z: -22,
    w: 9,
    d: 11,
    h: 7,
    color: 0x5a5a68,
    roof: 0x2a2a35,
    tower: true,
  },
  {
    id: 'posada',
    name: 'Posada',
    x: 8,
    z: 24,
    w: 11,
    d: 7,
    h: 5,
    color: 0x7a4a32,
    roof: 0x4a2018,
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
}

let renderer, scene, camera, player, clock, worldRoot, interiorRoot
let colliders = []
let doorMeshes = []
let exteriorVisible = true

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

function initThree() {
  const canvas = $('c')
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x8aa4b8)
  scene.fog = new THREE.Fog(0x8aa4b8, 40, 95)
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200)
  clock = new THREE.Clock()

  scene.add(new THREE.HemisphereLight(0xfff2dd, 0x3a2a18, 1.15))
  const sun = new THREE.DirectionalLight(0xffe6c0, 0.9)
  sun.position.set(20, 30, 10)
  scene.add(sun)

  player = makePerson(0xc45c26)
  player.position.set(0, 0, 8)
  scene.add(player)

  // quiet rival / alcalde NPC visual near plaza
  const npc = makePerson(0x2f5d8a)
  npc.position.set(3, 0, -2)
  scene.add(npc)

  worldRoot = new THREE.Group()
  interiorRoot = new THREE.Group()
  interiorRoot.visible = false
  scene.add(worldRoot)
  scene.add(interiorRoot)

  buildExterior()
  window.addEventListener('resize', resize)
  resize()
}

function makePerson(color) {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.85, 4, 8),
    new THREE.MeshStandardMaterial({ color }),
  )
  body.position.y = 0.95
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8c4a0 }),
  )
  head.position.y = 1.85
  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.4, 0.2, 10),
    new THREE.MeshStandardMaterial({ color: 0x1a120c }),
  )
  hat.position.y = 2.1
  g.add(body, head, hat)
  g.userData.radius = 0.4
  return g
}

function addMesh(parent, geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  parent.add(m)
  return m
}

function addCollider(x, z, w, d) {
  colliders.push({
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
  })
}

function makeSign(text, x, y, z, rotY) {
  const g = new THREE.Group()
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.7, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xf0e0c0 }),
  )
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 1.4, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x3a2a18 }),
  )
  post.position.y = -0.9
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
    new THREE.PlaneGeometry(2.2, 0.55),
    new THREE.MeshBasicMaterial({ map: tex }),
  )
  label.position.z = 0.05
  g.add(label)
  g.position.set(x, y, z)
  g.rotation.y = rotY || 0
  return g
}

function buildBuilding(b) {
  const g = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ color: b.color })
  const roofMat = new THREE.MeshStandardMaterial({ color: b.roof })
  const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), bodyMat)
  body.position.y = b.h / 2
  g.add(body)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.8, 0.5, b.d + 0.8), roofMat)
  roof.position.y = b.h + 0.2
  g.add(roof)
  if (b.tower) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.5, b.h + 3, 2.5), bodyMat)
    tower.position.set(-b.w / 2 + 1.5, (b.h + 3) / 2, -b.d / 2 + 1.5)
    g.add(tower)
    const spire = new THREE.Mesh(
      new THREE.ConeGeometry(1.4, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x222230 }),
    )
    spire.position.set(-b.w / 2 + 1.5, b.h + 4.2, -b.d / 2 + 1.5)
    g.add(spire)
  }
  // door on +Z face
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 2.3, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x1a1008, emissive: 0x000000, emissiveIntensity: 0 }),
  )
  door.position.set(0, 1.15, b.d / 2 + 0.05)
  door.userData = { doorId: b.id, label: b.name }
  g.add(door)
  doorMeshes.push(door)

  const sign = makeSign(b.name, b.w / 2 - 0.2, 2.2, b.d / 2 + 0.6, 0)
  g.add(sign)

  g.position.set(b.x, 0, b.z)
  worldRoot.add(g)
  addCollider(b.x, b.z, b.w + 0.4, b.d + 0.4)
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
  worldRoot.add(ground)

  // plaza markers / gallows
  const pole = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 4, 0.25),
    new THREE.MeshStandardMaterial({ color: 0x2a1c12 }),
  )
  pole.position.set(0, 2, 0)
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.25, 0.25),
    new THREE.MeshStandardMaterial({ color: 0x2a1c12 }),
  )
  beam.position.set(0, 3.9, 0)
  worldRoot.add(pole, beam)
  worldRoot.add(makeSign('Plaza', -2.5, 1.6, 2.5, 0))

  // scattered props (non-blocking small)
  for (let i = 0; i < 18; i++) {
    const x = (Math.random() - 0.5) * 90
    const z = (Math.random() - 0.5) * 90
    if (Math.hypot(x, z) < 12) continue
    const rock = new THREE.Mesh(
      new THREE.BoxGeometry(1 + Math.random(), 0.5, 1 + Math.random()),
      new THREE.MeshStandardMaterial({ color: 0x5a5040 }),
    )
    rock.position.set(x, 0.25, z)
    worldRoot.add(rock)
  }

  for (const b of BUILDINGS) buildBuilding(b)
  exteriorVisible = true
  worldRoot.visible = true
  interiorRoot.visible = false
  $('sectorTag').textContent = 'Salem · exterior'
}

function buildInterior(id) {
  while (interiorRoot.children.length) interiorRoot.remove(interiorRoot.children[0])
  const b = BUILDINGS.find((x) => x.id === id)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({ color: b ? b.color : 0x4a3a28 }),
  )
  floor.rotation.x = -Math.PI / 2
  interiorRoot.add(floor)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2018 })
  ;[
    [0, 2, -6.5, 12, 4, 0.4],
    [0, 2, 6.5, 12, 4, 0.4],
    [-6.5, 2, 0, 0.4, 4, 12],
    [6.5, 2, 0, 0.4, 4, 12],
  ].forEach(([x, y, z, sx, sy, sz]) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat)
    w.position.set(x, y, z)
    interiorRoot.add(w)
  })
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 2.3, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0xc45c26, emissiveIntensity: 0.65 }),
  )
  door.position.set(0, 1.15, 6.3)
  door.userData = { doorId: id, label: 'Salida', exit: true }
  interiorRoot.add(door)
  doorMeshes = [door]
  interiorRoot.add(makeSign(b?.name || id, -2.2, 2.4, 6.1, 0))

  state.inside = id
  exteriorVisible = false
  worldRoot.visible = false
  interiorRoot.visible = true
  player.position.set(0, 0, 3)
  $('sectorTag').textContent = b?.name || id
  $('btnEnter').disabled = false
  $('btnEnter').textContent = 'SALIR'
  crier(`Dentro de ${b?.name || id}. Acercate a la puerta brillante para salir.`)
}

function resolveMove(fromX, fromZ, toX, toZ, radius) {
  if (state.inside) {
    toX = THREE.MathUtils.clamp(toX, -5.5, 5.5)
    toZ = THREE.MathUtils.clamp(toZ, -5.5, 5.5)
    return { x: toX, z: toZ }
  }
  let x = toX
  let z = toZ
  // try full move, then slide
  if (!hits(x, z, radius)) return { x, z }
  if (!hits(toX, fromZ, radius)) return { x: toX, z: fromZ }
  if (!hits(fromX, toZ, radius)) return { x: fromX, z: toZ }
  return { x: fromX, z: fromZ }
}

function hits(x, z, radius) {
  for (const c of colliders) {
    const nearestX = THREE.MathUtils.clamp(x, c.minX, c.maxX)
    const nearestZ = THREE.MathUtils.clamp(z, c.minZ, c.maxZ)
    const dx = x - nearestX
    const dz = z - nearestZ
    if (dx * dx + dz * dz < radius * radius) return true
  }
  return false
}

function updateDoors() {
  state.nearDoor = null
  let best = null
  let bestDist = 1.85
  for (const door of doorMeshes) {
    door.updateWorldMatrix(true, false)
    const wp = new THREE.Vector3()
    door.getWorldPosition(wp)
    // only count approach from outside (+Z local for exterior doors)
    const dx = player.position.x - wp.x
    const dz = player.position.z - wp.z
    const dist = Math.hypot(dx, dz)
    const mat = door.material
    const facingOk = state.inside || door.userData.exit ? true : dz > 0.15
    if (dist < 1.85 && facingOk) {
      mat.emissive.setHex(0xc45c26)
      mat.emissiveIntensity = 0.5 + Math.sin(performance.now() / 180) * 0.25
      if (dist < bestDist) {
        bestDist = dist
        best = door.userData
      }
    } else if (!door.userData.exit) {
      mat.emissive.setHex(0x000000)
      mat.emissiveIntensity = 0
    }
  }
  state.nearDoor = best
  const btn = $('btnEnter')
  if (state.inside) {
    btn.disabled = !best
    btn.textContent = best ? 'SALIR' : 'SALIR'
  } else if (best) {
    btn.disabled = false
    btn.textContent = `ENTRAR · ${best.label}`
  } else {
    btn.disabled = true
    btn.textContent = 'ENTRAR'
  }
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
  if (state.running && $('game').classList.contains('active')) {
    const speed = 6
    const fromX = player.position.x
    const fromZ = player.position.z
    const toX = fromX + state.move.x * speed * dt
    const toZ = fromZ + state.move.z * speed * dt
    const next = resolveMove(fromX, fromZ, toX, toZ, player.userData.radius || 0.4)
    player.position.x = next.x
    player.position.z = next.z
    if (state.move.x || state.move.z) {
      player.rotation.y = Math.atan2(state.move.x, state.move.z)
    }
    updateDoors()
    camera.position.set(player.position.x, 8.2, player.position.z + 10)
    camera.lookAt(player.position.x, 1.2, player.position.z)
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
  if (!renderer) initThree()
  state.you = Math.random() < 0.5 ? 'Alcalde' : 'Asesino'
  state.foe = state.you === 'Alcalde' ? 'Asesino' : 'Alcalde'
  state.youHp = 100
  state.foeHp = 100
  state.youActions = 10
  state.revealedMayor = false
  state.night = 0
  state.inside = null
  state.running = true
  state.startedAt = Date.now()
  $('roleTag').textContent = state.you
  buildExterior()
  player.position.set(0, 0, 10)
  show('game')
  resize()
  clearInterval(state.timerId)
  state.timerId = setInterval(updateTimer, 250)
  updateTimer()
  crier(
    `Sos ${state.you}. Mundo abierto de Salem: los edificios no se atraviesan. Acercate a la puerta (brilla) y tocá ENTRAR.`,
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
    const b = BUILDINGS.find((x) => x.id === id)
    state.inside = null
    buildExterior()
    if (b) player.position.set(b.x, 0, b.z + b.d / 2 + 2.2)
    else player.position.set(0, 0, 8)
    $('btnEnter').textContent = 'ENTRAR'
    toast('Salís del edificio')
    crier('Volviste al exterior de Salem.')
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
    crier(`Amanece. Noche ${state.night} terminada.`)
  })
  if (state.you === 'Asesino') {
    mk('Atacar rival en este lugar (50%)', () => {
      state.night += 1
      const here = state.inside || 'exterior'
      if (here !== 'posada') {
        state.youActions = Math.max(0, state.youActions - 1)
        crier('No estaba el rival acá. Sin acierto.')
        toast('Sin acierto')
      } else {
        state.foeHp = Math.max(0, state.foeHp - 50)
        crier(`Acuchillado: rival ${state.foeHp} vida.`)
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
    mk('Revelar identidad (en Plaza exterior)', () => {
      if (state.inside || Math.hypot(player.position.x, player.position.z) > 10) {
        toast('Solo cerca de la Plaza, afuera')
        return
      }
      state.revealedMayor = true
      state.youActions += 10
      crier('¡El Alcalde se revela! Todos ven el cartelito.')
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
  toast('En el celular, Salir cierra la app.')
}

setupJoystick()
show('menu')
requestAnimationFrame(tick)
