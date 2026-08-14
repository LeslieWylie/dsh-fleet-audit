// Integration test: does this package actually load in a real harness, and
// does its one tool do real, correctly-masked work against real files?
//
// tests/audit.spec.ts drives runAudit() directly and proves the audit logic
// is correct. It cannot catch a package that imports cleanly, passes every
// unit test, and then registers nothing at all once a real cordis Context
// boots it — because `export const inject` never got satisfied. That is the
// exact failure mode that shipped three other plugins in this account before
// anyone ran them for real.
//
// This plugin injects only ['tools'] (no 'skills', no 'fs' — it reads files
// directly via node:fs). So this suite boots dsh-tools (provides `tools`),
// then loads an independent first-party control plugin that injects the same
// service, so a registration failure on the control proves the *harness
// setup* is wrong, not this plugin.
//
// Deliberately NOT named tests/boot.test.mjs or *.spec.mjs: vitest's default
// `include` picks up any *.test.* or *.spec.* file under tests/, and this is
// a standalone script (top-level process.exit, no describe/it), not a vitest
// test module — a matching name would make `vitest run tests` try to execute
// it as one and crash the worker.
//
// It needs the harness packages present, which they are inside a profile's
// node_modules but are not in a bare checkout of this repo. When they cannot
// be resolved the suite SKIPS rather than fails, so `npm test` still works
// from a clone. To run it for real:
//
//   cd ~/.dsh/profiles/<profile>/node_modules/dsh-fleet-audit && node tests/boot-check.mjs
//
// Run: node tests/boot-check.mjs

import { mkdtemp, writeFile, mkdir, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
const check = (label, ok, detail) => {
  if (ok) { console.log(`  ok    ${label}`); return }
  failures++
  console.log(`  FAIL  ${label}`)
  if (detail !== undefined) console.log(`        ${detail}`)
}

const REQUIRED = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-fs-local',
  '@deepseek-ai/dsh-tool-str-replace-editor',
]

const harness = {}
for (const specifier of REQUIRED) {
  try {
    harness[specifier] = await import(specifier)
  } catch (error) {
    console.log(`\n--- harness boot: SKIPPED ---`)
    console.log(`  ${specifier} is not resolvable from here (${error.code ?? 'error'}).`)
    console.log(`  Run this suite from inside an installed profile to exercise it.`)
    process.exit(0)
  }
}

console.log('\n--- harness boot ---')

const { Context } = harness['@deepseek-ai/cordis']
const asPlugin = (mod) => mod.default ?? mod

const ctx = new Context()
const warnings = []
ctx.on('internal/warning', (...args) => warnings.push(args.map(String).join(' ')))
const warnedAbout = (needle) => warnings.some(w => w.includes(needle))

await ctx.plugin(asPlugin(harness['@deepseek-ai/dsh-system-prompt']), {})
await ctx.plugin(asPlugin(harness['@deepseek-ai/dsh-tools']))
await ctx.plugin(asPlugin(harness['@deepseek-ai/dsh-fs-local']), {})
await new Promise((resolve) => setTimeout(resolve, 200))

check('the harness provides a real tools registry', ctx.tools !== undefined,
  'without it this plugin is designed to stay unregistered, so the rest would prove nothing')

// ── control: an independent first-party plugin injecting the same service ──
// If it fails to register, the harness setup is wrong, not dsh-fleet-audit.
await ctx.plugin(asPlugin(harness['@deepseek-ai/dsh-tool-str-replace-editor']), {})
await new Promise((resolve) => setTimeout(resolve, 100))
check('control (tools gate): str_replace_editor registers',
  ctx.tools?.get?.('str_replace_editor') !== undefined,
  warnedAbout('str_replace_editor') ? `warned: ${warnings.join(' | ')}` : 'not registered and nothing warned')

// ── load this package by its real installed name, as a profile would ──
const self = await import('dsh-fleet-audit')
await ctx.plugin(self, {})
await new Promise((resolve) => setTimeout(resolve, 1000))

console.log('\n--- tool registration ---')

