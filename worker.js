/**
 * Cloudflare Worker - 食光 API 代理
 * 部署到 Cloudflare Workers，API Key 存在环境变量中，前端拿不到
 *
 * 部署步骤：
 * 1. 打开 https://dash.cloudflare.com/ → Workers & Pages → 创建 Worker
 * 2. 粘贴此文件全部内容
 * 3. 设置环境变量：DEEPSEEK_KEY = sk-0748a47c21e94043b171358f5c9a251c
 * 4. 部署，记录 Worker URL（类似：https://shiguang-proxy.你的用户名.workers.dev）
 * 5. 把 Worker URL 填入 index.html 的 API 配置中
 */

// ===== 频率限制 =====
// Cloudflare Workers 在全局 scope 的 Map 会在多个请求间共享（同一 isolate 内）
const rateMap = new Map();
const RATE_WINDOW = 60000;      // 60秒窗口
const RATE_MAX = 30;            // 每窗口最多30次（单IP）
const DAILY_MAX = 200;          // 每日总限额
const dailyCount = new Map();   // 按日期计数

function rateLimit(ip) {
  const now = Date.now();
  const today = new Date().toDateString();

  // 每分钟限制
  if (!rateMap.has(ip)) rateMap.set(ip, []);
  const times = rateMap.get(ip).filter(t => now - t < RATE_WINDOW);
  times.push(now);
  rateMap.set(ip, times);

  // 定期清理旧数据（1%概率触发）
  if (Math.random() < 0.01) {
    for (const [k, t] of rateMap) {
      const fresh = t.filter(x => now - x < RATE_WINDOW);
      if (!fresh.length) rateMap.delete(k);
      else rateMap.set(k, fresh);
    }
  }

  if (times.length > RATE_MAX) return { blocked: true, reason: '请求太频繁' };

  // 每日限制
  const dailyKey = today + ':' + ip;
  const count = (dailyCount.get(dailyKey) || 0) + 1;
  dailyCount.set(dailyKey, count);
  if (count > DAILY_MAX) return { blocked: true, reason: '今日额度已用完' };

  return { blocked: false, count };
}

// ===== CORS 头 =====
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ===== 主函数 =====
export default {
  async fetch(request, env) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 只允许 POST
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: '只支持POST请求' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // === 频率限制 ===
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const limit = rateLimit(ip);
    if (limit.blocked) {
      return new Response(JSON.stringify({ error: limit.reason }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // === 输入验证 ===
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: '无效的JSON格式' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const { model, max_tokens, stream, system, messages } = body;

    if (!messages || !Array.isArray(messages) || !messages.length) {
      return new Response(JSON.stringify({ error: '缺少messages参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.content?.length > 2000) {
      return new Response(JSON.stringify({ error: '问题内容太长（最多2000字符）' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // === 构建 DeepSeek API 请求（Anthropic兼容格式） ===
    const API_KEY = env.DEEPSEEK_KEY;
    if (!API_KEY) {
      return new Response(JSON.stringify({ error: '服务未配置API Key' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const deepseekBody = {
      model: model || 'deepseek-chat',
      max_tokens: Math.min(max_tokens || 1000, 2000),  // 上限2000
      stream: stream || false,
      messages: messages
    };

    // 如果有 system prompt，加入
    if (system) {
      deepseekBody.system = system;
    }

    try {
      const resp = await fetch('https://api.deepseek.com/anthropic/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify(deepseekBody)
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error('DeepSeek API 错误:', resp.status, errText);
        return new Response(JSON.stringify({ error: `AI服务错误 (${resp.status})` }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // === 流式透传 ===
      if (stream) {
        return new Response(resp.body, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ...corsHeaders
          }
        });
      }

      // === 非流式直接返回 ===
      const data = await resp.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (err) {
      console.error('请求失败:', err.message);
      return new Response(JSON.stringify({ error: '请求AI服务失败，请重试' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};
