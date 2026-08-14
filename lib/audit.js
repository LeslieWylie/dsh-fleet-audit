/**
 * dsh-fleet-audit 核心：只读审计。
 * 不写文件、不启进程、不访问网络；输出中所有疑似凭据均脱敏。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findSecretProviders, stripEmbeddedCredentials } from './secret.js';
const DEFAULT_FILES = ['~/.gitconfig', '~/.netrc', '~/.npmrc', '~/.env'];
const DEFAULT_DIRS = ['~/.ssh'];
const KNOWN_ARG_KEYS = new Set(['roots', 'files', 'scanSecrets', 'maxGitConfigs', 'maxDepth']);
function clampInt(v, fallback, lo, hi) {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
    return Math.min(hi, Math.max(lo, n));
}
function resolveHome(p) {
    return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}
async function checkFile(p) {
    let mode = null;
    try {
        const st = await fs.stat(p);
        mode = (st.mode & 0o777).toString(8).padStart(3, '0');
    }
    catch {
        /* 不存在或不可读 */
    }
    if (mode === null)
        return { path: p, exists: false, mode: '---', tooOpen: false };
    const n = parseInt(mode, 8);
    return { path: p, exists: true, mode, tooOpen: (n & 0o077) !== 0 };
}
async function collectGitConfigs(roots, max, maxDepth) {
    const found = new Set();
    if (max > 0)
        found.add(path.join(os.homedir(), '.gitconfig'));
    const stack = roots.map(r => ({ dir: r, depth: 0 }));
    while (stack.length > 0 && found.size < max) {
        const { dir, depth } = stack.pop();
        if (depth > maxDepth)
            continue;
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of entries) {
            if (found.size >= max)
                break;
            if (e.isDirectory()) {
                if (e.name === '.git') {
                    const cfg = path.join(dir, '.git', 'config');
                    try {
                        await fs.access(cfg);
                        found.add(cfg);
                    }
                    catch {
                        /* 无 config 的裸仓库等 */
                    }
                }
                else if (e.name !== 'node_modules' && e.name !== '.cache') {
                    stack.push({ dir: path.join(dir, e.name), depth: depth + 1 });
                }
            }
        }
    }
    return [...found].sort();
}
function extractGitLeaks(file, text) {
    const leaks = [];
    for (const line of text.split(/\r?\n/)) {
        // 赋值形式：url = ... / pushurl = ...（[remote "origin"] 下）
        const eq = line.match(/^\s*(?:url|pushurl)\s*=\s*(.+)$/);
        if (eq) {
            const hit = stripEmbeddedCredentials(eq[1]);
            if (hit)
                leaks.push({ file, ...hit });
            continue;
        }
        // 段头形式：[url "https://user:pass@host/..."]（insteadOf / pushInsteadOf 的常见写法）
        const sec = line.match(/^\[(?:url|remote)\s+"([^"]+)"\]$/);
        if (sec) {
            const hit = stripEmbeddedCredentials(sec[1]);
            if (hit)
                leaks.push({ file, ...hit });
        }
    }
    return leaks;
}
export async function runAudit(args) {
    if (typeof args !== 'object' || args === null)
        throw new Error('fleet_audit: args must be an object');
    const a = args;
    for (const k of Object.keys(a)) {
        if (!KNOWN_ARG_KEYS.has(k))
            throw new Error(`fleet_audit: unknown option "${k}"`);
    }
    const roots = Array.isArray(a.roots) ? a.roots : [];
    const extraFiles = Array.isArray(a.files) ? a.files : [];
    const scanSecrets = a.scanSecrets === undefined ? true : Boolean(a.scanSecrets);
    const maxGit = clampInt(a.maxGitConfigs, 200, 0, 2000);
    const maxDepth = clampInt(a.maxDepth, 5, 1, 20);
    const files = [...DEFAULT_FILES, ...extraFiles].map(resolveHome);
    const fileChecks = [];
    for (const f of files)
        fileChecks.push(await checkFile(f));
    for (const d of DEFAULT_DIRS)
        fileChecks.push(await checkFile(resolveHome(d)));
    const configs = await collectGitConfigs(roots, maxGit, maxDepth);
    const gitLeaks = [];
    const secretHits = [];
    for (const cfg of configs) {
        let text;
        try {
            text = await fs.readFile(cfg, 'utf8');
        }
        catch {
            continue;
        }
        gitLeaks.push(...extractGitLeaks(cfg, text));
        if (scanSecrets) {
            const provs = findSecretProviders(text);
            if (provs.length > 0)
                secretHits.push({ file: cfg, providers: provs });
        }
    }
    fileChecks.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
    gitLeaks.sort((x, y) => (x.file + x.maskedUrl < y.file + y.maskedUrl ? -1 : 1));
    secretHits.sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : 0));
    const tooOpen = fileChecks.filter(c => c.exists && c.tooOpen).length;
    const issues = tooOpen + gitLeaks.length + secretHits.length;
    return {
        ok: true,
        summary: {
            files: fileChecks.length,
            tooOpen,
            gitLeaks: gitLeaks.length,
            secretFiles: secretHits.length,
            issues,
            scannedGitConfigs: configs.length,
        },
        checks: { credentialFiles: fileChecks, gitRemoteLeaks: gitLeaks, secrets: secretHits },
        note: 'Read-only audit; secret-like values are masked in the output. Fix permissions with chmod 600 and rotate any exposed credentials.',
    };
}
