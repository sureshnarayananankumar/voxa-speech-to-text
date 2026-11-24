module.exports = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://stt:stt@localhost:5432/stt',
  sttUrl: process.env.STT_URL || 'http://localhost:8000', // Python STT/TTS service
  corsOrigin: process.env.CORS_ORIGIN || '*',
};
