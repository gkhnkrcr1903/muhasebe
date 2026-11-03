const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const db = require('./db');
const { hashPassword, verifyPassword } = db;

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('UYARI: SESSION_SECRET tanımlı değil, yeniden başlatınca oturumlar düşer.');
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Express 4 async hataları yakalamaz; route'ları sarmalıyoruz.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Oturum (imzalı cookie) ----------
function sign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('hex');
}
function makeToken(userId) {
  const data = `${userId}.${Date.now() + TOKEN_TTL_MS}`;
  return `${data}.${sign(data)}`;
}
function readToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = sign(data);
  if (expected.length !== parts[2].length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  if (Number(parts[1]) < Date.now()) return null;
  return Number(parts[0]);
}
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const c of header.split(';')) {
    const [k, ...v] = c.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const auth = h(async (req, res, next) => {
  const userId = readToken(getCookie(req, 'oturum'));
  const user = userId && await db.get('SELECT id, username, display_name, role FROM users WHERE id = $1', [userId]);
  if (!user) return res.status(401).json({ hata: 'Giriş gerekli' });
  req.user = user;
  next();
});
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ hata: 'Bu işlem için yetkiniz yok' });
  next();
}
const isAdmin = (req) => req.user.role === 'admin';

// Uyanık tutma ping'i için; veritabanına dokunmaz (Neon uyuyabilsin diye)
app.get('/saglik', (req, res) => res.type('text').send('ok'));

const bugunIstanbul = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });

// ---------- Giriş ----------
app.post('/api/giris', h(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await db.get('SELECT * FROM users WHERE username = $1', [String(username || '').toLowerCase().trim()]);
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return res.status(401).json({ hata: 'Kullanıcı adı veya şifre hatalı' });
  }
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `oturum=${makeToken(user.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL_MS / 1000}${secure}`);
  res.json({ id: user.id, username: user.username, display_name: user.display_name, role: user.role });
}));

app.post('/api/cikis', (req, res) => {
  res.setHeader('Set-Cookie', 'oturum=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.use('/api', auth);

app.get('/api/ben', (req, res) => res.json(req.user));

app.post('/api/sifre', h(async (req, res) => {
  const { eski, yeni } = req.body || {};
  const user = await db.get('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!verifyPassword(String(eski || ''), user.password_hash)) return res.status(400).json({ hata: 'Mevcut şifre hatalı' });
  if (!yeni || String(yeni).length < 6) return res.status(400).json({ hata: 'Yeni şifre en az 6 karakter olmalı' });
  await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(String(yeni)), req.user.id]);
  res.json({ ok: true });
}));

// ---------- Kullanıcılar ----------
app.get('/api/kullanicilar', h(async (req, res) => {
  res.json(await db.all('SELECT id, username, display_name, role, komisyon_orani FROM users ORDER BY id'));
}));

app.put('/api/kullanicilar/:id/komisyon', adminOnly, h(async (req, res) => {
  const oran = Number(req.body?.komisyon_orani);
  if (!Number.isFinite(oran) || oran < 0 || oran > 100) return res.status(400).json({ hata: 'Oran 0 ile 100 arasında olmalı' });
  const changes = await db.run('UPDATE users SET komisyon_orani = $1 WHERE id = $2', [oran, Number(req.params.id)]);
  if (!changes) return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });
  res.json({ ok: true });
}));

app.post('/api/kullanicilar/:id/sifre', adminOnly, h(async (req, res) => {
  const { yeni } = req.body || {};
  if (!yeni || String(yeni).length < 6) return res.status(400).json({ hata: 'Şifre en az 6 karakter olmalı' });
  const changes = await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(String(yeni)), Number(req.params.id)]);
  if (!changes) return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });
  res.json({ ok: true });
}));

// ---------- Danışanlar ----------
app.get('/api/danisanlar', h(async (req, res) => {
  const tumu = req.query.tumu === '1';
  res.json(await db.all(`SELECT * FROM danisanlar ${tumu ? '' : 'WHERE aktif = 1'} ORDER BY lower(ad)`));
}));

