const Database = require('better-sqlite3');
const db = new Database('backup.db');

// إنشاء الجداول إذا ما كانت موجودة
db.prepare(`
CREATE TABLE IF NOT EXISTS roles (
  guildId TEXT,
  data TEXT
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS channels (
  guildId TEXT,
  data TEXT
)
`).run();

module.exports = db;
