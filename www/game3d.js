/* global THREE */
const MATCH_MS = 30 * 60 * 1000
const SECTORS = {
  plaza: {
    name: 'Plaza',
    doors: [
      { id: 'ayuntamiento', label: 'Ayuntamiento', x: -8, z: -6 },
      { id: 'monasterio', label: 'Monasterio', x: 8, z: -6 },
      { id: 'posada', label: 'Posada', x: 0, z: 8 },
    ],
    exits: { n: 'norte', e: 'este', w: 'oeste', s: 'sur' },
  },
  norte: {
    name: 'Camino norte',
    doors: [{ id: 'monasterio', label: 'Monasterio', x: 0, z: -7 }],
    exits: { s: 'plaza', e: 'este', w: 'oeste' },
  },
  este: {
    name: 'Camino este',
    doors: [{ id: 'posada', label: 'Posada', x: 6, z: 0 }],
    exits: { w: 'plaza', n: 'norte', s: 'sur' },
  },
  oeste: {
    name: 'Camino oeste',
    doors: [{ id: 'ayuntamiento', label: 'Ayuntamiento', x: -6, z: 0 }],
    exits: { e: 'plaza', n: 'norte', s: 'sur' },
  },
  sur: {
    name: 'Descampado sur',
    doors: [],
    exits: { n: 'plaza', e: 'este', w: 'oeste' },
  },
}

const INTERIORS = {
  ayuntamiento: { name: 'Ayuntamiento', color: 0x4a3a28 },
  monasterio: { name: 'Monasterio', color: 0x3a3a4a },
  posada: { name: 'Posada', color: 0x4a2a22 },
}

const $ = (id) => document.getElementById(id)
const state = {
  running: false,
  you: null,
  foe: null,
  youHp: 100,
  foeHp: 100,
  youActions: 10,
  revealedMayor: false,
  night: 0,
  sector: 'plaza',
  inside: null,
  nearDoor: null,
  startedAt: 0,
  timerId: null,
  move: { x: 0, z: 0 },
}

let renderer, scene, camera, player, clock
let doorMeshes = []
let worldRoot
const keys = { active: false }

function show(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.remove('active')
  $(id).classList.add('active')
}

function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.style.display = 'block'
  clearTimeout(toast._t)
  toast._t = setTimeout(() => { t.style.display = 'none' }, 2200)
}

function crier(t) { $('crier').textContent = t }

function initThree() {
  const canvas = $('c')
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  resize()
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x87a0b4)
  scene.fog = new THREE.Fog(0x87a0b4, 18, 42)
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 80)
  clock = new THREE.Clock()

  const hemi = new THREE.HemisphereLight(0xfff2dd, 0x3a2a18, 1.1)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xffe6c0, 0.85)
  sun.position.set(8, 14, 6)
  scene.add(sun)

  player = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.9, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0xc45c26 }),
  )
  player.position.set(0, 0.9, 4)
  scene.add(player)

  worldRoot = new THREE.Group()
  scene.add(worldRoot)
  buildSector('plaza')
  window.addEventListener('resize', resize)
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

function clearWorld() {
  while (worldRoot.children.length) {
    const o = worldRoot.children.pop()
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose()
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose())
        else c.material.dispose()
      }
    })
  }
  doorMeshes = []
}

function addBox(x, y, z, sx, sy, sz, color) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color }),
  )
  m.position.set(x, y, z)
  worldRoot.add(m)
  return m
}