app.post('/api/danisanlar', h(async (req, res) => {
  const { ad, telefon, varsayilan_ucret, notlar } = req.body || {};
  if (!ad || !String(ad).trim()) return res.status(400).json({ hata: 'Danışan adı gerekli' });
  res.json(await db.get('INSERT INTO danisanlar (ad, telefon, varsayilan_ucret, notlar) VALUES ($1, $2, $3, $4) RETURNING *',
    [String(ad).trim(), telefon || null, Number(varsayilan_ucret) || 0, notlar || null]));
}));

app.put('/api/danisanlar/:id', h(async (req, res) => {
  const { ad, telefon, varsayilan_ucret, notlar, aktif } = req.body || {};
  if (!ad || !String(ad).trim()) return res.status(400).json({ hata: 'Danışan adı gerekli' });
  res.json(await db.get('UPDATE danisanlar SET ad = $1, telefon = $2, varsayilan_ucret = $3, notlar = $4, aktif = $5 WHERE id = $6 RETURNING *',
    [String(ad).trim(), telefon || null, Number(varsayilan_ucret) || 0, notlar || null, aktif === false || aktif === 0 ? 0 : 1, Number(req.params.id)]));
}));

// Danışanın seansları ve borç/ödeme durumu
app.get('/api/danisanlar/:id/hesap', h(async (req, res) => {
  const id = Number(req.params.id);
  const danisan = await db.get('SELECT * FROM danisanlar WHERE id = $1', [id]);
  if (!danisan) return res.status(404).json({ hata: 'Danışan bulunamadı' });
  const params = [id];
  let where = 'WHERE s.danisan_id = $1';
  if (!isAdmin(req)) { params.push(req.user.id); where += ` AND s.user_id = $${params.length}`; }
  const seanslar = await db.all(`${SEANS_SELECT} ${where} ORDER BY s.tarih DESC, s.saat DESC`, params);
  const gecerli = seanslar.filter((s) => s.durum !== 'iptal');
  const toplam = gecerli.reduce((a, s) => a + s.ucret, 0);
  const odenen = gecerli.filter((s) => s.odendi).reduce((a, s) => a + s.ucret, 0);
  res.json({ danisan, seanslar, ozet: { seans_sayisi: gecerli.length, toplam, odenen, borc: toplam - odenen } });
}));

// ---------- Seanslar ----------
const SEANS_SELECT = `
  SELECT s.*, d.ad AS danisan_ad, u.display_name AS kullanici_ad
  FROM seanslar s
  JOIN danisanlar d ON d.id = s.danisan_id
  JOIN users u ON u.id = s.user_id`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const DURUMLAR = ['planlandi', 'tamamlandi', 'iptal'];
const DURUM_ETIKET = { planlandi: 'Planlandı', tamamlandi: 'Tamamlandı', iptal: 'İptal' };

function getSeans(id) {
  return db.get(`${SEANS_SELECT} WHERE s.id = $1`, [id]);
}
function canAccess(req, seans) {
  return isAdmin(req) || seans.user_id === req.user.id;
}
function logChange(seansId, userId, aciklama) {
  return db.run('INSERT INTO seans_gecmisi (seans_id, degistiren_id, aciklama) VALUES ($1, $2, $3)', [seansId, userId, aciklama]);
}

async function validateSeans(req, s) {
  if (!DATE_RE.test(s.tarih || '')) return 'Geçerli bir tarih girin';
  if (s.saat && !TIME_RE.test(s.saat)) return 'Saat SS:DD biçiminde olmalı';
  if (!DURUMLAR.includes(s.durum || 'planlandi')) return 'Geçersiz durum';
  if (s.odeme_tarihi && !DATE_RE.test(s.odeme_tarihi)) return 'Geçerli bir ödeme tarihi girin';
  if (!Number.isInteger(s.danisan_id) || !await db.get('SELECT 1 FROM danisanlar WHERE id = $1', [s.danisan_id])) return 'Danışan bulunamadı';
  if (!Number.isInteger(s.user_id) || !await db.get("SELECT 1 FROM users WHERE id = $1 AND role = 'user'", [s.user_id])) return 'Seansı alacak kişi geçersiz';
  if (!isAdmin(req) && s.user_id !== req.user.id) return 'Seansı yalnızca kendinize atayabilirsiniz';
  return null;
}

