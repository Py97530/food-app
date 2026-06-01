/**
 * Vercel Serverless Function - API代理
 * 把 DeepSeek API Key 藏在服务端，前端永远拿不到
 */

// 频率限制器（内存中，每个函数实例独立）
const rateLimiter = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1分钟窗口
  const maxRequests = 30;      // 每分钟最多30次

  if (!rateLimiter.has(ip)) {
    rateLimiter.set(ip, []);
  }

  const timestamps = rateLimiter.get(ip).filter(t => now - t < windowMs);
  timestamps.push(now);
  rateLimiter.set(ip, timestamps);

  // 定期清理旧数据（每100次清理一次）
  if (Math.random() < 0.01) {
    for (const [key, times] of rateLimiter) {
      const fresh = times.filter(t => now - t < windowMs);
      if (fresh.length === 0) rateLimiter.delete(key);
      else rateLimiter.set(key, fresh);
    }
  }

  return timestamps.length > maxRequests;
}

export default async function handler(req, res) {
  // === CORS 设置 ===
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持POST请求' });
  }

  // === 频率限制 ===
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: '请求太频繁，请稍后再试' });
  }

  // === 输入验证 ===
  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '请提供有效的messages参数' });
  }

  // 限制消息长度
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.content && lastMsg.content.length > 1000) {
    return res.status(400).json({ error: '问题太长，请控制在1000字以内' });
  }

  // === 调用 DeepSeek API ===
  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: '服务端未配置API Key' });
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
        messages: messages
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('DeepSeek API 错误:', resp.status, errText);
      return res.status(502).json({ error: 'AI服务暂时不可用，请稍后重试' });
    }

    const data = await resp.json();

    // 提取文本回复
    let reply = '';
    for (const block of data.content || []) {
      if (block.type === 'text') {
        reply += block.text;
      }
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('代理请求失败:', err.message);
    return res.status(502).json({ error: '网络请求失败，请重试' });
  }
}
