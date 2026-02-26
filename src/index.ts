const API_MAPPING: Record<string, string> = {
  '/openai': 'https://api.openai.com',
  '/claude': 'https://api.anthropic.com',
  '/gemini': 'https://generativelanguage.googleapis.com',
  '/openrouter': 'https://openrouter.ai/api',
  '/groq': 'https://api.groq.com/openai',
  '/xai': 'https://api.x.ai',
  '/mistral': 'https://api.mistral.ai',
  '/perplexity': 'https://api.perplexity.ai',
  '/replicate': 'https://api.replicate.com',
  '/cohere': 'https://api.cohere.com',
  '/together': 'https://api.together.xyz',
  '/fireworks': 'https://api.fireworks.ai',
  '/huggingface': 'https://api-inference.huggingface.co',
  '/novita': 'https://api.novita.ai',
  '/portkey': 'https://api.portkey.ai',
  '/zenmux': 'https://zenmux.ai/api',
  '/cerebras': 'https://api.cerebras.ai',
  '/sambanova': 'https://api.sambanova.ai',
  '/hyperbolic': 'https://api.hyperbolic.xyz',
  '/discord': 'https://discord.com/api',
  '/telegram': 'https://api.telegram.org',
};

const API_DOCS: Record<string, { auth: string; example_endpoint: string; note?: string }> = {
  '/openai':      { auth: 'Authorization: Bearer sk-...', example_endpoint: '/v1/chat/completions' },
  '/claude':      { auth: 'x-api-key: sk-ant-... + anthropic-version: 2023-06-01', example_endpoint: '/v1/messages', note: 'Beta features via anthropic-beta header' },
  '/gemini':      { auth: '?key=YOUR_KEY (query param)', example_endpoint: '/v1beta/models/gemini-2.5-flash:generateContent' },
  '/openrouter':  { auth: 'Authorization: Bearer sk-or-...', example_endpoint: '/v1/chat/completions', note: 'Optional: HTTP-Referer, X-Title headers' },
  '/groq':        { auth: 'Authorization: Bearer gsk_...', example_endpoint: '/v1/chat/completions' },
  '/xai':         { auth: 'Authorization: Bearer xai-...', example_endpoint: '/v1/chat/completions' },
  '/mistral':     { auth: 'Authorization: Bearer ...', example_endpoint: '/v1/chat/completions' },
  '/perplexity':  { auth: 'Authorization: Bearer pplx-...', example_endpoint: '/chat/completions' },
  '/replicate':   { auth: 'Authorization: Token r8_...', example_endpoint: '/v1/predictions' },
  '/cohere':      { auth: 'Authorization: Bearer ...', example_endpoint: '/v2/chat' },
  '/together':    { auth: 'Authorization: Bearer ...', example_endpoint: '/v1/chat/completions' },
  '/fireworks':   { auth: 'Authorization: Bearer ...', example_endpoint: '/inference/v1/chat/completions' },
  '/huggingface': { auth: 'Authorization: Bearer hf_...', example_endpoint: '/models/{model_id}' },
  '/novita':      { auth: 'Authorization: Bearer ...', example_endpoint: '/v3/openai/chat/completions' },
  '/portkey':     { auth: 'Authorization: Bearer ... + x-portkey-api-key', example_endpoint: '/v1/chat/completions' },
  '/zenmux':      { auth: 'Authorization: Bearer ...', example_endpoint: '/v1/chat/completions', note: 'Model format: provider/model-name' },
  '/cerebras':    { auth: 'Authorization: Bearer ...', example_endpoint: '/v1/chat/completions', note: 'Ultra-fast inference, free 1M tokens/day' },
  '/sambanova':   { auth: 'Authorization: Bearer ...', example_endpoint: '/v1/chat/completions', note: 'High-speed inference, free tier available' },
  '/hyperbolic':  { auth: 'Authorization: Bearer ...', example_endpoint: '/v1/chat/completions', note: 'Open-source models (Llama, Qwen, etc.)' },
  '/discord':     { auth: 'Authorization: Bot ...', example_endpoint: '/v10/channels/{id}/messages' },
  '/telegram':    { auth: 'Token in URL path', example_endpoint: '/bot{token}/sendMessage' },
};