app.get('/api/seanslar', h(async (req, res) => {
  const { baslangic, bitis, user_id } = req.query;
  if (!DATE_RE.test(baslangic || '') || !DATE_RE.test(bitis || '')) return res.status(400).json({ hata: 'Tarih aralığı gerekli' });
  const params = [baslangic, bitis];
  let where = 'WHERE s.tarih BETWEEN $1 AND $2';
  if (!isAdmin(req)) { params.push(req.user.id); where += ` AND s.user_id = $${params.length}`; }
  else if (user_id) { params.push(Number(user_id)); where += ` AND s.user_id = $${params.length}`; }
  res.json(await db.all(`${SEANS_SELECT} ${where} ORDER BY s.tarih, s.saat`, params));
}));

app.post('/api/seanslar', h(async (req, res) => {
  const b = req.body || {};
  const data = {
    danisan_id: Number(b.danisan_id),
    user_id: Number(b.user_id || req.user.id),
    tarih: b.tarih, saat: b.saat || null,
    ucret: Number(b.ucret) || 0,
    durum: b.durum || 'planlandi',
    odendi: b.odendi ? 1 : 0,
    notlar: b.notlar || null,
  };
  data.odeme_tarihi = data.odendi ? (b.odeme_tarihi || bugunIstanbul()) : null;
  const err = await validateSeans(req, data);
  if (err) return res.status(400).json({ hata: err });
  // tekrar: aynı seansı sonraki N haftaya da ekle (en fazla 52)
  const tekrar = Math.min(Math.max(parseInt(b.tekrar, 10) || 0, 0), 52);
  let ilkId;
  for (let i = 0; i <= tekrar; i++) {
    const tarih = i === 0 ? data.tarih : gunEkle(data.tarih, 7 * i);
    // Tekrarlanan seanslar planlandı ve ödenmemiş olarak başlar
    const durum = i === 0 ? data.durum : 'planlandi';
    const odendi = i === 0 ? data.odendi : 0;
    const odemeTarihi = i === 0 ? data.odeme_tarihi : null;
    const { id } = await db.get(`INSERT INTO seanslar (danisan_id, user_id, tarih, saat, ucret, durum, odendi, notlar, odeme_tarihi)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [data.danisan_id, data.user_id, tarih, data.saat, data.ucret, durum, odendi, data.notlar, odemeTarihi]);
    await logChange(id, req.user.id, i === 0 ? 'Seans oluşturuldu' : `Tekrarlayan seans olarak oluşturuldu (${i}. hafta)`);
    ilkId ??= id;
  }
  res.json({ ...(await getSeans(ilkId)), olusturulan: tekrar + 1 });
}));

function gunEkle(tarih, gun) {
  const d = new Date(`${tarih}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + gun);
  return d.toISOString().slice(0, 10);
}

app.put('/api/seanslar/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  const old = await getSeans(id);
  if (!old || !canAccess(req, old)) return res.status(404).json({ hata: 'Seans bulunamadı' });
  const b = req.body || {};
  const data = {
    danisan_id: b.danisan_id !== undefined ? Number(b.danisan_id) : old.danisan_id,
    user_id: b.user_id !== undefined ? Number(b.user_id) : old.user_id,
    tarih: b.tarih ?? old.tarih,
    saat: b.saat !== undefined ? (b.saat || null) : old.saat,
    ucret: b.ucret !== undefined ? Number(b.ucret) || 0 : old.ucret,
    durum: b.durum ?? old.durum,
    odendi: b.odendi !== undefined ? (b.odendi ? 1 : 0) : old.odendi,
    notlar: b.notlar !== undefined ? (b.notlar || null) : old.notlar,
  };
  data.odeme_tarihi = data.odendi ? (b.odeme_tarihi || old.odeme_tarihi || bugunIstanbul()) : null;
  const err = await validateSeans(req, data);
  if (err) return res.status(400).json({ hata: err });
  await db.run(`UPDATE seanslar SET danisan_id = $1, user_id = $2, tarih = $3, saat = $4, ucret = $5, durum = $6, odendi = $7, notlar = $8, odeme_tarihi = $9 WHERE id = $10`,
    [data.danisan_id, data.user_id, data.tarih, data.saat, data.ucret, data.durum, data.odendi, data.notlar, data.odeme_tarihi, id]);

  const fresh = await getSeans(id);
  const changes = [];
  if (old.tarih !== fresh.tarih || old.saat !== fresh.saat) changes.push(`Zaman: ${old.tarih} ${old.saat || ''} → ${fresh.tarih} ${fresh.saat || ''}`);
  if (old.user_id !== fresh.user_id) changes.push(`Seansı alan: ${old.kullanici_ad} → ${fresh.kullanici_ad}`);
  if (old.danisan_id !== fresh.danisan_id) changes.push(`Danışan: ${old.danisan_ad} → ${fresh.danisan_ad}`);
  if (old.ucret !== fresh.ucret) changes.push(`Ücret: ${old.ucret} → ${fresh.ucret}`);
  if (old.durum !== fresh.durum) changes.push(`Durum: ${DURUM_ETIKET[old.durum]} → ${DURUM_ETIKET[fresh.durum]}`);
  if (old.odendi !== fresh.odendi) changes.push(fresh.odendi ? `Ödeme alındı (${fresh.odeme_tarihi})` : 'Ödeme geri alındı');
  else if (fresh.odendi && old.odeme_tarihi !== fresh.odeme_tarihi) changes.push(`Ödeme tarihi: ${old.odeme_tarihi} → ${fresh.odeme_tarihi}`);
  if (changes.length) await logChange(id, req.user.id, changes.join('; '));
  res.json(fresh);
}));

app.delete('/api/seanslar/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  const s = await getSeans(id);
  if (!s || !canAccess(req, s)) return res.status(404).json({ hata: 'Seans bulunamadı' });
  await db.run('DELETE FROM seanslar WHERE id = $1', [id]);
  await logChange(id, req.user.id, `Seans silindi (${s.danisan_ad}, ${s.tarih})`);
  res.json({ ok: true });
}));

