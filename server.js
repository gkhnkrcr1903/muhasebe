const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { db, hashPassword, verifyPassword } = require('./db');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('UYARI: SESSION_SECRET tanımlı değil, yeniden başlatınca oturumlar düşer.');
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

function auth(req, res, next) {
  const userId = readToken(getCookie(req, 'oturum'));
  const user = userId && db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(401).json({ hata: 'Giriş gerekli' });
  req.user = user;
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ hata: 'Bu işlem için yetkiniz yok' });
  next();
}
const isAdmin = (req) => req.user.role === 'admin';

// ---------- Giriş ----------
app.post('/api/giris', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').toLowerCase().trim());
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return res.status(401).json({ hata: 'Kullanıcı adı veya şifre hatalı' });
  }
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `oturum=${makeToken(user.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL_MS / 1000}${secure}`);
  res.json({ id: user.id, username: user.username, display_name: user.display_name, role: user.role });
});

app.post('/api/cikis', (req, res) => {
  res.setHeader('Set-Cookie', 'oturum=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.use('/api', auth);

app.get('/api/ben', (req, res) => res.json(req.user));

app.post('/api/sifre', (req, res) => {
  const { eski, yeni } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(eski || ''), user.password_hash)) return res.status(400).json({ hata: 'Mevcut şifre hatalı' });
  if (!yeni || String(yeni).length < 6) return res.status(400).json({ hata: 'Yeni şifre en az 6 karakter olmalı' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(yeni)), req.user.id);
  res.json({ ok: true });
});

// ---------- Kullanıcılar ----------
app.get('/api/kullanicilar', (req, res) => {
  res.json(db.prepare('SELECT id, username, display_name, role FROM users ORDER BY id').all());
});

app.post('/api/kullanicilar/:id/sifre', adminOnly, (req, res) => {
  const { yeni } = req.body || {};
  if (!yeni || String(yeni).length < 6) return res.status(400).json({ hata: 'Şifre en az 6 karakter olmalı' });
  const r = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(yeni)), Number(req.params.id));
  if (!r.changes) return res.status(404).json({ hata: 'Kullanıcı bulunamadı' });
  res.json({ ok: true });
});

// ---------- Danışanlar ----------
app.get('/api/danisanlar', (req, res) => {
  const tumu = req.query.tumu === '1';
  res.json(db.prepare(`SELECT * FROM danisanlar ${tumu ? '' : 'WHERE aktif = 1'} ORDER BY ad COLLATE NOCASE`).all());
});