function buildSector(id) {
  clearWorld()
  state.sector = id
  state.inside = null
  state.nearDoor = null
  const def = SECTORS[id]
  $('sectorTag').textContent = def.name
  $('btnEnter').disabled = true

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x6b5a3e }),
  )
  ground.rotation.x = -Math.PI / 2
  worldRoot.add(ground)

  // simple “city” props
  addBox(-12, 1.2, -12, 3, 2.4, 3, 0x5a4634)
  addBox(12, 1.5, -10, 4, 3, 3, 0x4a4038)
  addBox(-10, 1, 10, 2.5, 2, 2.5, 0x554433)
  addBox(11, 0.8, 9, 3, 1.6, 2, 0x4a3828)
  // gallows hint in plaza
  if (id === 'plaza') {
    addBox(0, 1.6, -2, 0.2, 3.2, 0.2, 0x2a1c12)
    addBox(0, 3.1, -2, 2.2, 0.2, 0.2, 0x2a1c12)
  }

  for (const d of def.doors) {
    const building = addBox(d.x, 1.6, d.z, 3.2, 3.2, 3.2, 0x3d2f24)
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 2.1, 0.15),
      new THREE.MeshStandardMaterial({
        color: 0x1a1008,
        emissive: 0x000000,
        emissiveIntensity: 0,
      }),
    )
    door.position.set(d.x, 1.05, d.z + 1.65)
    door.userData = { doorId: d.id, label: d.label }
    worldRoot.add(door)
    doorMeshes.push(door)
    // label pole
    addBox(d.x, 3.5, d.z, 0.15, 0.6, 0.15, 0x222)
  }

  // edge markers
  addBox(0, 0.05, -19, 18, 0.1, 0.4, 0x8a7050)
  addBox(0, 0.05, 19, 18, 0.1, 0.4, 0x8a7050)
  addBox(-19, 0.05, 0, 0.4, 0.1, 18, 0x8a7050)
  addBox(19, 0.05, 0, 0.4, 0.1, 18, 0x8a7050)

  if (id === 'plaza') crier('Plaza central. El Pregonero está aquí (todos lo ven). Acercate a una puerta que brille y tocá ENTRAR.')
  else crier(`Estás en ${def.name}.`)
}

function buildInterior(id) {
  clearWorld()
  state.inside = id
  state.nearDoor = { id, label: INTERIORS[id].name, exit: true }
  $('sectorTag').textContent = INTERIORS[id].name
  $('btnEnter').disabled = false
  $('btnEnter').textContent = 'SALIR'

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({ color: INTERIORS[id].color }),
  )
  ground.rotation.x = -Math.PI / 2
  worldRoot.add(ground)
  // walls
  addBox(0, 2, -6.5, 12, 4, 0.4, 0x2a2018)
  addBox(0, 2, 6.5, 12, 4, 0.4, 0x2a2018)
  addBox(-6.5, 2, 0, 0.4, 4, 12, 0x2a2018)
  addBox(6.5, 2, 0, 0.4, 4, 12, 0x2a2018)
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 2.2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0xc45c26, emissiveIntensity: 0.6 }),
  )
  door.position.set(0, 1.1, 6.3)
  door.userData = { doorId: id, label: 'Salida', exit: true }
  worldRoot.add(door)
  doorMeshes = [door]
  player.position.set(0, 0.9, 3)
  crier(`Dentro de ${INTERIORS[id].name}. Tocá SALIR en la barra para volver afuera.`)
}