app.get('/api/seanslar/:id/gecmis', h(async (req, res) => {
  const s = await getSeans(Number(req.params.id));
  if (!s || !canAccess(req, s)) return res.status(404).json({ hata: 'Seans bulunamadı' });
  res.json(await db.all(`SELECT g.*, u.display_name AS degistiren FROM seans_gecmisi g
    JOIN users u ON u.id = g.degistiren_id WHERE g.seans_id = $1 ORDER BY g.id DESC`, [s.id]));
}));

// ---------- Raporlar ----------
// grup: 'hafta' (pazartesi başlangıçlı) | 'ay'
app.get('/api/rapor', h(async (req, res) => {
  const { baslangic, bitis } = req.query;
  const grup = req.query.grup === 'ay' ? 'ay' : 'hafta';
  if (!DATE_RE.test(baslangic || '') || !DATE_RE.test(bitis || '')) return res.status(400).json({ hata: 'Tarih aralığı gerekli' });
  const donemExpr = grup === 'ay'
    ? 'substr(s.tarih, 1, 7)'
    : "to_char(date_trunc('week', s.tarih::date), 'YYYY-MM-DD')";
  const params = [baslangic, bitis];
  let where = "WHERE s.tarih BETWEEN $1 AND $2 AND s.durum != 'iptal'";
  if (!isAdmin(req)) { params.push(req.user.id); where += ` AND s.user_id = $${params.length}`; }
  const rows = await db.all(`
    SELECT ${donemExpr} AS donem, s.user_id, u.display_name AS kullanici_ad, u.komisyon_orani,
      COUNT(*)::int AS seans_sayisi,
      SUM(CASE WHEN s.durum = 'tamamlandi' THEN 1 ELSE 0 END)::int AS tamamlanan,
      SUM(s.ucret) AS toplam_ucret,
      SUM(CASE WHEN s.odendi = 1 THEN s.ucret ELSE 0 END) AS tahsil_edilen,
      SUM(CASE WHEN s.odendi = 0 THEN s.ucret ELSE 0 END) AS bekleyen
    FROM seanslar s JOIN users u ON u.id = s.user_id
    ${where}
    GROUP BY donem, s.user_id, u.display_name, u.id ORDER BY donem DESC, u.id`, params);
  for (const r of rows) {
    // Tahsilat esası: komisyon ve net, tahsil edilen tutar üzerinden
    r.komisyon = Math.round(r.tahsil_edilen * r.komisyon_orani) / 100;
    r.net = r.tahsil_edilen - r.komisyon;
  }
  res.json({ grup, satirlar: rows });
}));

