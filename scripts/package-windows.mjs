import { spawnSync } from 'node:child_process'
import { rmdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(fileURLToPath(new URL('..', import.meta.url)))
const seedDirectory = join(projectRoot, 'build-seed')
const seedPath = join(seedDirectory, 'ppms.sqlite')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`)
}

let succeeded = false
try {
  run(process.execPath, [join(projectRoot, 'scripts', 'create-desktop-seed.mjs')])
  run(process.execPath, [join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc')])
  run(process.execPath, [join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'])
  run(process.execPath, [join(projectRoot, 'node_modules', 'electron-builder', 'cli.js'), '--win'])
  succeeded = true
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
}

if (!succeeded) process.exitCode = 1