app.post('/api/danisanlar', (req, res) => {
  const { ad, telefon, varsayilan_ucret, notlar } = req.body || {};
  if (!ad || !String(ad).trim()) return res.status(400).json({ hata: 'Danışan adı gerekli' });
  const r = db.prepare('INSERT INTO danisanlar (ad, telefon, varsayilan_ucret, notlar) VALUES (?, ?, ?, ?)')
    .run(String(ad).trim(), telefon || null, Number(varsayilan_ucret) || 0, notlar || null);
  res.json(db.prepare('SELECT * FROM danisanlar WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/danisanlar/:id', (req, res) => {
  const { ad, telefon, varsayilan_ucret, notlar, aktif } = req.body || {};
  if (!ad || !String(ad).trim()) return res.status(400).json({ hata: 'Danışan adı gerekli' });
  db.prepare('UPDATE danisanlar SET ad = ?, telefon = ?, varsayilan_ucret = ?, notlar = ?, aktif = ? WHERE id = ?')
    .run(String(ad).trim(), telefon || null, Number(varsayilan_ucret) || 0, notlar || null, aktif === false || aktif === 0 ? 0 : 1, Number(req.params.id));
  res.json(db.prepare('SELECT * FROM danisanlar WHERE id = ?').get(Number(req.params.id)));
});

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
  return db.prepare(`${SEANS_SELECT} WHERE s.id = ?`).get(id);
}
function canAccess(req, seans) {
  return isAdmin(req) || seans.user_id === req.user.id;
}
function logChange(seansId, userId, aciklama) {
  db.prepare('INSERT INTO seans_gecmisi (seans_id, degistiren_id, aciklama) VALUES (?, ?, ?)').run(seansId, userId, aciklama);
}

function validateSeans(req, body, existing) {
  const s = { ...existing, ...body };
  if (!DATE_RE.test(s.tarih || '')) return 'Geçerli bir tarih girin';
  if (s.saat && !TIME_RE.test(s.saat)) return 'Saat SS:DD biçiminde olmalı';
  if (!DURUMLAR.includes(s.durum || 'planlandi')) return 'Geçersiz durum';
  if (!db.prepare('SELECT 1 FROM danisanlar WHERE id = ?').get(Number(s.danisan_id))) return 'Danışan bulunamadı';
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND role = ?').get(Number(s.user_id), 'user')) return 'Seansı alacak kişi geçersiz';
  if (!isAdmin(req) && Number(s.user_id) !== req.user.id) return 'Seansı yalnızca kendinize atayabilirsiniz';
  return null;
}

app.get('/api/seanslar', (req, res) => {
  const { baslangic, bitis, user_id } = req.query;
  if (!DATE_RE.test(baslangic || '') || !DATE_RE.test(bitis || '')) return res.status(400).json({ hata: 'Tarih aralığı gerekli' });
  const params = [baslangic, bitis];
  let where = 'WHERE s.tarih BETWEEN ? AND ?';
  if (!isAdmin(req)) { where += ' AND s.user_id = ?'; params.push(req.user.id); }
  else if (user_id) { where += ' AND s.user_id = ?'; params.push(Number(user_id)); }
  res.json(db.prepare(`${SEANS_SELECT} ${where} ORDER BY s.tarih, s.saat`).all(...params));
});

app.post('/api/seanslar', (req, res) => {
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
  const err = validateSeans(req, data, {});
  if (err) return res.status(400).json({ hata: err });
  const r = db.prepare(`INSERT INTO seanslar (danisan_id, user_id, tarih, saat, ucret, durum, odendi, notlar)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(data.danisan_id, data.user_id, data.tarih, data.saat, data.ucret, data.durum, data.odendi, data.notlar);
  logChange(r.lastInsertRowid, req.user.id, 'Seans oluşturuldu');
  res.json(getSeans(r.lastInsertRowid));
});

app.put('/api/seanslar/:id', (req, res) => {
  const id = Number(req.params.id);
  const old = getSeans(id);
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
  const err = validateSeans(req, data, {});
  if (err) return res.status(400).json({ hata: err });
  db.prepare(`UPDATE seanslar SET danisan_id = ?, user_id = ?, tarih = ?, saat = ?, ucret = ?, durum = ?, odendi = ?, notlar = ? WHERE id = ?`)
    .run(data.danisan_id, data.user_id, data.tarih, data.saat, data.ucret, data.durum, data.odendi, data.notlar, id);

  const fresh = getSeans(id);
  const changes = [];
  if (old.tarih !== fresh.tarih || old.saat !== fresh.saat) changes.push(`Zaman: ${old.tarih} ${old.saat || ''} → ${fresh.tarih} ${fresh.saat || ''}`);
  if (old.user_id !== fresh.user_id) changes.push(`Seansı alan: ${old.kullanici_ad} → ${fresh.kullanici_ad}`);
  if (old.danisan_id !== fresh.danisan_id) changes.push(`Danışan: ${old.danisan_ad} → ${fresh.danisan_ad}`);
  if (old.ucret !== fresh.ucret) changes.push(`Ücret: ${old.ucret} → ${fresh.ucret}`);
  if (old.durum !== fresh.durum) changes.push(`Durum: ${DURUM_ETIKET[old.durum]} → ${DURUM_ETIKET[fresh.durum]}`);
  if (old.odendi !== fresh.odendi) changes.push(fresh.odendi ? 'Ödeme alındı' : 'Ödeme geri alındı');
  if (changes.length) logChange(id, req.user.id, changes.join('; '));
  res.json(fresh);
});

app.delete('/api/seanslar/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = getSeans(id);
  if (!s || !canAccess(req, s)) return res.status(404).json({ hata: 'Seans bulunamadı' });
  db.prepare('DELETE FROM seanslar WHERE id = ?').run(id);
  logChange(id, req.user.id, `Seans silindi (${s.danisan_ad}, ${s.tarih})`);
  res.json({ ok: true });
});

app.get('/api/seanslar/:id/gecmis', (req, res) => {
  const s = getSeans(Number(req.params.id));
  if (!s || !canAccess(req, s)) return res.status(404).json({ hata: 'Seans bulunamadı' });
  res.json(db.prepare(`SELECT g.*, u.display_name AS degistiren FROM seans_gecmisi g
    JOIN users u ON u.id = g.degistiren_id WHERE g.seans_id = ? ORDER BY g.id DESC`).all(s.id));
});

// ---------- Raporlar ----------
// grup: 'hafta' (pazartesi başlangıçlı) | 'ay'
app.get('/api/rapor', (req, res) => {
  const { baslangic, bitis } = req.query;
  const grup = req.query.grup === 'ay' ? 'ay' : 'hafta';
  if (!DATE_RE.test(baslangic || '') || !DATE_RE.test(bitis || '')) return res.status(400).json({ hata: 'Tarih aralığı gerekli' });
  const donemExpr = grup === 'ay'
    ? "substr(s.tarih, 1, 7)"
    : "date(s.tarih, '-' || ((CAST(strftime('%w', s.tarih) AS INTEGER) + 6) % 7) || ' days')";
  const params = [baslangic, bitis];
  let where = "WHERE s.tarih BETWEEN ? AND ? AND s.durum != 'iptal'";
  if (!isAdmin(req)) { where += ' AND s.user_id = ?'; params.push(req.user.id); }
  const rows = db.prepare(`
    SELECT ${donemExpr} AS donem, s.user_id, u.display_name AS kullanici_ad,
      COUNT(*) AS seans_sayisi,
      SUM(CASE WHEN s.durum = 'tamamlandi' THEN 1 ELSE 0 END) AS tamamlanan,
      SUM(s.ucret) AS toplam_ucret,
      SUM(CASE WHEN s.odendi = 1 THEN s.ucret ELSE 0 END) AS tahsil_edilen,
      SUM(CASE WHEN s.odendi = 0 THEN s.ucret ELSE 0 END) AS bekleyen
    FROM seanslar s JOIN users u ON u.id = s.user_id
    ${where}
    GROUP BY donem, s.user_id ORDER BY donem DESC, u.id`).all(...params);
  res.json({ grup, satirlar: rows });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Muhasebe uygulaması http://localhost:${PORT} adresinde çalışıyor`));
