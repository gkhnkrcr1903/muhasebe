const crypto = require('node:crypto');
const path = require('node:path');

// DATABASE_URL varsa PostgreSQL'e (ör. Neon) bağlanır; yoksa yerel geliştirme için
// dosyaya yazan gömülü PostgreSQL (PGlite) kullanılır.
let client;
async function connect() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
      max: 5,
    });
    client = { query: (sql, params) => pool.query(sql, params) };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || path.join(__dirname, 'data', 'pglite');
    require('node:fs').mkdirSync(path.dirname(dir), { recursive: true });
    const pg = new PGlite(dir);
    client = { query: (sql, params) => pg.query(sql, params) };
    console.log('DATABASE_URL tanımlı değil, yerel veritabanı kullanılıyor (data/pglite).');
  }
}

async function all(sql, params = []) { return (await client.query(sql, params)).rows; }
async function get(sql, params = []) { return (await all(sql, params))[0]; }
async function run(sql, params = []) { const r = await client.query(sql, params); return r.rowCount ?? r.affectedRows ?? 0; }

const SIMDI = "to_char(now() AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI')";

async function migrate() {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','user'))
    )`,
    `CREATE TABLE IF NOT EXISTS danisanlar (
      id SERIAL PRIMARY KEY,
      ad TEXT NOT NULL,
      telefon TEXT,
      varsayilan_ucret DOUBLE PRECISION NOT NULL DEFAULT 0,
      notlar TEXT,
      aktif INTEGER NOT NULL DEFAULT 1,
      olusturma TEXT NOT NULL DEFAULT ${SIMDI}
    )`,
    `CREATE TABLE IF NOT EXISTS seanslar (
      id SERIAL PRIMARY KEY,
      danisan_id INTEGER NOT NULL REFERENCES danisanlar(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      tarih TEXT NOT NULL,
      saat TEXT,
      ucret DOUBLE PRECISION NOT NULL DEFAULT 0,
      durum TEXT NOT NULL DEFAULT 'planlandi' CHECK (durum IN ('planlandi','tamamlandi','iptal')),
      odendi INTEGER NOT NULL DEFAULT 0,
      notlar TEXT,
      olusturma TEXT NOT NULL DEFAULT ${SIMDI}
    )`,
    'CREATE INDEX IF NOT EXISTS idx_seans_tarih ON seanslar(tarih)',
    `CREATE TABLE IF NOT EXISTS seans_gecmisi (
      id SERIAL PRIMARY KEY,
      seans_id INTEGER NOT NULL,
      degistiren_id INTEGER NOT NULL,
      aciklama TEXT NOT NULL,
      zaman TEXT NOT NULL DEFAULT ${SIMDI}
    )`,
    // Seans gelirinden komisyon / kâr payı olarak ayrılan yüzde
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS komisyon_orani DOUBLE PRECISION NOT NULL DEFAULT 0',
    `CREATE TABLE IF NOT EXISTS giderler (
      id SERIAL PRIMARY KEY,
      tarih TEXT NOT NULL,
      kategori TEXT NOT NULL,
      aciklama TEXT,
      tutar DOUBLE PRECISION NOT NULL DEFAULT 0,
      user_id INTEGER REFERENCES users(id),   -- NULL = ortak gider
      olusturan_id INTEGER NOT NULL REFERENCES users(id),
      olusturma TEXT NOT NULL DEFAULT ${SIMDI}
    )`,
    'CREATE INDEX IF NOT EXISTS idx_gider_tarih ON giderler(tarih)',
    // Tahsilat esaslı gelir için ödemenin alındığı gün
    'ALTER TABLE seanslar ADD COLUMN IF NOT EXISTS odeme_tarihi TEXT',
    'UPDATE seanslar SET odeme_tarihi = tarih WHERE odendi = 1 AND odeme_tarihi IS NULL',
    // Uygulama geneli ayarlar (anahtar/değer)
    'CREATE TABLE IF NOT EXISTS ayarlar (anahtar TEXT PRIMARY KEY, deger TEXT NOT NULL)',
    // Varsayılan: admin dışındaki kullanıcılar kendi şifresini değiştiremez
    "INSERT INTO ayarlar (anahtar, deger) VALUES ('sifre_degistirme_acik', '0') ON CONFLICT DO NOTHING",
  ];
  for (const sql of ddl) await client.query(sql);
}

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
async function seed() {
  // Admin şifresi unutulursa: ADMIN_SIFRE_SIFIRLA=1 ile açılışta ADMIN_PASSWORD'e sıfırlanır
  if (process.env.ADMIN_SIFRE_SIFIRLA === '1' && process.env.ADMIN_PASSWORD) {
    await run("UPDATE users SET password_hash = $1 WHERE username = 'gokhan'", [hashPassword(process.env.ADMIN_PASSWORD)]);
    console.log('Admin şifresi ADMIN_PASSWORD ile sıfırlandı. ADMIN_SIFRE_SIFIRLA değişkenini kaldırmayı unutmayın.');
  }
  for (const u of seedUsers) {
    if (await get('SELECT 1 FROM users WHERE username = $1', [u.username])) continue;
    const pw = process.env[u.env] || 'degistir123';
    await run('INSERT INTO users (username, display_name, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [u.username, u.display_name, hashPassword(pw), u.role]);
    console.log(`Kullanıcı oluşturuldu: ${u.username}${process.env[u.env] ? '' : ' (varsayılan şifre: degistir123 — giriş yapınca değiştirin)'}`);
  }
}

async function init() {
  await connect();
  await migrate();
  await seed();
}

module.exports = { init, all, get, run, hashPassword, verifyPassword };
