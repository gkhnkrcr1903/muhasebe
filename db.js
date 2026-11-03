const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'muhasebe.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user'))
);
CREATE TABLE IF NOT EXISTS danisanlar (
  id INTEGER PRIMARY KEY,
  ad TEXT NOT NULL,
  telefon TEXT,
  varsayilan_ucret REAL NOT NULL DEFAULT 0,
  notlar TEXT,
  aktif INTEGER NOT NULL DEFAULT 1,
  olusturma TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS seanslar (
  id INTEGER PRIMARY KEY,
  danisan_id INTEGER NOT NULL REFERENCES danisanlar(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  tarih TEXT NOT NULL,          -- YYYY-MM-DD
  saat TEXT,                    -- HH:MM
  ucret REAL NOT NULL DEFAULT 0,
  durum TEXT NOT NULL DEFAULT 'planlandi' CHECK (durum IN ('planlandi','tamamlandi','iptal')),
  odendi INTEGER NOT NULL DEFAULT 0,
  notlar TEXT,
  olusturma TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seans_tarih ON seanslar(tarih);
CREATE TABLE IF NOT EXISTS seans_gecmisi (
  id INTEGER PRIMARY KEY,
  seans_id INTEGER NOT NULL,
  degistiren_id INTEGER NOT NULL,
  aciklama TEXT NOT NULL,
  zaman TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

// İlk kurulumda 3 kullanıcıyı oluştur. Şifreler ortam değişkenlerinden alınır.
const seedUsers = [
  { username: 'gokhan', display_name: 'Gökhan', role: 'admin', env: 'ADMIN_PASSWORD' },
  { username: 'defne', display_name: 'Defne Çocuk ve Aile', role: 'user', env: 'DEFNE_PASSWORD' },
  { username: 'elda', display_name: 'Elda Psikoloji', role: 'user', env: 'ELDA_PASSWORD' },
];
const insertUser = db.prepare(
  'INSERT OR IGNORE INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
);
for (const u of seedUsers) {
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(u.username);
  if (!exists) {
    const pw = process.env[u.env] || 'degistir123';
    insertUser.run(u.username, u.display_name, hashPassword(pw), u.role);
    console.log(`Kullanıcı oluşturuldu: ${u.username}${process.env[u.env] ? '' : ' (varsayılan şifre: degistir123 — giriş yapınca değiştirin)'}`);
  }
}

module.exports = { db, hashPassword, verifyPassword };
