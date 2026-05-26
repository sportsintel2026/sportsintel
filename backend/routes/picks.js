// backend/routes/picks.js
// Endpoints:
//   GET    /api/picks       → list active picks (public to authenticated users)
//   POST   /api/picks       → create a pick (admin only)
//   DELETE /api/picks/:id   → soft-delete a pick (admin only)

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Extract caller's email from the Supabase JWT in the Authorization header
async function getCallerEmail(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.email || null;
}

function requireAdmin(handler) {
  return async (req, res) => {
    const email = await getCallerEmail(req);
    if (!email || email.toLowerCase() !== (ADMIN_EMAIL || '').toLowerCase()) {
      return res.status(403).json({ error: 'admin only' });
    }
    req.callerEmail = email;
    return handler(req, res);
  };
}

// GET /api/picks — list active picks, newest first
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('picks')
      .select('id, sport, game_label, game_time_et, pick_text, posted_at')
      .eq('is_active', true)
      .order('posted_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json({ picks: data || [] });
  } catch (err) {
    console.error('GET /api/picks', err);
    res.status(500).json({ error: 'failed to fetch picks' });
  }
});

// POST /api/picks — admin only
router.post('/', requireAdmin(async (req, res) => {
  const { sport, game_label, game_time_et, pick_text } = req.body || {};
  if (!sport || !game_label || !pick_text) {
    return res.status(400).json({ error: 'sport, game_label, pick_text required' });
  }
  try {
    const { data, error } = await supabase
      .from('picks')
      .insert([{ sport, game_label, game_time_et: game_time_et || null, pick_text }])
      .select()
      .single();
    if (error) throw error;
    res.json({ pick: data });
  } catch (err) {
    console.error('POST /api/picks', err);
    res.status(500).json({ error: 'failed to create pick' });
  }
}));

// DELETE /api/picks/:id — admin only (soft delete)
router.delete('/:id', requireAdmin(async (req, res) => {
  try {
    const { error } = await supabase
      .from('picks')
      .update({ is_active: false })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/picks/:id', err);
    res.status(500).json({ error: 'failed to remove pick' });
  }
}));

module.exports = router;