const UPSTREAM_TIMEOUT_MS = 30_000;

const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cf-worker',
  'cf-ew-via',
  'cf-placement',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
  'connection',
  'upgrade',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
]);

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const PREFIXES = Object.keys(API_MAPPING);

function extractPrefixAndRest(pathname: string): [string, string] | null {
  for (const prefix of PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return [prefix, pathname.slice(prefix.length)];
    }
  }
  return null;
}

function buildForwardHeaders(requestHeaders: Headers): Headers {
  const headers = new Headers();
  for (const [key, value] of requestHeaders.entries()) {
    if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  return headers;
}

function buildResponseHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers();
  for (const [key, value] of upstreamHeaders.entries()) {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return headers;
}

async function probeUpstream(name: string, target: string): Promise<{ name: string; target: string; ok: boolean; latency_ms: number | null; status: number | null }> {
  const start = Date.now();
  try {
    const response = await fetch(target, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return { name, target, ok: response.status < 500, latency_ms: Date.now() - start, status: response.status };
  } catch {
    return { name, target, ok: false, latency_ms: null, status: null };
  }
}

function renderDashboard(host: string): string {
  const entries = Object.entries(API_MAPPING).map(([prefix, target]) => {
    const name = prefix.slice(1);
    const proxyUrl = `https://${host}${prefix}`;
    const docs = API_DOCS[prefix];
    return { name, prefix, target, proxyUrl, docs };
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>API Proxy</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%236c8aff'/%3E%3Cstop offset='100%25' stop-color='%23a855f7'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='14' fill='%230a0a0f'/%3E%3Ccircle cx='16' cy='20' r='4' fill='url(%23g)' opacity='.8'/%3E%3Ccircle cx='16' cy='32' r='4' fill='url(%23g)'/%3E%3Ccircle cx='16' cy='44' r='4' fill='url(%23g)' opacity='.8'/%3E%3Ccircle cx='48' cy='32' r='5' fill='url(%23g)'/%3E%3Cline x1='20' y1='20' x2='43' y2='31' stroke='url(%23g)' stroke-width='2' stroke-linecap='round' opacity='.6'/%3E%3Cline x1='20' y1='32' x2='43' y2='32' stroke='url(%23g)' stroke-width='2.5' stroke-linecap='round'/%3E%3Cline x1='20' y1='44' x2='43' y2='33' stroke='url(%23g)' stroke-width='2' stroke-linecap='round' opacity='.6'/%3E%3C/svg%3E">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0f;--card:#12121a;--card-hover:#1a1a26;--border:#1e1e2e;--text:#e0e0e0;--dim:#666;--accent:#6c8aff;--green:#22c55e;--red:#ef4444;--yellow:#eab308;--radius:12px}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;padding:1.5rem}
.container{max-width:1100px;margin:0 auto}
header{text-align:center;margin-bottom:2rem}
header h1{font-size:1.5rem;font-weight:600;letter-spacing:-.02em}
header p{color:var(--dim);font-size:.82rem;margin-top:.3rem}
.node-info{display:inline-flex;align-items:center;gap:.5rem;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:.35rem .9rem;margin-top:.6rem;font-size:.78rem;color:var(--dim)}
.node-info .dot{width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0}
.section-title{font-size:.85rem;font-weight:600;color:var(--dim);margin:1.8rem 0 .8rem;text-transform:uppercase;letter-spacing:.06em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:.8rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.1rem;transition:background .15s,border-color .15s}
.card:hover{background:var(--card-hover);border-color:#2a2a3e}
.card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
.card-name{font-size:.95rem;font-weight:600;text-transform:capitalize}
.status{display:flex;align-items:center;gap:.35rem;font-size:.72rem}
.status .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.status .dot.ok{background:var(--green)}
.status .dot.err{background:var(--red)}
.status .dot.loading{background:var(--yellow);animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.card-url{font-size:.75rem;color:var(--dim);word-break:break-all;background:#0d0d14;border-radius:6px;padding:.4rem .6rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.4rem}
.card-url code{flex:1;overflow:hidden;text-overflow:ellipsis}
.copy-btn{background:none;border:1px solid var(--border);color:var(--dim);border-radius:4px;padding:2px 8px;cursor:pointer;font-size:.68rem;white-space:nowrap;transition:color .15s,border-color .15s}
.copy-btn:hover{color:var(--accent);border-color:var(--accent)}
.card-meta{font-size:.7rem;color:#444;line-height:1.5}
.card-meta span{color:var(--dim)}
.card-note{font-size:.68rem;color:#555;font-style:italic;margin-top:.2rem}
.example-block{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.1rem;position:relative;margin-bottom:.8rem}
.example-block select{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:.3rem .6rem;font-size:.78rem;margin-bottom:.7rem;cursor:pointer}
.example-block pre{font-size:.75rem;line-height:1.55;overflow-x:auto;white-space:pre-wrap;word-break:break-all;color:#b0b0b0}
.example-block .copy-btn{position:absolute;top:1rem;right:1rem}
.sys-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:.8rem}
.sys-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.1rem}
.sys-card h3{font-size:.85rem;font-weight:600;margin-bottom:.4rem;color:var(--accent)}
.sys-card .sys-url{font-size:.75rem;background:#0d0d14;border-radius:6px;padding:.35rem .6rem;margin-bottom:.4rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.sys-card .sys-url code{color:var(--dim);flex:1}
.sys-card p{font-size:.72rem;color:#555;line-height:1.5}
.usage{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.1rem}
.usage h3{font-size:.85rem;font-weight:600;margin-bottom:.6rem}
.usage p,.usage li{font-size:.78rem;color:var(--dim);line-height:1.7}
.usage ul{padding-left:1.2rem}
.usage code{background:#0d0d14;padding:.1rem .35rem;border-radius:3px;font-size:.73rem;color:var(--accent)}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>API Reverse Proxy</h1>
    <p>${Object.keys(API_MAPPING).length} endpoints available &middot; <a href="https://github.com/Haor/cf-ai-proxy" target="_blank" style="color:var(--accent);text-decoration:none">GitHub</a></p>
    <div class="node-info" id="nodeInfo"><span class="dot"></span><span id="nodeText">detecting...</span></div>
  </header>

  <div class="section-title">Endpoints</div>
  <div class="grid" id="grid">
${entries.map(e => `    <div class="card" data-name="${e.name}">
      <div class="card-head">
        <span class="card-name">${e.name}</span>
        <span class="status"><span class="dot loading" id="dot-${e.name}"></span><span id="ms-${e.name}">...</span></span>
      </div>
      <div class="card-url"><code>${e.proxyUrl}</code><button class="copy-btn" onclick="copyText('${e.proxyUrl}',this)">Copy</button></div>
      <div class="card-meta"><span>Auth:</span> ${e.docs?.auth ?? '-'}</div>
      <div class="card-meta"><span>Endpoint:</span> ${e.docs?.example_endpoint ?? '-'}</div>
${e.docs?.note ? `      <div class="card-note">${e.docs.note}</div>` : ''}
    </div>`).join('\n')}
  </div>

  <div class="section-title">Quick Start</div>
  <div class="example-block">
    <select id="exampleSelect" onchange="updateExample()">
      <option value="openai">OpenAI</option>
      <option value="claude">Claude</option>
      <option value="gemini">Gemini</option>
      <option value="openrouter">OpenRouter</option>
      <option value="groq">Groq</option>
      <option value="mistral">Mistral</option>
      <option value="xai">xAI</option>
      <option value="perplexity">Perplexity</option>
      <option value="zenmux">ZenMux</option>
    </select>
    <button class="copy-btn" onclick="copyExample()">Copy</button>
    <pre id="exampleCode"></pre>
  </div>

  <div class="section-title">Usage</div>
  <div class="usage">
    <h3>How it works</h3>
    <p>Replace the original API base URL with this proxy. All headers (auth, version, beta flags, etc.) are forwarded as-is.</p>
    <ul>
      <li><code>https://api.openai.com</code> &rarr; <code>https://${host}/openai</code></li>
      <li><code>https://api.anthropic.com</code> &rarr; <code>https://${host}/claude</code></li>
      <li>SDK base_url example: <code>base_url="https://${host}/openai/v1"</code></li>
    </ul>
    <h3 style="margin-top:.8rem">SDK Examples</h3>
    <ul>
      <li><strong>Python (OpenAI SDK):</strong> <code>OpenAI(base_url="https://${host}/openai/v1")</code></li>
      <li><strong>Python (Anthropic SDK):</strong> <code>Anthropic(base_url="https://${host}/claude")</code></li>
      <li><strong>Node.js:</strong> <code>new OpenAI({ baseURL: "https://${host}/openai/v1" })</code></li>
    </ul>
  </div>

  <div class="section-title">System Endpoints</div>
  <div class="sys-grid">
    <div class="sys-card">
      <h3>GET /health</h3>
      <div class="sys-url"><code>https://${host}/health</code><button class="copy-btn" onclick="copyText('curl https://${host}/health',this)">Copy curl</button></div>
      <p>Returns <code>{"status":"ok"}</code>. Use for uptime monitoring (e.g. UptimeRobot, Grafana).</p>
    </div>
    <div class="sys-card">
      <h3>GET /api/status</h3>
      <div class="sys-url"><code>https://${host}/api/status</code><button class="copy-btn" onclick="copyText('curl https://${host}/api/status',this)">Copy curl</button></div>
      <p>Probes all upstream APIs (HEAD, 5s timeout). Returns JSON array with name, ok, latency_ms, status for each.</p>
    </div>
    <div class="sys-card">
      <h3>GET /debug</h3>
      <div class="sys-url"><code>https://${host}/debug</code><button class="copy-btn" onclick="copyText('curl https://${host}/debug',this)">Copy curl</button></div>
      <p>Shows Worker placement info: entry colo, outbound IP/city/country. Useful for verifying the proxy exits from the correct region.</p>
    </div>
  </div>
</div>

<script>
const HOST = "${host}";
const EXAMPLES = {
  openai: \`curl https://\${HOST}/openai/v1/chat/completions \\\\
  -H "Content-Type: application/json" \\\\
  -H "Authorization: Bearer sk-YOUR_KEY" \\\\
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}'\`,
  claude: \`curl https://\${HOST}/claude/v1/messages \\\\
  -H "Content-Type: application/json" \\\\
  -H "x-api-key: sk-ant-YOUR_KEY" \\\\
  -H "anthropic-version: 2023-06-01" \\\\
  -d '{"model":"claude-sonnet-4-6","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'\`,
  gemini: \`curl "https://\${HOST}/gemini/v1beta/models/gemini-2.5-flash:generateContent?key=YOUR_KEY" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"contents":[{"parts":[{"text":"hello"}]}]}'\`,
  openrouter: \`curl https://\${HOST}/openrouter/v1/chat/completions \\\\
  -H "Content-Type: application/json" \\\\
  -H "Authorization: Bearer sk-or-YOUR_KEY" \\\\
  -d '{"model":"google/gemini-3-flash-preview","messages":[{"role":"user","content":"hello"}]}'\`,
  groq: \`curl https://\${HOST}/groq/v1/chat/completions \\\\
  -H "Content-Type: application/json" \\\\
  -H "Authorization: Bearer gsk_YOUR_KEY" \\\\
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"hello"}]}'\`,
  mistral: \`curl https://\${HOST}/mistral/v1/chat/completions \\\\
  -H "Content-Type: application/json" \\\\
  -H "Authorization: Bearer YOUR_KEY" \\\\
  -d '{"model":"mistral-large-latest","messages":[{"role":"user","content":"hello"}]}'\`,
  xai: \`curl https://\${HOST}/xai/v1/chat/completions \\\\
  -H "Content-Type: application/json" \\\\
  -H "Authorization: Bearer xai-YOUR_KEY" \\\\
  -d '{"model":"grok-3-latest","messages":[{"role":"user","content":"hello"}]}'\`,
  perplexity: \`curl https://\${HOST}/perplexity/chat/completions \\\\
  -H "Content-Type: application/json" \\\\
  -H "Authorization: Bearer pplx-YOUR_KEY" \\\\
  -d '{"model":"sonar-pro","messages":[{"role":"user","content":"hello"}]}'\`,
  zenmux: \`curl https://\${HOST}/zenmux/v1/chat/completions \\\\
  -H "Content-Type: application/json" \\\\
  -H "Authorization: Bearer YOUR_KEY" \\\\
  -d '{"model":"openai/gpt-4o","messages":[{"role":"user","content":"hello"}]}'\`,
};

function updateExample() {
  document.getElementById("exampleCode").textContent = EXAMPLES[document.getElementById("exampleSelect").value] || "";
}
updateExample();

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (!btn) return;
    const prev = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => btn.textContent = prev, 1200);
  });
}

function copyExample() {
  const code = document.getElementById("exampleCode").textContent;
  const btn = document.querySelector(".example-block .copy-btn");
  copyText(code, btn);
}

fetch("/debug").then(r => r.json()).then(d => {
  const loc = [d.outbound_city, d.outbound_country].filter(Boolean).join(", ");
  document.getElementById("nodeText").textContent = loc ? "Outbound: " + loc : "Node: " + (d.entry_colo || "unknown");
}).catch(() => {
  document.getElementById("nodeText").textContent = "unable to detect";
});

fetch("/api/status").then(r => r.json()).then(data => {
  for (const item of data) {
    const dot = document.getElementById("dot-" + item.name);
    const ms = document.getElementById("ms-" + item.name);
    if (!dot) continue;
    dot.classList.remove("loading");
    dot.classList.add(item.ok ? "ok" : "err");
    ms.textContent = item.ok ? item.latency_ms + "ms" : "unreachable";
  }
}).catch(() => {});
</script>
</body>
</html>`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const host = url.host;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (pathname === '/' || pathname === '/index.html') {
      return new Response(renderDashboard(host), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
      });
    }

    if (pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    if (pathname === '/health') {
      return Response.json({ status: 'ok' }, { headers: CORS_HEADERS });
    }

    if (pathname === '/debug') {
      const cf = (request as any).cf;
      const placement = request.headers.get('cf-placement');
      let outbound = null;
      try {
        const ipRes = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(5000) });
        outbound = await ipRes.json();
      } catch {}
      return Response.json({
        placement,
        entry_colo: cf?.colo,
        outbound_ip: (outbound as any)?.ip,
        outbound_city: (outbound as any)?.city,
        outbound_region: (outbound as any)?.region,
        outbound_country: (outbound as any)?.country,
      }, { headers: CORS_HEADERS });
    }

    if (pathname === '/api/status') {
      const results = await Promise.all(
        Object.entries(API_MAPPING).map(([prefix, target]) =>
          probeUpstream(prefix.slice(1), target)
        )
      );
      return Response.json(results, { headers: CORS_HEADERS });
    }

    const match = extractPrefixAndRest(pathname);
    if (!match) {
      return new Response('Not Found', { status: 404 });
    }

    const [prefix, rest] = match;
    const targetUrl = `${API_MAPPING[prefix]}${rest}${url.search}`;

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: buildForwardHeaders(request.headers),
        body: request.body,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      return new Response(response.body, {
        status: response.status,
        headers: buildResponseHeaders(response.headers),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return new Response('Gateway Timeout', { status: 504 });
      }
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};
