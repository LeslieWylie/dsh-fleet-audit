/**
 * dsh-fleet-audit 类型契约（冻结）。
 */
export interface AuditArgs {
    /** 递归扫描这些目录下的 .git/config（可选）；不传则只查 ~/.gitconfig */
    roots?: string[];
    /** 额外需要检查权限的凭据文件绝对路径（可选） */
    files?: string[];
    /** 是否同时扫描凭证前缀字面量（默认 true） */
    scanSecrets?: boolean;
    /** git config 扫描上限（默认 200，上限 2000） */
    maxGitConfigs?: number;
    /** 目录递归深度上限（默认 5，上限 20） */
    maxDepth?: number;
}
export interface FileCheck {
    path: string;
    exists: boolean;
    /** 八进制权限串，如 '600' */
    mode: string;
    /** 组/其他位可读（权限过宽，应收紧到 600/700） */
    tooOpen: boolean;
}
export interface GitLeak {
    file: string;
    host: string;
    /** 凭据已用 *** 掩码 */
    maskedUrl: string;
}
export interface SecretHit {
    file: string;
    providers: {
        provider: string;
        count: number;
    }[];
}
export interface AuditResult {
    ok: true;
    summary: {
        files: number;
        tooOpen: number;
        gitLeaks: number;
        secretFiles: number;
        issues: number;
        scannedGitConfigs: number;
    };
    checks: {
        credentialFiles: FileCheck[];
        gitRemoteLeaks: GitLeak[];
        secrets: SecretHit[];
    };
    note: string;
}
