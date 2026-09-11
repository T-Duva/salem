const PLACES = [
  { id: 'plaza', name: 'Plaza', bot: false, note: 'Pregonero fijo. Todos lo ven.' },
  { id: 'ayuntamiento', name: 'Ayuntamiento', bot: true, note: '1 bot quieto.' },
  { id: 'monasterio', name: 'Monasterio', bot: true, note: '1 bot quieto.' },
  { id: 'posada', name: 'Posada', bot: true, note: '1 bot quieto.' },
  { id: 'aire', name: 'Aire libre', bot: false, note: 'Cuenta como lugar: podés ligar acciones acá.' },
]

const MATCH_MS = 30 * 60 * 1000
const DAMAGE = { acuchillado: 50 }

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
  phase: 'day', // day | shelter | plan | resolve
  place: 'plaza',
  foePlace: 'posada',
  planned: null,
  confirmedAt: null,
  logs: [],
  startedAt: 0,
  timerId: null,
}

function show(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.remove('active')
  $(id).classList.add('active')
}

function toast(msg) {
  const t = $('toast')
  t.textContent = msg
  t.style.display = 'block'
  clearTimeout(toast._t)
  toast._t = setTimeout(() => { t.style.display = 'none' }, 2800)
}

function log(line) {
  const stamp = gameClock()
  state.logs.unshift(`${stamp} — ${line}`)
  $('log').textContent = state.logs.slice(0, 40).join('\n')
}

