/* Auto-update vs GitHub T-Duva/salem */
;(function () {
  const REPO = 'T-Duva/salem'
  const APK_NAME = 'salem.apk'
  const FALLBACK_URL = `https://github.com/${REPO}/releases/latest/download/${APK_NAME}`

  function parseSemver(v) {
    const m = String(v || '')
      .replace(/^v/i, '')
      .trim()
      .match(/(\d+)\.(\d+)\.(\d+)/)
    if (!m) return null
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }

  function isNewer(remote, local) {
    const a = parseSemver(remote)
    const b = parseSemver(local)
    if (!a || !b) return false
    for (let i = 0; i < 3; i++) {
      if (a[i] > b[i]) return true
      if (a[i] < b[i]) return false
    }
    return false
  }

  function toast(msg) {
    const t = document.getElementById('toast')
    if (!t) return
    t.textContent = msg
    t.style.display = 'block'
    clearTimeout(toast._t)
    toast._t = setTimeout(() => {
      t.style.display = 'none'
    }, 3200)
  }

  window.__salemUpdateStatus = function (o) {
    if (!o) return
    if (o.kind === 'progress') toast(o.message || 'Descargando…')
    else if (o.kind === 'ok') toast(o.message || 'Listo')
    else if (o.kind === 'error') toast(o.message || 'Error al actualizar')
  }

  async function installed() {
    try {
      if (window.SalemAndroid?.getAppVersion) {
        return {
          version: String(window.SalemAndroid.getAppVersion()),
          build: Number(window.SalemAndroid.getAppBuild?.() || 0),
        }
      }
    } catch {}
    return { version: '0.0.0', build: 0 }
  }

  async function latestFromGithub() {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest?t=${Date.now()}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Salem-app' },
    })
    if (!r.ok) return null
    const j = await r.json()
    const version = String(j.tag_name || '').replace(/^v/i, '')
    const asset = (j.assets || []).find((a) => a.name === APK_NAME)
    return {
      version,
      url: asset?.browser_download_url || FALLBACK_URL,
    }
  }

  function showBanner(latest, url) {
    let el = document.getElementById('updateBanner')
    if (!el) {
      el = document.createElement('div')
      el.id = 'updateBanner'
      el.style.cssText =
        'position:fixed;left:12px;right:12px;bottom:90px;z-index:20;background:#3d2a24;border:1px solid #4a342c;border-radius:12px;padding:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap'
      document.body.appendChild(el)
    }
    el.innerHTML = ''
    const txt = document.createElement('div')
    txt.style.flex = '1'
    txt.textContent = `Hay versión nueva: ${latest}`
    const btn = document.createElement('button')
    btn.textContent = 'Actualizar'
    btn.onclick = () => {
      toast('Descargando actualización…')
      try {
        window.SalemAndroid.installApk(url)
      } catch (e) {
        toast('No pude iniciar la descarga')
      }
    }
    const later = document.createElement('button')
    later.textContent = 'Después'
    later.className = 'secondary'
    later.onclick = () => {
      el.style.display = 'none'
    }
    el.appendChild(txt)
    el.appendChild(btn)
    el.appendChild(later)
    el.style.display = 'flex'
  }

  async function check() {
    if (!window.SalemAndroid?.installApk) return
    try {
      const local = await installed()
      const remote = await latestFromGithub()
      if (!remote?.version) return
      if (isNewer(remote.version, local.version || '0.0.0')) {
        showBanner(remote.version, remote.url)
      }
    } catch (e) {
      /* silencioso */
    }
  }

  window.SalemCheckUpdate = check
  setTimeout(check, 1200)
})()