// ---------- Giderler (vergi, stopaj vb.) ----------
const KATEGORILER = {
  stopaj: 'Stopaj', kdv: 'KDV', gelir_vergisi: 'Gelir vergisi', gecici_vergi: 'Geçici vergi', damga: 'Damga vergisi',
  sgk: 'SGK / Bağ-Kur', kira: 'Kira', fatura: 'Fatura (elektrik, su, internet)', maas: 'Maaş', muhasebe: 'Muhasebe',
  malzeme: 'Malzeme', diger: 'Diğer',
};
const VERGI_KATEGORILERI = ['stopaj', 'kdv', 'gelir_vergisi', 'gecici_vergi', 'damga'];

app.get('/api/gider-kategorileri', (req, res) => res.json({ kategoriler: KATEGORILER, vergi: VERGI_KATEGORILERI }));

const GIDER_SELECT = `SELECT g.*, u.display_name AS kullanici_ad FROM giderler g LEFT JOIN users u ON u.id = g.user_id`;

// Admin tüm giderleri (ortak dahil) görür; diğer kullanıcılar yalnızca kendilerine ait olanları.
function giderFiltre(req, params, alias = 'g') {
  if (!isAdmin(req)) { params.push(req.user.id); return ` AND ${alias}.user_id = $${params.length}`; }
  const f = req.query.user_id;
  if (f === 'ortak') return ` AND ${alias}.user_id IS NULL`;
  if (f) { params.push(Number(f)); return ` AND ${alias}.user_id = $${params.length}`; }
  return '';
}

async function validateGider(req, g) {
  if (!DATE_RE.test(g.tarih || '')) return 'Geçerli bir tarih girin';
  if (!KATEGORILER[g.kategori]) return 'Geçersiz kategori';
  if (!(g.tutar > 0)) return 'Tutar sıfırdan büyük olmalı';
  if (g.user_id !== null && !await db.get('SELECT 1 FROM users WHERE id = $1', [g.user_id])) return 'Kullanıcı bulunamadı';
  if (!isAdmin(req) && g.user_id !== req.user.id) return 'Gideri yalnızca kendinize ekleyebilirsiniz';
  return null;
}
function giderVerisi(req, b) {
  const uid = b.user_id === null || b.user_id === '' || b.user_id === 'ortak' ? null : Number(b.user_id);
  return {
    tarih: b.tarih, kategori: b.kategori, aciklama: b.aciklama || null,
    tutar: Math.round((Number(b.tutar) || 0) * 100) / 100,
    user_id: isAdmin(req) ? (b.user_id === undefined ? null : uid) : req.user.id,
  };
}

app.get('/api/giderler', h(async (req, res) => {
  const { baslangic, bitis } = req.query;
  if (!DATE_RE.test(baslangic || '') || !DATE_RE.test(bitis || '')) return res.status(400).json({ hata: 'Tarih aralığı gerekli' });
  const params = [baslangic, bitis];
  const where = 'WHERE g.tarih BETWEEN $1 AND $2' + giderFiltre(req, params);
  res.json(await db.all(`${GIDER_SELECT} ${where} ORDER BY g.tarih DESC, g.id DESC`, params));
}));

