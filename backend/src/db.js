const { Pool } = require('pg');
const { databaseUrl } = require('./config');

const pool = new Pool({ connectionString: databaseUrl });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transcriptions (
  id           SERIAL PRIMARY KEY,
  title        VARCHAR(200) NOT NULL,
  text         TEXT         NOT NULL,
  language     VARCHAR(20),                 -- dominant detected language, e.g. 'hi', 'en', 'mixed'
  provider     VARCHAR(30),                 -- whisper | gemini | mock | manual
  duration_sec NUMERIC(10,2) DEFAULT 0,
  segments     JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- [{text, language, start, end}]
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions (created_at DESC);
`;

async function migrate(retries = 15) {
  for (let i = 1; ; i++) {
    try {
      await pool.query(SCHEMA);
      return;
    } catch (err) {
      if (i >= retries) throw err;
      console.warn(`DB not ready (${err.code || err.message}); retry ${i}/${retries}…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

module.exports = { pool, migrate };
