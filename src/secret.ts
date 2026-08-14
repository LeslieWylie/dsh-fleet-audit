/**
 * 凭据识别与脱敏。
 * 只用于“检测与计数”，所有疑似凭据一律掩码，绝不回显原文。
 */

export interface SecretPattern {
  provider: string
  re: RegExp
}

/** 常见 provider token 前缀（小集合、可扩展；仅匹配计数） */
export const SECRET_PATTERNS: SecretPattern[] = [
  { provider: 'github', re: /\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{30,}\b/g },
  { provider: 'github-fine-grained', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { provider: 'gitlab', re: /\bglpat-[A-Za-z0-9_-]{18,}\b/g },
  { provider: 'gitlab-ci', re: /\bglcbt-[A-Za-z0-9_-]{18,}\b/g },
  { provider: 'slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { provider: 'aws', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { provider: 'openai', re: /\bsk-[A-Za-z0-9]{16,}\b/g },
  { provider: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
]

export interface ProviderCount {
  provider: string
  count: number
}

export function findSecretProviders(text: string): ProviderCount[] {
  const hits = new Map<string, number>()
  for (const p of SECRET_PATTERNS) {
    const found = text.match(p.re)
    if (found && found.length > 0) hits.set(p.provider, found.length)
  }
  return [...hits.entries()]
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0))
}

const EMBEDDED_CRED_RE = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/@\s:]+)(?::([^@\s]*))?@([^/\s]+)(\/.*)?$/
const TOKENISH_USERS = ['oauth2', 'token', 'x-access-token', 'gitlab-ci-token', 'oauth2token']

export interface GitLeakMatch {
  host: string
  maskedUrl: string
}

/**
 * 识别 git remote URL 中内嵌的凭据，返回脱敏 URL。
 * 触发条件：显式带密码；或用户名为 oauth2/token/x-access-token 等；或用户名长度 >= 24（疑似 token 用户名）。
 * 返回结果保证不包含任何原始凭据片段。
 */
export function stripEmbeddedCredentials(raw: string): GitLeakMatch | null {
  const line = raw.trim()
  const m = line.match(EMBEDDED_CRED_RE)
  if (!m) return null
  const scheme = m[1]!
  const user = m[2]!
  const pass = m[3]
  const host = m[4]!
  const rest = m[5] ?? ''
  const tokenishUser = TOKENISH_USERS.includes(user.toLowerCase()) || user.length >= 24
  if (!pass && !tokenishUser) return null
  const shownUser = tokenishUser ? '***' : maskUser(user)
  return { host, maskedUrl: `${scheme}${shownUser}:***@${host}${rest}` }
}

function maskUser(user: string): string {
  if (user.length <= 3) return user[0] + '***'
  return user.slice(0, 3) + '***'
}
