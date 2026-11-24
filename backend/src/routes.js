const express = require('express');
const repo = require('./repository');
const { sttUrl } = require('./config');
const { pool } = require('./db');
const { dominantLanguage } = require('./ws-gateway');

const router = express.Router();

// --- tiny validation helpers -------------------------------------------------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'id must be a positive integer');
  return id;
}

function validateBody(body, { partial = false } = {}) {
  const out = {};
  const checkStr = (key, max, required) => {
    const v = body[key];
    if (v === undefined) {
      if (required && !partial) throw new HttpError(400, `${key} is required`);
      return;
    }
    if (typeof v !== 'string') throw new HttpError(400, `${key} must be a string`);
    const t = v.trim();
    if (required && !t) throw new HttpError(400, `${key} cannot be empty`);
    if (t.length > max) throw new HttpError(400, `${key} must be at most ${max} characters`);
    out[key] = t;
  };
  checkStr('title', 200, true);
  checkStr('text', 100000, true);
  if (body.language !== undefined && body.language !== null) checkStr('language', 20, false);
  return out;
}

// --- CRUD: /api/transcriptions --------------------------------------------------
router.get('/transcriptions', wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  res.json(await repo.list({
    q: (req.query.q || '').toString().trim() || undefined,
    language: (req.query.language || '').toString().trim() || undefined,
    sort: req.query.sort, order: req.query.order, limit, offset,
  }));
}));

router.get('/transcriptions/:id', wrap(async (req, res) => {
  const row = await repo.get(parseId(req.params.id));
  if (!row) throw new HttpError(404, 'Transcription not found');
  res.json(row);
}));

router.post('/transcriptions', wrap(async (req, res) => {
  const body = req.body || {};
  const data = validateBody(body);
  // Sessions recognised in the browser (Web Speech API) arrive here with their segments.
  const provider = body.provider === 'browser' ? 'browser' : 'manual';
  const segments = Array.isArray(body.segments)
    ? body.segments.slice(0, 5000)
      .filter((x) => x && typeof x.text === 'string' && x.text.trim())
      .map((x) => ({
        text: x.text.trim().slice(0, 5000),
        language: typeof x.language === 'string' ? x.language.slice(0, 20) : null,
        start: Number(x.start) || 0,
        end: Number(x.end) || 0,
      }))
    : [];
  const duration = Math.max(0, Math.min(Number(body.duration_sec) || 0, 86400));
  if (!data.language && segments.length) data.language = dominantLanguage(segments);
  res.status(201).json(await repo.create({ ...data, provider, segments, duration_sec: duration }));
}));

const updateHandler = (partial) => wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const row = await repo.update(id, validateBody(req.body || {}, { partial }));
  if (!row) throw new HttpError(404, 'Transcription not found');
  res.json(row);
});
router.put('/transcriptions/:id', updateHandler(false));
router.patch('/transcriptions/:id', updateHandler(true));

router.delete('/transcriptions/:id', wrap(async (req, res) => {
  if (!(await repo.remove(parseId(req.params.id)))) throw new HttpError(404, 'Transcription not found');
  res.status(204).end();
}));

router.get('/stats', wrap(async (_req, res) => res.json(await repo.stats())));

// --- Text-to-Speech: proxied to the Python service (Piper, open source) ---------
router.post('/tts', wrap(async (req, res) => {
  const text = (req.body?.text || '').toString().trim();
  if (!text) throw new HttpError(400, 'text is required');
  const upstream = await fetch(`${sttUrl}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 5000), language: req.body?.language || 'auto' }),
  }).catch(() => null);
  if (!upstream || !upstream.ok) {
    throw new HttpError(503, 'TTS unavailable (no Piper voice installed?) - client should fall back');
  }
  res.set('Content-Type', 'audio/wav');
  res.send(Buffer.from(await upstream.arrayBuffer()));
}));

router.get('/health', wrap(async (_req, res) => {
  const [stt, db] = await Promise.all([
    fetch(`${sttUrl}/health`).then((r) => r.json()).catch(() => ({ status: 'down' })),
    pool.query('SELECT 1').then(() => ({ status: 'ok' })).catch((e) => ({ status: 'down', error: e.code || e.message })),
  ]);
  res.json({ status: 'ok', stt, db });
}));

module.exports = { router, HttpError };
