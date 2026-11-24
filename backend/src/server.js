const http = require('http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const config = require('./config');
const { migrate, pool } = require('./db');
const { router, HttpError } = require('./routes');
const { attachGateway } = require('./ws-gateway');

function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));
  app.use('/api', router);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    const expose = err instanceof HttpError || status < 500;
    res.status(status).json({ error: expose ? err.message : 'Internal server error' });
  });
  return app;
}

async function main() {
  await migrate();
  const server = http.createServer(createApp());
  attachGateway(server);
  server.listen(config.port, () => console.log(`Backend listening on :${config.port} (STT at ${config.sttUrl})`));

  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { createApp };
