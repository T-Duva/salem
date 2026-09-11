/**
 * Copia www → assets y arma APK release (firmada debug para instalar).
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const www = path.join(root, 'www')
const assets = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'www')
const outApk = path.join(root, 'salem.apk')

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    if (fs.statSync(from).isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

fs.rmSync(assets, { recursive: true, force: true })
copyDir(www, assets)
console.log('assets www ok')

execSync('gradlew.bat assembleRelease', { cwd: path.join(root, 'android'), stdio: 'inherit', shell: true })

const built = path.join(
  root,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk',
)
if (!fs.existsSync(built)) {
  console.error('No APK')
  process.exit(1)
}
fs.copyFileSync(built, outApk)
console.log('APK:', outApk)