const fleetAudit = ctx.tools?.get?.('fleet_audit')
check('fleet_audit reaches the real tool registry', fleetAudit !== undefined,
  warnedAbout('dsh-fleet-audit') ? `warnings: ${warnings.join(' | ')}` : 'registry returned nothing and nothing warned')

if (fleetAudit === undefined) {
  console.log(`\nFAIL — ${failures} failing check(s)\n`)
  process.exit(1)
}

console.log('\n--- execute against real state (not a stub) ---')

const scratch = await mkdtemp(join(tmpdir(), 'dsh-fleet-audit-boot-'))
try {
  // Real, unrecognized argument key — proves runAudit's own KNOWN_ARG_KEYS
  // validation actually runs, rather than a stub that accepts anything.
  let rejectedUnknownArg = false
  try {
    await fleetAudit.execute({ bogus: true }, {})
  } catch {
    rejectedUnknownArg = true
  }
  check('an unrecognized argument key is rejected, not silently accepted', rejectedUnknownArg)

  // A real git repo with a real embedded-credential remote URL, planted so
  // extractGitLeaks/stripEmbeddedCredentials must find it via a genuine
  // directory walk + regex match — not a stub returning canned findings.
  // "x-access-token" is on the tokenish-username list AND a password is
  // present, so this is guaranteed to trigger per src/secret.ts.
  const PLANTED_TOKEN = 'faketoken1234567890abcdef'
  const PLANTED_GHP = 'ghp_ABCDEFGHIJ0123456789abcdefghijklmnop' // matches SECRET_PATTERNS[github]
  await mkdir(join(scratch, '.git'), { recursive: true })
  await writeFile(join(scratch, '.git', 'config'), [
    '[remote "origin"]',
    `\turl = https://x-access-token:${PLANTED_TOKEN}@github.com/example/private-repo.git`,
    '\tfetch = +refs/heads/*:refs/remotes/origin/*',
    `# unrelated comment that happens to contain a token-shaped string: ${PLANTED_GHP}`,
    '',
  ].join('\n'))

  // A loose-permission file, passed via `files`, to prove the real fs.stat
  // mode check — not a stub returning a canned tooOpen flag.
  const loosePath = join(scratch, 'loose-secrets.env')
  await writeFile(loosePath, 'PLACEHOLDER=not-a-real-secret\n')
  await chmod(loosePath, 0o644) // group/other readable -> tooOpen per (mode & 0o077) !== 0

  const result = await fleetAudit.execute({
    roots: [scratch],
    files: [loosePath],
    scanSecrets: true,
    maxGitConfigs: 10,
  }, {})
  const raw = JSON.stringify(result)

  check('runAudit reports ok:true', result.ok === true, raw.slice(0, 200))
  check('the planted git config was actually walked and scanned', result.summary?.scannedGitConfigs >= 1)

  const plantedLeak = result.checks?.gitRemoteLeaks?.find(l => l.file?.includes(scratch))
  check('the embedded credential in the planted remote URL was detected', plantedLeak !== undefined, raw.slice(0, 400))
  check('the leak is masked to the expected form (tokenish user -> ***, password -> ***)',
    plantedLeak?.maskedUrl === 'https://***:***@github.com/example/private-repo.git', plantedLeak?.maskedUrl)

  const plantedSecret = result.checks?.secrets?.find(s => s.file?.includes(scratch))
  check('the planted GitHub-token-shaped string was detected as a secret provider hit',
    plantedSecret?.providers?.some(p => p.provider === 'github' && p.count >= 1), JSON.stringify(plantedSecret))

  check('the raw embedded credential never appears anywhere in the output', !raw.includes(PLANTED_TOKEN))
  check('the raw token-shaped secret never appears anywhere in the output', !raw.includes(PLANTED_GHP))

  const looseCheck = result.checks?.credentialFiles?.find(c => c.path === loosePath)
  check('the loose-permission extra file is flagged tooOpen via a real fs.stat', looseCheck?.tooOpen === true, JSON.stringify(looseCheck))
  check('tooOpen count in the summary reflects the real stat, not a stub', result.summary?.tooOpen >= 1)
} finally {
  await rm(scratch, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing check(s)\n`)
process.exit(failures === 0 ? 0 : 1)
