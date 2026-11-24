// Data-access layer for the `transcriptions` table (parameterised SQL only).
const { pool } = require('./db');

const COLUMNS = `id, title, text, language, provider, duration_sec::float AS duration_sec,
                 segments, created_at, updated_at`;

const SORTABLE = { created_at: 'created_at', updated_at: 'updated_at', title: 'title', duration_sec: 'duration_sec' };

async function list({ q, language, limit = 20, offset = 0, sort = 'created_at', order = 'desc' }) {
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(title ILIKE $${params.length} OR text ILIKE $${params.length})`);
  }
  if (language) {
    params.push(language);
    where.push(`language = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortCol = SORTABLE[sort] || 'created_at';
  const dir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const total = await pool.query(`SELECT count(*)::int AS n FROM transcriptions ${whereSql}`, params);
  params.push(limit, offset);
  const rows = await pool.query(
    `SELECT ${COLUMNS} FROM transcriptions ${whereSql}
     ORDER BY ${sortCol} ${dir}, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.rows, total: total.rows[0].n, limit, offset };
}

async function get(id) {
  const r = await pool.query(`SELECT ${COLUMNS} FROM transcriptions WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function create({ title, text, language = null, provider = 'manual', duration_sec = 0, segments = [] }) {
  const r = await pool.query(
    `INSERT INTO transcriptions (title, text, language, provider, duration_sec, segments)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING ${COLUMNS}`,
    [title, text, language, provider, duration_sec, JSON.stringify(segments)],
  );
  return r.rows[0];
}

async function update(id, fields) {
  const allowed = ['title', 'text', 'language'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      params.push(fields[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return get(id);
  params.push(id);
  const r = await pool.query(
    `UPDATE transcriptions SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $${params.length} RETURNING ${COLUMNS}`,
    params,
  );
  return r.rows[0] || null;
}

async function remove(id) {
  const r = await pool.query('DELETE FROM transcriptions WHERE id = $1', [id]);
  return r.rowCount > 0;
}

async function stats() {
  const r = await pool.query(`
    SELECT count(*)::int AS total,
           coalesce(sum(duration_sec), 0)::float AS total_duration_sec,
           coalesce(sum(array_length(regexp_split_to_array(trim(text), '\\s+'), 1)), 0)::int AS total_words
    FROM transcriptions`);
  const langs = await pool.query(`
    SELECT coalesce(language, 'unknown') AS language, count(*)::int AS count
    FROM transcriptions GROUP BY 1 ORDER BY 2 DESC`);
  return { ...r.rows[0], by_language: langs.rows };
}

module.exports = { list, get, create, update, remove, stats };