function gameClock() {
  const elapsed = Date.now() - state.startedAt
  const m = Math.floor(elapsed / 60000)
  const s = Math.floor((elapsed % 60000) / 1000)
  return `Noche ${state.night} · ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function crier(text) {
  $('crier').textContent = text
}

function placeName(id) {
  return PLACES.find((p) => p.id === id)?.name || id
}

function setHp() {
  $('youHp').textContent = state.youHp
  $('foeHp').textContent = state.foeHp
  $('youBar').style.width = `${Math.max(0, state.youHp)}%`
  $('foeBar').style.width = `${Math.max(0, state.foeHp)}%`
}

function updateTimer() {
  const left = Math.max(0, MATCH_MS - (Date.now() - state.startedAt))
  const m = Math.floor(left / 60000)
  const s = Math.floor((left % 60000) / 1000)
  $('timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  if (left <= 0 && state.running) endByTimeout()
}

function startMatch() {
  const youIsMayor = Math.random() < 0.5
  state.you = youIsMayor ? 'Alcalde' : 'Asesino'
  state.foe = youIsMayor ? 'Asesino' : 'Alcalde'
  state.youHp = 100
  state.foeHp = 100
  state.youActions = 10
  state.revealedMayor = false
  state.night = 0
  state.phase = 'day'
  state.place = 'plaza'
  state.foePlace = 'posada'
  state.planned = null
  state.logs = []
  state.startedAt = Date.now()
  state.running = true

  $('youRole').textContent = state.you
  $('foeRole').textContent = state.foe + ' (quieto)'
  setHp()
  crier('El Pregonero abre la plaza: comienza la prueba. Yo estoy aquí; todos me ven.')
  log(`Partida iniciada. Vos sos ${state.you}. Rival quieto: ${state.foe}.`)
  show('game')
  render()
  clearInterval(state.timerId)
  state.timerId = setInterval(updateTimer, 250)
  updateTimer()
}

function endMatch(title, text) {
  state.running = false
  clearInterval(state.timerId)
  $('endTitle').textContent = title
  $('endText').textContent = text
  show('end')
}

function endByTimeout() {
  log('Se cumplieron 30 minutos.')
  if (state.youHp <= 0 && state.foeHp > 0) return endMatch('Derrota', 'Se acabó el tiempo y vos estabas muerto.')
  if (state.foeHp <= 0 && state.youHp > 0) return endMatch('Victoria', 'Se acabó el tiempo: el rival ya había caído.')
  if (state.youHp > state.foeHp) return endMatch('Victoria (tiempo)', 'A los 30 min ganás por más vida.')
  if (state.foeHp > state.youHp) return endMatch('Derrota (tiempo)', 'A los 30 min el rival tenía más vida.')
  return endMatch('Empate', 'A los 30 min empataron en vida. El Pregonero lo anuncia.')
}

function checkDeaths() {
  if (state.youHp <= 0) {
    crier('Ha muerto el jugador. Fin de la prueba.')
    endMatch('Derrota', 'Tu vida llegó a 0.')
    return true
  }
  if (state.foeHp <= 0) {
    crier(`Ha caído el ${state.foe}. Gana el gremio del ${state.you}.`)
    endMatch('Victoria', `Eliminaste al ${state.foe}.`)
    return true
  }
  return false
}

function renderPlaces() {
  const box = $('places')
  box.innerHTML = ''
  for (const p of PLACES) {
    const b = document.createElement('button')
    b.textContent = p.name + (p.bot ? ' · bot' : '')
    if (state.place === p.id) b.classList.add('here')
    b.onclick = () => {
      if (!state.running) return
      if (state.phase !== 'day' && state.phase !== 'shelter') {
        toast('Solo podés cambiar de lugar de día o al refugiarte.')
        return
      }
      state.place = p.id
      log(`Te movés a ${p.name}.`)
      render()
    }
    box.appendChild(b)
  }
  const cur = PLACES.find((p) => p.id === state.place)
  $('placeNow').textContent = cur.name
  $('placeHint').textContent = cur.note
}

function renderActions() {
  const box = $('actions')
  const hint = $('actionHint')
  box.innerHTML = ''
  hint.textContent = ''

  if (state.phase === 'day') {
    hint.textContent = 'De día podés moverte. Si sos Alcalde, podés revelarte en la Plaza.'
    addBtn(box, 'Pasar a la noche', () => beginNight())
    if (state.you === 'Alcalde' && state.place === 'plaza' && !state.revealedMayor) {
      addBtn(box, 'Revelar identidad', () => {
        state.revealedMayor = true
        state.youActions += 10
        crier('¡El Alcalde se revela en la plaza! Todos ven el cartelito sobre su cabeza.')
        log('Alcalde revela su identidad. Todos lo conocen. +10 acciones.')
        toast('Todos saben que sos el Alcalde.')
        render()
      })
    }
    if (state.you === 'Alcalde' && state.revealedMayor) {
      addBtn(box, 'Horca sin voto (rival)', () => {
        if (state.youActions < 1) return toast('Sin acciones')
        state.foeHp = 0
        log('Alcalde manda al rival a la horca sin votación.')
        crier('Por orden del Alcalde, el acusado va a la horca.')
        checkDeaths()
      })
    }
    return
  }

  if (state.phase === 'shelter') {
    hint.textContent = 'Elegí refugio (o aire libre) y confirmá. Después planificás la acción.'
    addBtn(box, 'Confirmar refugio', () => {
      log(`Confirmás refugio: ${placeName(state.place)}.`)
      // rival quieto se queda donde está
      state.phase = 'plan'
      state.planned = null
      render()
    })
    return
  }

  if (state.phase === 'plan') {
    hint.textContent = `Acciones restantes: ${state.youActions}. Confirmá una acción (orden = quién confirma primero; el rival quieto no actúa).`
    addBtn(box, 'No hacer nada', () => confirmPlan({ type: 'idle' }))
    if (state.you === 'Asesino') {
      addBtn(box, 'Atacar rival (Acuchillado 50%)', () => confirmPlan({ type: 'stab' }))
    }
    if (state.you === 'Alcalde') {
      addBtn(box, 'Info: ¿dónde está el rival? (1)', () => confirmPlan({ type: 'info_where' }))
      addBtn(box, 'Info: todo en MI refugio (2)', () => confirmPlan({ type: 'info_here' }))
    }
    return
  }
}

function addBtn(box, label, fn) {
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = fn
  box.appendChild(b)
}

function beginNight() {
  state.night += 1
  state.phase = 'shelter'
  state.planned = null
  crier(`Cae la noche ${state.night}. Refugiense…`)
  log(`Empieza la noche ${state.night}. Fase: refugiarse.`)
  render()
}

function confirmPlan(plan) {
  state.planned = plan
  state.confirmedAt = Date.now()
  log(`Confirmás plan: ${labelPlan(plan)}.`)
  resolveNight()
}

function labelPlan(plan) {
  if (!plan) return 'nada'
  if (plan.type === 'idle') return 'no hacer nada'
  if (plan.type === 'stab') return 'acuchillar al rival'
  if (plan.type === 'info_where') return 'preguntar dónde está el rival'
  if (plan.type === 'info_here') return 'revisar tu refugio'
  return plan.type
}

function resolveNight() {
  state.phase = 'resolve'
  // Solo vos actuás; rival quieto no confirma → tu acción siempre “primera”
  const plan = state.planned
  let spent = false
  let blocked = false

  if (plan.type === 'stab') {
    if (state.place !== state.foePlace) {
      log(`Ataque falló: el rival no está en ${placeName(state.place)} (está en ${placeName(state.foePlace)}). Sin acierto.`)
      crier('Se oye un forcejeo… pero el objetivo no estaba ahí.')
      // fallar por no estar = no es "impedido"; descuenta 1 acción según G
      if (state.youActions > 0) state.youActions -= 1
      spent = true
    } else {
      state.foeHp = Math.max(0, state.foeHp - DAMAGE.acuchillado)
      log(`Acuchillado en ${placeName(state.place)}: rival pasa a ${state.foeHp} de vida (−50%).`)
      crier(`En ${placeName(state.place)} hubo sangre. Alguien fue herido de gravedad.`)
      spent = true
    }
  } else if (plan.type === 'info_where') {
    if (state.youActions < 1) {
      blocked = true
      log('No pudiste informar: sin acciones. No se descuenta.')
    } else {
      state.youActions -= 1
      spent = true
      const msg = `El rival (quieto) pasó la noche en ${placeName(state.foePlace)}.`
      log(msg + ' (info al fin de noche)')
      crier('Una nota llega al Amanecer…')
      setTimeout(() => toast(msg), 400)
    }
  } else if (plan.type === 'info_here') {
    if (state.youActions < 2) {
      blocked = true
      log('No pudiste revisar el refugio: faltan acciones. No se descuenta.')
    } else {
      state.youActions -= 2
      spent = true
      const who = []
      if (state.place === 'plaza') who.push('Pregonero')
      if (PLACES.find((p) => p.id === state.place)?.bot) who.push('1 bot quieto')
      if (state.foePlace === state.place) who.push(`el ${state.foe}`)
      who.push('vos')
      const msg = `En ${placeName(state.place)} esta noche: ${who.join(', ')}.`
      log(msg)
      setTimeout(() => toast(msg), 400)
    }
  } else {
    log('Pasás la noche sin acción.')
    crier('Una noche quieta… demasiado quieta.')
  }

  if (spent) log(`Acciones restantes: ${state.youActions}.`)
  if (blocked) log('Acción impedida/ imposibilitada: no gastaste recurso.')

  setHp()
  if (checkDeaths()) return

  state.phase = 'day'
  crier(`Amanece. El Pregonero resume la noche ${state.night}.`)
  log(`Fin de noche ${state.night}. Vuelve el día.`)
  render()
}

function render() {
  $('phaseTag').textContent = state.phase === 'day' ? 'Día' : 'Noche'
  $('nightTag').textContent = `Noche ${state.night}`
  renderPlaces()
  renderActions()
  setHp()
}

$('btnStart').onclick = () => startMatch()
$('btnAgain').onclick = () => show('menu')
$('btnMenu').onclick = () => {
  state.running = false
  clearInterval(state.timerId)
  show('menu')
}
$('btnExit').onclick = async () => {
  try {
    if (window.Capacitor?.Plugins?.App) {
      await window.Capacitor.Plugins.App.exitApp()
      return
    }
  } catch {}
  // WebView Android bridge
  try {
    if (window.SalemAndroid?.exitApp) {
      window.SalemAndroid.exitApp()
      return
    }
  } catch {}
  toast('En el celular, Salir cierra la app.')
  window.close()
}
