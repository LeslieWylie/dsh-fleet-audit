/**
 * dsh-fleet-audit 插件入口。
 *
 * 注册 `fleet_audit` 工具：只读的 agent 舰队卫生审计——
 * 凭据文件权限（应 600）、git remote 内嵌凭据（脱敏）、配置文件中 provider token 前缀字面量（仅计数）。
 * 接入方式：在 profile 的 cordis.yml 追加：
 *   - id: fleet-audit
 *     name: 'dsh-fleet-audit'
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { runAudit } from './audit.ts'

export const name = 'dsh-fleet-audit'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'fleet_audit',
    description:
      'Read-only agent-fleet hygiene audit: (1) permission check on well-known credential files ' +
      '(expected 0600; reports group/other-readable), (2) scan git remotes for embedded credentials ' +
      '(https://user:pass@host or oauth2:TOKEN@host style) with secret values masked as ***, ' +
      '(3) optional scan of scanned config files for provider token prefixes (github/gitlab/slack/aws/openai/...) ' +
      '— counts only, never echoes the secret. Deterministic, zero writes, zero network, no process spawn.',
    parameters: {
      roots: {
        type: 'array',
        items: { type: 'string' },
        description: 'Directories to recursively scan for .git/config remotes (optional; default: only ~/.gitconfig).',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Extra absolute paths of credential files to permission-check.',
      },
      scanSecrets: {
        type: 'boolean',
        description: 'Scan scanned configs for provider token literals (default true).',
      },
      maxGitConfigs: {
        type: 'number',
        description: 'Cap on scanned .git/config files (default 200, max 2000).',
      },
      maxDepth: {
        type: 'number',
        description: 'Recursion depth when discovering .git dirs (default 5, max 20).',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async args => (await runAudit(args)) as unknown as JsonValue,
    timeoutMs: 10000,
  }))
}
