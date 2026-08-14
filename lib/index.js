import { defineTool } from '@deepseek-ai/dsh-tools';
import { runAudit } from './audit.js';
export const name = 'dsh-fleet-audit';
export const inject = ['tools'];
export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'fleet_audit',
        description: 'Read-only agent-fleet hygiene audit: (1) permission check on well-known credential files ' +
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
        execute: async (args) => (await runAudit(args)),
        timeoutMs: 10000,
    }));
}
