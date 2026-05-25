const store = new Map();
const pending = new Set();

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = req.query.action;
      if (a === 'pending') {
        const ids = [...pending].slice(0, 10);
        return res.json({ items: ids.map(id => ({ id, ...store.get(id) })) });
      }
      if (a === 'stats') {
        return res.json({ pending: pending.size });
      }
      return res.json({ ok: true });
    }

    if (req.method === 'POST') {
      const body = req.body;
      const idemKey = (req.headers['idempotency-key'] || '').trim();
      if (!body?.payload?.results) {
        return res.status(400).json({ error: 'invalid payload' });
      }
      if (idemKey && store.has(`idem:${idemKey}`)) {
        return res.json({ status: 'duplicate' });
      }
      const id = `wh_${Date.now()}`;
      store.set(id, {
        receivedAt: new Date().toISOString(),
        payload: body.payload,
        webhook: body.webhook || null
      });
      pending.add(id);
      if (idemKey) store.set(`idem:${idemKey}`, id);
      return res.json({ status: 'queued', id });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (id) { pending.delete(id); store.delete(id); }
      return res.json({ status: 'ok' });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
