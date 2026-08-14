/**
 * dsh-fleet-audit 插件入口。
 *
 * 注册 `fleet_audit` 工具：只读的 agent 舰队卫生审计——
 * 凭据文件权限（应 600）、git remote 内嵌凭据（脱敏）、配置文件中 provider token 前缀字面量（仅计数）。
 * 接入方式：在 profile 的 cordis.yml 追加：
 *   - id: fleet-audit
 *     name: 'dsh-fleet-audit'
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-fleet-audit";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
