const SUPABASE_URL = 'https://kxnlcwbuqzjslaaybfxu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4bmxjd2J1cXpqc2xhYXliZnh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMTg3MzIwMCwiZXhwIjoyMDI3NDQ5MjAwfQ.8VJKzq0FqVXGxqYvN0YN9X0QZ0YvN0YN9X0QZ0YvN0Y';

const EVENT_MAP = {
  1: 'docket.alert',
  2: 'search.alert',
  3: 'recap.fetch.completed',
  4: 'old_alerts_report',
  5: 'pray_and_pay'
};

const store = new Map();
const pending = new Set();

async function supabaseUpsert(table, data, onConflict) {
  const qs = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(data)
  });
}

async function processWebhook(webhook, payload) {
  const entries = payload?.results || [];
  if (!entries.length) return;

  const eventType = EVENT_MAP[webhook?.event_type] || 'docket.alert';

  const docketIds = [...new Set(entries.map(function(e) { return e.docket; }).filter(Boolean))];
  if (!docketIds.length) return;

  // 1. 写入同步队列
  const queueResult = await (await fetch(`${SUPABASE_URL}/rest/v1/cl_sync_queue`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      docket_id: docketIds[0],
      event_type: eventType,
      status: 'pending',
      webhook_payload: payload
    })
  })).json();

  // 2. 写入案件映射
  for (var i = 0; i < docketIds.length; i++) {
    await supabaseUpsert('cl_case_mapping', { cl_docket_id: docketIds[i] }, 'cl_docket_id');
  }

  // 3. 写入事件和文档
  for (var j = 0; j < entries.length; j++) {
    var entry = entries[j];
    await supabaseUpsert('cl_case_events', {
      cl_docket_id: entry.docket,
      cl_entry_id: entry.id,
      entry_number: entry.entry_number,
      date_filed: entry.date_filed,
      description: entry.description || ''
    }, 'cl_entry_id');

    var docs = entry.recap_documents || [];
    for (var k = 0; k < docs.length; k++) {
      var doc = docs[k];
      await supabaseUpsert('cl_case_documents', {
        cl_docket_id: entry.docket,
        cl_document_id: doc.id,
        document_number: String(doc.document_number || ''),
        attachment_number: doc.attachment_number,
        description: doc.description || '',
        file_name: doc.file_name,
        page_count: doc.page_count,
        is_available: doc.is_available === true
      }, 'cl_document_id');
    }
  }

  // 4. 标记队列完成
  if (queueResult && queueResult[0]) {
    await (await fetch(`${SUPABASE_URL}/rest/v1/cl_sync_queue?id=eq.${queueResult[0].id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'done', processed_at: new Date().toISOString() })
    }));
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');

  try {
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method === 'GET') {
      var a = req.query.action;
      if (a === 'pending') {
        var ids = [...pending].slice(0, 10);
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
      store.set(id, { receivedAt: new Date().toISOString(), payload: body.payload, webhook: body.webhook || null });
      pending.add(id);
      if (idemKey) store.set('idem:' + idemKey, id);

      // 直接写入 Supabase，不做异步 fire-and-forget
      try {
        await processWebhook(body.webhook, body.payload);
        return res.json({ status: 'ok', id: id, synced: true });
      } catch (syncErr) {
        console.error('[relay] DB sync error:', syncErr);
        return res.json({ status: 'queued', id: id, synced: false, error: syncErr.message });
      }
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
