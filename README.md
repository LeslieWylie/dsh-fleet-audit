# 🔎 dsh-fleet-audit

[English](README.en.md)

**DSH agent 舰队卫生审计插件**：只读、零依赖、确定性。检查三件事，输出全程脱敏：

1. **凭据文件权限** —— 常用凭据文件（`~/.gitconfig`、`~/.netrc`、`~/.npmrc`、`~/.env`、`~/.ssh/`）应收紧为 `600`/《700`，组/其他可读一律标记为 `tooOpen`
2. **git remote 内嵌凭据** —— 扫描 `~/.gitconfig` 与给定目录下的 `.git/config`，识别 `https://user:pass@host`、`https://oauth2:TOKEN@host`、token 型用户名等；输出 URL 中凭据以 `***` 掩码，**逐字节保证不泄露原文**
3. **provider token 前缀字面量**（可关）—— github / github-fine-grained / gitlab / gitlab-ci / slack / aws / openai / multica / jwt 常见前缀，只报「类型 × 出现次数」

## 为什么

多 agent 时代的机器上，凭据散落在 `~/.gitconfig`、agent 配置、`.git/config` 与各种 `.env` 里。git 的 `url.*.insteadof` 或 `pushurl` 一旦嵌了 token（例如 `https://oauth2:<token>@gitlab.example.com/...`），任何 `git remote -v` 都会把密钥打印进日志/对话/CI。一键只读审计 + 脱敏输出，是安全基线体检的第一道。

## 安装

```sh
# 本地验证
dsh plugin --profile web add /path/to/dsh-fleet-audit

# 发布后（npm / GitHub）
dsh plugin --profile web add dsh-fleet-audit
# 或
dsh plugin --profile web add github:omdsh-dev/dsh-fleet-audit
```

安装后重启 `dsh web`，直接说「审计一下本机凭据卫生 / run fleet_audit」。

## 用法（工具参数）

| 参数 | 类型 | 说明 |
|---|---|---|
| `roots` | string[] | 递归扫描 `.git/config` 的目录（可选；默认只查 `~/.gitconfig`） |
| `files` | string[] | 额外要查权限的凭据文件绝对路径 |
| `scanSecrets` | boolean | 是否扫描 token 前缀字面量（默认 `true`） |
| `maxGitConfigs` | number | git config 扫描上限（默认 200，上限 2000） |
| `maxDepth` | number | 目录递归深度（默认 5，上限 20） |

## 输出示例（脱敏）

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
  },
  "note": "Read-only audit; secret-like values are masked in the output. Fix permissions with chmod 600 and rotate any exposed credentials."
}
```

## 安全边界

- 只读：不写文件、不启进程、不访问网络、不保存状态
- 脱敏：所有疑似凭据一律掩码；测试同时断言「输出 JSON 不含原始密钥」
- 有界：git config 数量与递归深度均设上限，可防扫描失控

## 开发

```sh
npm install
npm run check   # typecheck + vitest + build
```

## 许可

MIT © omdsh-dev
