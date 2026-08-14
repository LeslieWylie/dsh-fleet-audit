# 🔎 dsh-fleet-audit

[中文](README.md)

**Read-only agent-fleet hygiene audit plugin for DSH.** Zero-dependency, deterministic, fully masked output. Checks three things:

1. **Credential-file permissions** — well-known credential files (`~/.gitconfig`, `~/.netrc`, `~/.npmrc`, `~/.env`, `~/.ssh/`) should be `600`/`700`; group/other-readable entries are flagged `tooOpen`
2. **Embedded credentials in git remotes** — scans `~/.gitconfig` and `.git/config` under the given roots for `https://user:pass@host`, `https://oauth2:TOKEN@host`, or token-like usernames; values are masked as `***` in the output — **byte-for-byte guarantee that the raw secret never appears**
3. **Provider token-prefix literals** (optional) — github / github-fine-grained / gitlab / gitlab-ci / slack / aws / openai / multica / jwt prefixes, reported as provider × count only

## Why

On a multi-agent machine, credentials scatter across `~/.gitconfig`, agent configs, `.git/config` files and various `.env`. A git `url.*.insteadof` or `pushurl` with an embedded token (e.g. `https://oauth2:<token>@gitlab.example.com/...`) means `git remote -v` prints the secret into every log, chat, and CI build. A one-shot read-only audit with masked output is the first line of a security baseline.

## Install

```sh
# local validation
dsh plugin --profile web add /path/to/dsh-fleet-audit

# after publishing
dsh plugin --profile web add dsh-fleet-audit
# or
dsh plugin --profile web add github:omdsh-dev/dsh-fleet-audit
```

Restart `dsh web` after installing, then just ask: "audit credential hygiene on this machine" → the agent calls `fleet_audit`.

## Tool parameters

| Param | Type | Description |
|---|---|---|
| `roots` | string[] | directories to recursively scan for `.git/config` (optional; default: only `~/.gitconfig`) |
| `files` | string[] | extra absolute credential-file paths for permission checks |
| `scanSecrets` | boolean | scan configs for token-prefix literals (default `true`) |
| `maxGitConfigs` | number | cap on scanned git configs (default 200, max 2000) |
| `maxDepth` | number | recursion depth for `.git` discovery (default 5, max 20) |

## Sample output (masked)

```jsonc
{
  "ok": true,
  "summary": { "files": 5, "tooOpen": 1, "gitLeaks": 2, "secretFiles": 1, "issues": 4, "scannedGitConfigs": 12 },
  "checks": {
    "credentialFiles": [
      { "path": "/Users/alice/.gitconfig", "exists": true, "mode": "644", "tooOpen": true }
    ],
    "gitRemoteLeaks": [
      { "file": "/Users/alice/code/proj/.git/config", "host": "gitlab.example.com", "maskedUrl": "https://***:***@gitlab.example.com/group/proj.git" }
    ],
    "secrets": [
      { "file": "/Users/alice/.gitconfig", "providers": [ { "provider": "github", "count": 1 } ] }
    ]
  }
}
```

## Safety boundary

- Read-only: no writes, no process spawn, no network, no state
- Masked: every secret-like value is masked; tests assert the raw secret never appears in the output JSON
- Bounded: git-config count and recursion depth are capped

## Dev

```sh
npm install
npm run check   # typecheck + vitest + build
```

## License

MIT © omdsh-dev