function updateDoors(dt) {
  state.nearDoor = null
  let best = null
  let bestDist = 2.4
  for (const door of doorMeshes) {
    const dx = player.position.x - door.position.x
    const dz = player.position.z - door.position.z
    const dist = Math.hypot(dx, dz)
    const mat = door.material
    if (dist < 2.4) {
      mat.emissive.setHex(0xc45c26)
      mat.emissiveIntensity = 0.55 + Math.sin(performance.now() / 200) * 0.2
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
    btn.disabled = false
    btn.textContent = 'SALIR'
  } else if (best) {
    btn.disabled = false
    btn.textContent = `ENTRAR · ${best.label}`
  } else {
    btn.disabled = true
    btn.textContent = 'ENTRAR'
  }
}

function tryEdgeTransition() {
  if (state.inside) return
  const def = SECTORS[state.sector]
  const lim = 17.5
  let next = null
  let spawn = null
  if (player.position.z < -lim && def.exits.n) {
    next = def.exits.n
    spawn = { x: player.position.x, z: 16 }
  } else if (player.position.z > lim && def.exits.s) {
    next = def.exits.s
    spawn = { x: player.position.x, z: -16 }
  } else if (player.position.x > lim && def.exits.e) {
    next = def.exits.e
    spawn = { x: -16, z: player.position.z }
  } else if (player.position.x < -lim && def.exits.w) {
    next = def.exits.w
    spawn = { x: 16, z: player.position.z }
  }
  if (next) {
    buildSector(next)
    player.position.set(spawn.x, 0.9, spawn.z)
    toast(`Pasás a: ${SECTORS[next].name}`)
  } else {
    player.position.x = THREE.MathUtils.clamp(player.position.x, -18, 18)
    player.position.z = THREE.MathUtils.clamp(player.position.z, -18, 18)
  }
}

function tick() {
  requestAnimationFrame(tick)
  if (!renderer) return
  const dt = Math.min(clock.getDelta(), 0.05)
  if (state.running && showGame()) {
    const speed = 5.5
    player.position.x += state.move.x * speed * dt
    player.position.z += state.move.z * speed * dt
    if (state.move.x || state.move.z) {
      player.rotation.y = Math.atan2(state.move.x, state.move.z)
    }
    tryEdgeTransition()
    updateDoors(dt)
    camera.position.set(player.position.x, 7.5, player.position.z + 9)
    camera.lookAt(player.position.x, 1, player.position.z)
  }
  renderer.render(scene, camera)
}

function showGame() {
  return $('game').classList.contains('active')
}

function setupJoystick() {
  const zone = $('joyZone')
  const knob = $('joyKnob')
  const base = $('joyBase')
  let pid = null
  const center = { x: 55, y: 55 }
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
  state.running = true
  state.startedAt = Date.now()
  $('roleTag').textContent = state.you
  buildSector('plaza')
  player.position.set(0, 0.9, 5)
  show('game')
  resize()
  clearInterval(state.timerId)
  state.timerId = setInterval(updateTimer, 250)
  updateTimer()
  crier(`Sos ${state.you}. El ${state.foe} está quieto. Caminá con el joystick.`)
}

function updateTimer() {
  const left = Math.max(0, MATCH_MS - (Date.now() - state.startedAt))
  const m = Math.floor(left / 60000)
  const s = Math.floor((left % 60000) / 1000)
  $('timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  if (left <= 0 && state.running) {
    state.running = false
    $('endTitle').textContent = state.youHp >= state.foeHp ? 'Tiempo' : 'Tiempo'
    $('endText').textContent = 'Se cumplieron 30 minutos.'
    show('end')
  }
}

function doEnter() {
  if (state.inside) {
    const back = state.inside
    buildSector('plaza')
    // spawn near that door if present
    const door = SECTORS.plaza.doors.find((d) => d.id === back)
    if (door) player.position.set(door.x, 0.9, door.z + 3)
    else player.position.set(0, 0.9, 4)
    $('btnEnter').textContent = 'ENTRAR'
    toast('Salís del refugio')
    return
  }
  if (!state.nearDoor) return
  buildInterior(state.nearDoor.id)
  toast(`Entras a ${state.nearDoor.label}`)
}

function openNightPanel() {
  const body = $('panelBody')
  body.innerHTML = ''
  $('panelTitle').textContent = `Noche ${state.night + 1} · estás en ${state.inside || SECTORS[state.sector].name}`
  const mk = (label, fn) => {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = () => { fn(); $('panel').classList.add('hidden') }
    body.appendChild(b)
  }
  mk('Pasar noche (sin acción)', () => {
    state.night += 1
    crier(`Amanece la noche ${state.night}. Nada grave…`)
  })
  if (state.you === 'Asesino') {
    mk('Atacar rival aquí (50%)', () => {
      // foe quiet in posada interior conceptually unless same place
      const here = state.inside || 'aire'
      const foeHere = 'posada'
      state.night += 1
      if (here !== foeHere) {
        state.youActions = Math.max(0, state.youActions - 1)
        crier('Atacaste… pero el rival no estaba en este refugio.')
        toast('Sin acierto (−1 acción)')
      } else {
        state.foeHp = Math.max(0, state.foeHp - 50)
        crier(`Acuchillado: rival queda en ${state.foeHp} de vida.`)
        toast(`Rival ${state.foeHp} HP`)
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
      if (state.sector !== 'plaza' || state.inside) {
        toast('Solo en la Plaza, afuera')
        return
      }
      state.revealedMayor = true
      state.youActions += 10
      crier('¡El Alcalde se revela! Todos ven el cartelito.')
      toast('Identidad revelada')
    })
    mk('Info: ¿dónde está el rival? (1)', () => {
      if (state.youActions < 1) return toast('Sin acciones')
      state.youActions -= 1
      state.night += 1
      crier('Nota del amanecer: el rival quieto pasa las noches en la Posada.')
      toast('Rival en Posada')
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
// warm three on first paint after menu interaction only
requestAnimationFrame(tick)
