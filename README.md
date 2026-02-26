# cf-ai-proxy

部署在 Cloudflare Workers 上的轻量级 API 反向代理。通过单一域名转发请求到 21+ 个 AI 及消息类 API，支持区域放置以绕过地域限制。

## 特性

- **21+ API 端点** — OpenAI、Claude、Gemini、OpenRouter、Groq、xAI、Mistral、Perplexity 等
- **区域放置** — 通过 `[placement]` 配置将 Worker 调度到美国/欧洲等指定区域运行，绕过 API 地域封锁
- **全量请求头透传** — 黑名单机制，转发所有请求头（认证、beta 标志、版本号等），不会丢失特殊头
- **CORS 支持** — 完整的预检请求处理，浏览器端可直接调用
- **仪表盘首页** — 暗色主题状态面板，实时探测上游可达性、curl 示例、一键复制
- **系统端点** — `/health`、`/api/status`、`/debug` 用于监控和诊断

## 支持的 API

| 路由 | 上游地址 | 认证方式 |
|---|---|---|
| `/openai` | api.openai.com | Bearer token |
| `/claude` | api.anthropic.com | x-api-key + anthropic-version |
| `/gemini` | generativelanguage.googleapis.com | API key（query param） |
| `/openrouter` | openrouter.ai/api | Bearer token |
| `/groq` | api.groq.com/openai | Bearer token |
| `/xai` | api.x.ai | Bearer token |
| `/mistral` | api.mistral.ai | Bearer token |
| `/perplexity` | api.perplexity.ai | Bearer token |
| `/replicate` | api.replicate.com | Token |
| `/cohere` | api.cohere.com | Bearer token |
| `/together` | api.together.xyz | Bearer token |
| `/fireworks` | api.fireworks.ai | Bearer token |
| `/huggingface` | api-inference.huggingface.co | Bearer token |
| `/novita` | api.novita.ai | Bearer token |
| `/portkey` | api.portkey.ai | Bearer token |
| `/zenmux` | zenmux.ai/api | Bearer token |
| `/cerebras` | api.cerebras.ai | Bearer token |
| `/sambanova` | api.sambanova.ai | Bearer token |
| `/hyperbolic` | api.hyperbolic.xyz | Bearer token |
| `/discord` | discord.com/api | Bot token |
| `/telegram` | api.telegram.org | Token in URL |

## 部署

### 前置条件

- [Node.js](https://nodejs.org/) 18+
- 一个 [Cloudflare](https://cloudflare.com) 账户

### 步骤

```bash
# 1. 克隆仓库
git clone https://github.com/Haor/cf-ai-proxy.git
cd cf-ai-proxy

# 2. 安装依赖
npm install

# 3. 登录 Cloudflare（首次需要，会打开浏览器授权）
npx wrangler login

# 4. 本地开发测试
npm run dev

# 5. 部署到 Cloudflare
npm run deploy
```

部署成功后会输出一个 `*.workers.dev` 地址，即可使用。

### 绑定自定义域名

编辑 `wrangler.toml`，取消注释并替换为你的域名：

```toml
[[routes]]
pattern = "your-domain.com/*"
zone_name = "your-domain.com"
```

前提：域名的 DNS 必须托管在 Cloudflare 上。

### 区域放置（绕过地域限制）

默认情况下 Worker 在离用户最近的边缘节点运行。如果你所在地区被 AI API 封锁（如亚洲地区调用 OpenRouter 返回 403），可以通过区域放置将 Worker 调度到美国运行。

编辑 `wrangler.toml`，取消注释 `[placement]` 部分：

```toml
[placement]
region = "aws:us-east-1"
```

**支持的格式：**

| 方式 | 示例 | 说明 |
|---|---|---|
| 云区域 | `region = "aws:us-east-1"` | 指定 AWS/GCP/Azure 区域 |
| 主机名探测 | `hostname = "api.openai.com"` | 自动调度到离目标最近的节点 |
| 智能放置 | `mode = "smart"` | Cloudflare 自动优化（需积累流量数据） |

常用区域：
- `aws:us-east-1` — 美国东部（弗吉尼亚），推荐，大部分 AI API 服务器所在区域
- `aws:us-west-2` — 美国西部（俄勒冈）
- `gcp:europe-west1` — 欧洲西部（比利时）
- `aws:ap-northeast-1` — 日本东京

**验证放置是否生效：**

```bash
curl https://your-domain.com/debug
```

查看 `outbound_country` 字段确认出站 IP 所在地区。

## 使用方法

将原始 API 的 base URL 替换为代理地址即可，所有请求头原样透传：

### curl 示例

```bash
# OpenAI
curl https://your-domain.com/openai/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}'

# Claude
curl https://your-domain.com/claude/v1/messages \
  -H "x-api-key: sk-ant-..." \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'

# Gemini
curl "https://your-domain.com/gemini/v1beta/models/gemini-2.5-flash:generateContent?key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"hello"}]}]}'

# OpenRouter
curl https://your-domain.com/openrouter/v1/chat/completions \
  -H "Authorization: Bearer sk-or-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"google/gemini-3-flash-preview","messages":[{"role":"user","content":"hello"}]}'
```

### SDK 配置

```python
# Python — OpenAI SDK
from openai import OpenAI
client = OpenAI(base_url="https://your-domain.com/openai/v1")

# Python — Anthropic SDK
from anthropic import Anthropic
client = Anthropic(base_url="https://your-domain.com/claude")
```

```typescript
// Node.js — OpenAI SDK
const client = new OpenAI({ baseURL: "https://your-domain.com/openai/v1" });
```

```python
# Python — Groq（使用 OpenAI SDK）
from openai import OpenAI
client = OpenAI(
    base_url="https://your-domain.com/groq/v1",
    api_key="gsk_..."
)
```

## 系统端点

| 端点 | 说明 |
|---|---|
| `GET /` | 仪表盘首页，显示所有端点状态和使用指引 |
| `GET /health` | 返回 `{"status":"ok"}`，用于 UptimeRobot 等外部监控 |
| `GET /api/status` | 并行探测所有上游 API，返回 JSON（名称、可达性、延迟毫秒数） |
| `GET /debug` | 显示 Worker 放置信息：入口节点、出站 IP、地区 |

## 工作原理

```
用户请求 → Cloudflare 边缘 → [区域放置转发] → Worker 执行 → 上游 API
                                                    ↓
                                          剥离 CF 内部头
                                          透传所有业务头
                                          转发请求体（支持流式）
                                          附加安全响应头 + CORS
```

- 请求头采用**黑名单机制**：只剥离 `host`、`cf-*`、`x-forwarded-*` 等代理/内部头，其余全部透传
- 无人为超时限制，依赖 Cloudflare Workers 运行时的原生行为（wall-clock 无上限，只要客户端保持连接）
- `/api/status` 响应带 10 秒缓存，避免短时间内重复触发大量探测请求
- 响应附加 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 安全头

## License

MIT