app.post('/api/giderler', h(async (req, res) => {
  const g = giderVerisi(req, req.body || {});
  const err = await validateGider(req, g);
  if (err) return res.status(400).json({ hata: err });
  const { id } = await db.get(`INSERT INTO giderler (tarih, kategori, aciklama, tutar, user_id, olusturan_id)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [g.tarih, g.kategori, g.aciklama, g.tutar, g.user_id, req.user.id]);
  res.json(await db.get(`${GIDER_SELECT} WHERE g.id = $1`, [id]));
}));

async function erisilebilirGider(req, id) {
  const g = await db.get('SELECT * FROM giderler WHERE id = $1', [id]);
  return g && (isAdmin(req) || g.user_id === req.user.id) ? g : null;
}

app.put('/api/giderler/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  if (!await erisilebilirGider(req, id)) return res.status(404).json({ hata: 'Gider bulunamadı' });
  const g = giderVerisi(req, req.body || {});
  const err = await validateGider(req, g);
  if (err) return res.status(400).json({ hata: err });
  await db.run('UPDATE giderler SET tarih = $1, kategori = $2, aciklama = $3, tutar = $4, user_id = $5 WHERE id = $6',
    [g.tarih, g.kategori, g.aciklama, g.tutar, g.user_id, id]);
  res.json(await db.get(`${GIDER_SELECT} WHERE g.id = $1`, [id]));
}));

app.delete('/api/giderler/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  if (!await erisilebilirGider(req, id)) return res.status(404).json({ hata: 'Gider bulunamadı' });
  await db.run('DELETE FROM giderler WHERE id = $1', [id]);
  res.json({ ok: true });
}));

// ---------- Gelir-gider raporu ----------
app.get('/api/gelir-gider', h(async (req, res) => {
  const { baslangic, bitis } = req.query;
  const grup = req.query.grup === 'ay' ? 'ay' : 'hafta';
  if (!DATE_RE.test(baslangic || '') || !DATE_RE.test(bitis || '')) return res.status(400).json({ hata: 'Tarih aralığı gerekli' });
  const donem = (col) => grup === 'ay' ? `substr(${col}, 1, 7)` : `to_char(date_trunc('week', ${col}::date), 'YYYY-MM-DD')`;

  // Kullanıcı filtresi (ortak filtre seçiliyse ortak gelir olmadığından boş kalır)
  const seansFiltre = (params) => {
    if (!isAdmin(req)) { params.push(req.user.id); return ` AND s.user_id = $${params.length}`; }
    if (req.query.user_id === 'ortak') return ' AND false';
    if (req.query.user_id) { params.push(Number(req.query.user_id)); return ` AND s.user_id = $${params.length}`; }
    return '';
  };

  // Gelir (tahsilat esası): ödemesi alınan seanslar, ödeme tarihine göre
  const sp = [baslangic, bitis];
  const gelirler = await db.all(`
    SELECT ${donem('s.odeme_tarihi')} AS donem,
      SUM(s.ucret) AS gelir,
      SUM(s.ucret * u.komisyon_orani / 100) AS komisyon
    FROM seanslar s JOIN users u ON u.id = s.user_id
    WHERE s.odendi = 1 AND s.durum != 'iptal' AND s.odeme_tarihi BETWEEN $1 AND $2 ${seansFiltre(sp)}
    GROUP BY 1`, sp);

  // Bilgi amaçlı: seansı yapılmış/planlanmış ama henüz tahsil edilmemiş tutar (seans tarihine göre)
  const ap = [baslangic, bitis];
  const alacaklar = await db.all(`
    SELECT ${donem('s.tarih')} AS donem, SUM(s.ucret) AS alacak
    FROM seanslar s
    WHERE s.odendi = 0 AND s.durum != 'iptal' AND s.tarih BETWEEN $1 AND $2 ${seansFiltre(ap)}
    GROUP BY 1`, ap);

  const gp = [baslangic, bitis];
  const gWhere = 'WHERE g.tarih BETWEEN $1 AND $2' + giderFiltre(req, gp);
  const giderler = await db.all(`
    SELECT ${donem('g.tarih')} AS donem, g.kategori, SUM(g.tutar) AS tutar
    FROM giderler g ${gWhere} GROUP BY 1, 2`, gp);

  const donemler = {};
  const satir = (d) => (donemler[d] ||= { donem: d, gelir: 0, alacak: 0, komisyon: 0, vergi: 0, diger_gider: 0, kategoriler: {} });
  for (const g of gelirler) Object.assign(satir(g.donem), { gelir: g.gelir, komisyon: Math.round(g.komisyon * 100) / 100 });
  for (const a of alacaklar) satir(a.donem).alacak = a.alacak;
  for (const g of giderler) {
    const s = satir(g.donem);
    s.kategoriler[g.kategori] = g.tutar;
    if (VERGI_KATEGORILERI.includes(g.kategori)) s.vergi += g.tutar; else s.diger_gider += g.tutar;
  }
  const satirlar = Object.values(donemler).sort((a, b) => b.donem.localeCompare(a.donem));
  for (const s of satirlar) {
    s.toplam_gider = s.vergi + s.diger_gider + s.komisyon;
    s.net = s.gelir - s.toplam_gider;
  }
  res.json({ grup, satirlar });
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ hata: 'Sunucu hatası' });
});

const PORT = process.env.PORT || 3000;
db.init().then(() => {
  app.listen(PORT, () => console.log(`Muhasebe uygulaması http://localhost:${PORT} adresinde çalışıyor`));
}).catch((err) => {
  console.error('Veritabanına bağlanılamadı:', err);
  process.exit(1);
});
