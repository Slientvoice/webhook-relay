// 内存存储（零依赖，保证能跑）
// 缺点：Vercel 冷启动时数据会丢失，但 CourtListener 会重试
const store = new Map();  // key → value
const pending = new Set(); // 待处理 ID 集合
const logs = [];           // 最近日志

export default async function handler(req, res) {

  // GET: OneDay 来拉取
  if (req.method === 'GET') {
    const action = req.query.action;

    if (action === 'pending') {
      const ids = [...pending].slice(0, 10);
      const items = ids.map(id => ({ id, ...store.get(id) })).filter(Boolean);
      return res.json({ items });
    }

    if (action === 'stats') {
      return res.json({ pending: pending.size, logs: logs.length });
    }

    return res.json({ status: 'ok', uptime: process.uptime() });
  }

  // POST: CourtListener 发 webhook
  if (req.method === 'POST') {
    const body = req.body;
    const idemKey = req.headers['idempotency-key'];

    if (!body?.payload?.results || !Array.isArray(body.payload.results)) {
      return res.status(400).json({ error: 'invalid payload' });
    }

    // 幂等去重
    if (idemKey && store.has(`idem:${idemKey}`)) {
      return res.json({ status: 'duplicate', id: store.get(`idem:${idemKey}`) });
    }

    const id = `wh_${Date.now()}`;
    store.set(id, {
      receivedAt: new Date().toISOString(),
      idempotencyKey: idemKey || null,
      payload: body.payload,
      webhook: body.webhook || null
    });
    pending.add(id);
    logs.push(`RECV ${id} entries=${body.payload.results.length}`);
    if (logs.length > 100) logs.shift();

    if (idemKey) store.set(`idem:${idemKey}`, id);

    return res.json({ status: 'queued', id });
  }

  // DELETE: OneDay 通知已处理
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'missing id' });
    pending.delete(id);
    store.delete(id);
    logs.push(`DONE ${id}`);
    return res.json({ status: 'processed', id });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
