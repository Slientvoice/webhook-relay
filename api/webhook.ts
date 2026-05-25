import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!
    });
  }
  return redis;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 先测试 Redis 连接是否正常
    const r = getRedis();
    const testResult = await r.set('_ping', 'ok');

    res.json({
      status: 'ok',
      redisTest: testResult,
      env_url_exists: !!process.env.KV_REST_API_URL,
      env_token_exists: !!process.env.KV_REST_API_TOKEN
    });
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      stack: err.stack,
      env_url: process.env.KV_REST_API_URL ? 'set' : 'MISSING',
      env_token: process.env.KV_REST_API_TOKEN ? 'set' : 'MISSING'
    });
  }
}
