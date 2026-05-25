import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 最简版本：确认函数能跑
  res.json({
    status: 'ok',
    method: req.method,
    body: req.body,
    query: req.query
  });
}
