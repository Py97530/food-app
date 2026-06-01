/**
 * Netlify Serverless Function - API代理
 * API Key 藏在服务端环境变量，前端拿不到
 */

// 简易频率限制
const rateMap = new Map();

exports.handler = async (event) => {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: '只支持POST' }) };
  }

  // === 频率限制 ===
  const ip = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const windowMs = 60000;
  const maxReq = 30;

  if (!rateMap.has(ip)) rateMap.set(ip, []);
  const times = rateMap.get(ip).filter(t => now - t < windowMs);
  times.push(now);
  rateMap.set(ip, times);

  if (Math.random() < 0.01) {
    for (const [k, t] of rateMap) {
      const fresh = t.filter(x => now - x < windowMs);
      if (!fresh.length) rateMap.delete(k);
      else rateMap.set(k, fresh);
    }
  }

  if (times.length > maxReq) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: '太频繁了，请稍等' }) };
  }

  // === 输入验证 ===
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '无效的JSON' }) };
  }

  const { messages } = body;
  if (!messages || !Array.isArray(messages) || !messages.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '缺少messages' }) };
  }

  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.content?.length > 1000) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '问题太长' }) };
  }

  // === 调用 DeepSeek ===
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: '服务未配置' }) };
  }

  try {
    const resp = await fetch('https://api.deepseek.com/anthropic/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        max_tokens: 1500,
        stream: false,
        messages
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('API错误:', resp.status, errText);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'AI服务暂不可用' }) };
    }

    const data = await resp.json();
    let reply = '';
    for (const block of data.content || []) {
      if (block.type === 'text') reply += block.text;
    }

    return { statusCode: 200, headers, body: JSON.stringify({ reply }) };

  } catch (err) {
    console.error('请求失败:', err.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: '请求失败，请重试' }) };
  }
};
