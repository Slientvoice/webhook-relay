import { Redis } from '@upstash/redis';

let redisInstance = null;
function getRedis() {
  if (!redisInstance) {
    redisInstance = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    });
  }
  return redisInstance;
}

const PENDING_SET = 'webhook:pending';
const LOG_LIST = 'webhook:log';

export default async function handler(req, res) {
  const r = getRedis();

  // GET: 拉取待处理
  if (req.method === 'GET') {
    const { action } = req.query;
    if (action === 'pending') {
      const ids = await r.smembers(PENDING_SET);
      if (ids.length === 0) return res.json({ items: [] });
      const items = [];
      for (const id of ids.slice(0, 10)) {
        const raw = await r.get(`webhook:${id}`);
        if (raw) {
          try { items.push({ id, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) }); } catch {}
        }
      }
      return res.json({ items });
    }
    if (action === 'stats') {
      return res.json({ pending: await r.scard(PENDING_SET), logs: await r.llen(LOG_LIST) });
    }
    return res.json({ error: 'unknown action' });
  }

  // POST: 接收 webhook
  if (req.method === 'POST') {
    const body = req.body;
    const idemKey = req.headers['idempotency-key'];

    if (!body?.payload?.results || !Array.isArray(body.payload.results)) {
      return res.status(400).json({ error: 'invalid payload' });
    }

    if (idemKey) {
      const dup = await r.get(`idem:${idemKey}`);
      if (dup) return res.json({ status: 'duplicate', id: dup });
    }

    const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await r.set(`webhook:${id}`, JSON.stringify({
      receivedAt: new Date().toISOString(),
      idempotencyKey: idemKey || null,
      payload: body.payload,
      webhook: body.webhook || null
    }));
    await r.sadd(PENDING_SET, id);
    await r.lpush(LOG_LIST, `${new Date().toISOString()} RECV ${id}`);
    if (idemKey) await r.set(`idem:${idemKey}`, id);

    return res.json({ status: 'queued', id });
  }

  // DELETE: 标记已处理
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'missing id' });
    await r.srem(PENDING_SET, id);
    return res.json({ status: 'processed', id });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
