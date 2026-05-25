const store = new Map();
const pending = new Set();

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = req.query.action;
      if (a === 'pending') {
        const ids = [...pending].slice(0, 10);
        return res.json({ items: ids.map(function(id) { return Object.assign({ id: id }, store.get(id)); }) });
      }
      if (a === 'stats') {
        return res.json({ pending: pending.size });
      }
      return res.json({ ok: true });
    }

    if (req.method === 'POST') {
      var body = req.body;
      var idemKey = (req.headers['idempotency-key'] || '').trim();
      if (!body || !body.payload || !body.payload.results) {
        return res.status(400).json({ error: 'invalid payload' });
      }
      if (idemKey && store.has('idem:' + idemKey)) {
        return res.json({ status: 'duplicate' });
      }
      var id = 'wh_' + Date.now();
      store.set(id, {
        receivedAt: new Date().toISOString(),
        payload: body.payload,
        webhook: body.webhook || null
      });
      pending.add(id);
      if (idemKey) store.set('idem:' + idemKey, id);
      return res.json({ status: 'queued', id: id });
    }

    if (req.method === 'DELETE') {
      var delId = req.query.id;
      if (delId) { pending.delete(delId); store.delete(delId); }
      return res.json({ status: 'ok' });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
