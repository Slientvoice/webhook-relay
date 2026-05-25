import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

const PENDING_SET = 'webhook:pending';
const LOG_LIST = 'webhook:log';

export default async function handler(req: VercelRequest, res: VercelResponse) {

  // ── GET：拉取待处理数据 ──
  if (req.method === 'GET') {
    const action = req.query.action;

    if (action === 'pending') {
      const ids = await kv.smembers(PENDING_SET);
      if (ids.length === 0) {
        return res.json({ items: [] });
      }
      const items = [];
      for (const id of ids.slice(0, 10)) {
        const raw = await kv.get(`webhook:${id}`);
        if (raw) {
          try {
            items.push({ id, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) });
          } catch { /* skip bad data */ }
        }
      }
      return res.json({ items });
    }

    if (action === 'stats') {
      const pending = await kv.scard(PENDING_SET);
      const logs = await kv.llen(LOG_LIST);
      return res.json({ pending, logs });
    }

    return res.json({ error: 'unknown action' });
  }

  // ── POST：CourtListener 发 webhook ──
  if (req.method === 'POST') {
    const body = req.body;
    const idemKey = req.headers['idempotency-key'] as string;

    if (!body?.payload?.results || !Array.isArray(body.payload.results)) {
      return res.status(400).json({ error: 'invalid payload' });
    }

    if (idemKey) {
      const dup = await kv.get(`idem:${idemKey}`);
      if (dup) {
        return res.json({ status: 'duplicate', id: dup });
      }
    }

    const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const record = {
      receivedAt: new Date().toISOString(),
      idempotencyKey: idemKey || null,
      payload: body.payload,
      webhook: body.webhook || null
    };

    await kv.set(`webhook:${id}`, JSON.stringify(record));
    await kv.sadd(PENDING_SET, id);
    await kv.lpush(LOG_LIST, `${new Date().toISOString()} RECV ${id}`);

    if (idemKey) {
      await kv.set(`idem:${idemKey}`, id);
    }

    return res.json({ status: 'queued', id });
  }

  // ── DELETE：标记已处理 ──
  if (req.method === 'DELETE') {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'missing id' });
    await kv.srem(PENDING_SET, id);
    await kv.lpush(LOG_LIST, `${new Date().toISOString()} DONE ${id}`);
    return res.json({ status: 'processed', id });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
