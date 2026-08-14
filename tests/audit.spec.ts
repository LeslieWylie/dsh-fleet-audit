import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runAudit } from '../src/audit.ts'
import { findSecretProviders, stripEmbeddedCredentials } from '../src/secret.ts'

function fixture(): string {
  return mkdtempSync(path.join(tmpdir(), 'fleet-audit-'))
}

describe('stripEmbeddedCredentials', () => {
  it('masks user:pass URLs without leaking the password', () => {
    const r = stripEmbeddedCredentials('https://octocat:supersecret@github.com/org/repo.git')
    expect(r).not.toBeNull()
    expect(r!.host).toBe('github.com')
    expect(r!.maskedUrl).toContain('***')
    expect(r!.maskedUrl).not.toContain('supersecret')
  })

  it('masks oauth2:token style users', () => {
    const r = stripEmbeddedCredentials('https://oauth2:glpat-abcdefghijklmnop@gitlab.example.com/group/repo.git')
    expect(r!.maskedUrl).not.toContain('glpat-')
    expect(r!.maskedUrl).toContain('***')
  })

  it('ignores plain public URLs without credentials', () => {
    expect(stripEmbeddedCredentials('https://github.com/org/clean.git')).toBeNull()
  })
})

describe('findSecretProviders', () => {
  it('counts provider token prefixes, never echoes them', () => {
    const text = 'a = ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA, b = glpat-BBBBBBBBBBBBBBBBBBBB'
    const provs = findSecretProviders(text)
    const names = provs.map(p => p.provider)
    expect(names).toContain('github')
    expect(names).toContain('gitlab')
    expect(provs.reduce((s, p) => s + p.count, 0)).toBe(2)
  })
})

describe('runAudit', () => {
  it('flags 644 credential files as tooOpen and accepts 600', async () => {
    const dir = fixture()
    const open = path.join(dir, 'open.env')
    const fine = path.join(dir, 'fine.env')
    writeFileSync(open, 'TOKEN=abc')
    writeFileSync(fine, 'TOKEN=abc')
    chmodSync(open, 0o644)
    chmodSync(fine, 0o600)
    const res = await runAudit({ files: [open, fine], roots: [] })
    const byPath = new Map(res.checks.credentialFiles.map(c => [c.path, c]))
    expect(byPath.get(open)!.tooOpen).toBe(true)
    expect(byPath.get(fine)!.tooOpen).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('detects embedded-credential git remotes and masks them in output', async () => {
    const dir = fixture()
    const repodir = path.join(dir, 'repo')
    mkdirSync(path.join(repodir, '.git'), { recursive: true })
    writeFileSync(
      path.join(repodir, '.git', 'config'),
      '[remote "origin"]\n  url = https://oauth2:supersecret-token12345@code.internal.example/group/proj.git\n  url = https://github.com/org/clean.git\n',
    )
    const res = await runAudit({ roots: [dir] })
    expect(res.summary.gitLeaks).toBeGreaterThanOrEqual(1)
    const leak = res.checks.gitRemoteLeaks.find(l => l.host === 'code.internal.example')
    expect(leak).toBeDefined()
    expect(leak!.maskedUrl).not.toContain('supersecret-token12345')
    expect(JSON.stringify(res)).not.toContain('supersecret-token12345')
    rmSync(dir, { recursive: true, force: true })
  })

  it('scans provider secrets in git config when enabled', async () => {
    const dir = fixture()
    const repodir = path.join(dir, 'repo2')
    mkdirSync(path.join(repodir, '.git'), { recursive: true })
    writeFileSync(path.join(repodir, '.git', 'config'), 'token = ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n')
    const res = await runAudit({ roots: [dir] })
    expect(res.summary.secretFiles).toBeGreaterThanOrEqual(1)
    const hit = res.checks.secrets[0]!
    expect(hit.providers.some(p => p.provider === 'github')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('detects credentials in [url "..."] section headers (insteadOf style)', async () => {
    const dir = fixture()
    const repodir = path.join(dir, 'repo4')
    mkdirSync(path.join(repodir, '.git'), { recursive: true })
    writeFileSync(
      path.join(repodir, '.git', 'config'),
      '[url "https://oauth2:realtokenvalue12345@internal.example/repo/"]\n\tinsteadOf = git@internal.example:\n',
    )
    const res = await runAudit({ roots: [dir] })
    expect(res.summary.gitLeaks).toBeGreaterThanOrEqual(1)
    const leak = res.checks.gitRemoteLeaks.find(l => l.host === 'internal.example')
    expect(leak).toBeDefined()
    expect(JSON.stringify(res)).not.toContain('realtokenvalue12345')
    rmSync(dir, { recursive: true, force: true })
  })

  it('skips secret scan when scanSecrets=false', async () => {
    const dir = fixture()
    const repodir = path.join(dir, 'repo3')
    mkdirSync(path.join(repodir, '.git'), { recursive: true })
    writeFileSync(path.join(repodir, '.git', 'config'), 'token = ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n')
    const res = await runAudit({ roots: [dir], scanSecrets: false })
    expect(res.summary.secretFiles).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects unknown options', async () => {
    await expect(runAudit({ roots: [], bogus: 1 })).rejects.toThrow(/unknown option/)
  })

  it('is bounded by maxGitConfigs=0', async () => {
    const res = await runAudit({ roots: [], maxGitConfigs: 0 })
    expect(res.summary.scannedGitConfigs).toBe(0)
  })
})
