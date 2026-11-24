// WebSocket gateway: browser <-> Node <-> Python STT service.
// Relays audio upstream and transcript events downstream, and persists each finished
// recording session as one row in PostgreSQL.
const { WebSocketServer, WebSocket } = require('ws');
const repo = require('./repository');
const { sttUrl } = require('./config');

const BYTES_PER_SEC = 16000 * 2; // PCM16 mono @16 kHz

function dominantLanguage(segments) {
  const counts = {};
  for (const s of segments) {
    const words = s.text.split(/\s+/).length;
    const lang = s.language || 'unknown';
    counts[lang] = (counts[lang] || 0) + words;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const total = entries.reduce((n, [, c]) => n + c, 0);
  // More than one language with a meaningful share => code-mixed speech
  return entries.length > 1 && entries[1][1] / total >= 0.2 ? 'mixed' : entries[0][0];
}

function defaultTitle(text) {
  const words = text.split(/\s+/).slice(0, 8).join(' ');
  return words.length < text.length ? `${words}…` : words;
}

function attachGateway(server) {
  const wss = new WebSocketServer({ server, path: '/ws/stream', maxPayload: 1 << 20 });

  wss.on('connection', (client) => {
    const upstream = new WebSocket(`${sttUrl.replace(/^http/, 'ws')}/ws/transcribe`);
    const queue = [];          // client messages received before upstream is open
    let session = null;        // { title, segments, bytes, provider, save }

    const sendClient = (obj) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify(obj));
    const sendUp = (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      else if (upstream.readyState === WebSocket.CONNECTING) queue.push([data, isBinary]);
    };

    upstream.on('open', () => {
      for (const [d, b] of queue.splice(0)) upstream.send(d, { binary: b });
    });
    upstream.on('error', (err) => {
      sendClient({ type: 'error', message: `STT service unreachable: ${err.message}` });
      client.close(1011);
    });
    upstream.on('close', () => client.readyState === WebSocket.OPEN && client.close());

    upstream.on('message', async (raw) => {
      let evt;
      try { evt = JSON.parse(raw.toString()); } catch { return; }

      if (evt.type === 'ready' && session) session.provider = evt.provider;
      if (evt.type === 'final' && session) session.segments.push({
        text: evt.text, language: evt.language, start: evt.start, end: evt.end,
      });
      sendClient(evt);

      if (evt.type === 'done' && session) {
        const s = session;
        session = null;
        const text = s.segments.map((x) => x.text).join(' ').trim();
        if (!s.save || !text) return sendClient({ type: 'saved', transcription: null });
        try {
          const row = await repo.create({
            title: s.title || defaultTitle(text),
            text,
            language: dominantLanguage(s.segments),
            provider: s.provider || 'unknown',
            duration_sec: +(s.bytes / BYTES_PER_SEC).toFixed(2),
            segments: s.segments,
          });
          sendClient({ type: 'saved', transcription: row });
        } catch (err) {
          sendClient({ type: 'error', message: `Could not save transcription: ${err.message}` });
        }
      }
    });

    client.on('message', (data, isBinary) => {
      if (isBinary) {
        if (session) session.bytes += data.length;
        return sendUp(data, true);
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'start') {
        session = {
          title: (msg.title || '').toString().trim().slice(0, 200),
          save: msg.save !== false,
          segments: [], bytes: 0, provider: null,
        };
        sendUp(JSON.stringify({ type: 'start', language: msg.language || 'auto' }), false);
      } else if (msg.type === 'stop') {
        sendUp(JSON.stringify({ type: 'stop' }), false);
      }
    });

    client.on('close', () => upstream.close());
  });

  return wss;
}

module.exports = { attachGateway, dominantLanguage, defaultTitle };
