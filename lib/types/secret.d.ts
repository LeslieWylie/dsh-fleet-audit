/**
 * 凭据识别与脱敏。
 * 只用于“检测与计数”，所有疑似凭据一律掩码，绝不回显原文。
 */
export interface SecretPattern {
    provider: string;
    re: RegExp;
}
/** 常见 provider token 前缀（小集合、可扩展；仅匹配计数） */
export declare const SECRET_PATTERNS: SecretPattern[];
export interface ProviderCount {
    provider: string;
    count: number;
}
export declare function findSecretProviders(text: string): ProviderCount[];
export interface GitLeakMatch {
    host: string;
    maskedUrl: string;
}
/**
 * 识别 git remote URL 中内嵌的凭据，返回脱敏 URL。
 * 触发条件：显式带密码；或用户名为 oauth2/token/x-access-token 等；或用户名长度 >= 24（疑似 token 用户名）。
 * 返回结果保证不包含任何原始凭据片段。
 */
export declare function stripEmbeddedCredentials(raw: string): GitLeakMatch | null;
