# Seans Muhasebe — Uygulama Bilgileri

Bu dosya uygulamanın nasıl çalıştığını, nerede ne tutulduğunu ve bakım için gereken her şeyi anlatır.
**Şifreler bu dosyada değildir** (repo herkese açık). Şifreler yalnızca bilgisayardaki `SIFRELER.md` dosyasındadır; bu dosya `.gitignore` ile GitHub'a gönderilmez.

---

## 1. Genel bakış

| | |
|---|---|
| Canlı adres | https://seans-muhasebe.onrender.com |
| Kaynak kod | https://github.com/gkhnkrcr1903/muhasebe (dal: `main`) |
| Sunucu (hosting) | Render — ücretsiz web servisi, bölge Frankfurt |
| Veritabanı | Neon — ücretsiz PostgreSQL, proje `noisy-haze-24591882`, dal `production` |
| Yerel klasör | `C:\Claude_projects\muhasebe` |
| Teknoloji | Node.js 22+, Express 4, PostgreSQL (`pg`), yerelde PGlite; arayüz sade HTML/CSS/JS (derleme yok) |

## 2. Kullanıcılar ve yetkiler

| Kullanıcı adı | Görünen ad | Rol |
|---|---|---|
| `gokhan` | Gökhan | Yönetici (admin) |
| `defne` | Defne Çocuk ve Aile | Kullanıcı |
| `elda` | Elda Psikoloji | Kullanıcı |

- **Admin:** tüm seansları, giderleri (ortak dahil) ve raporları görür; seansı herkese atayabilir; şifre sıfırlar; komisyon oranlarını ve izinleri belirler.
- **Kullanıcı:** yalnızca kendi seanslarını ve giderlerini görür/düzenler. Danışan listesi ortaktır.
- **Şifre değiştirme:** Varsayılan olarak **kapalı** — yalnızca admin şifre belirleyebilir (Ayarlar → Kullanıcı şifresi sıfırla). Admin, Ayarlar → *Kullanıcı izinleri* → "Kullanıcılar kendi şifresini değiştirebilsin" kutusuyla bunu açıp kapatabilir. Ayar veritabanındaki `ayarlar` tablosunda `sifre_degistirme_acik` anahtarıyla tutulur.
- **İlk şifreler:** Kullanıcılar veritabanında yoksa ilk açılışta `ADMIN_PASSWORD`, `DEFNE_PASSWORD`, `ELDA_PASSWORD` ortam değişkenleriyle oluşturulur (yoksa `degistir123`). Kullanıcı bir kez oluştuktan sonra bu değişkenleri değiştirmek şifreyi **değiştirmez**; şifre uygulama içinden sıfırlanmalıdır.
- Şifreler veritabanında düz metin değil, `scrypt` ile tuzlanmış özet (hash) olarak saklanır. Unutulan şifre geri okunamaz, yalnızca sıfırlanabilir.

## 3. Çalıştırma

### Yerelde, test veritabanıyla (önerilen — canlı veriye dokunmaz)
```bash
node server.js
```
`DATABASE_URL` olmadığı için `data/pglite` klasöründe gömülü bir PostgreSQL açılır. Adres: http://localhost:3000. Test verisini sıfırlamak için `data` klasörünü silin.

### Yerelde, canlı Neon veritabanıyla (dikkat: gerçek veri)
```bash
npm start
```
`npm start`, `.env.local` dosyasını okur; içindeki `DATABASE_URL` canlı Neon veritabanıdır.

### Derleme
Derleme adımı yoktur. `public/` klasöründeki dosyalar olduğu gibi sunulur. Bağımlılıkları kurmak için:
```bash
npm install
```

### Yayına alma
`main` dalına her `git push` sonrası Render otomatik olarak yeniden kurar ve yayınlar (1–3 dk). Durum: Render paneli → `seans-muhasebe` → Events / Logs.

## 4. Ne nerede tutuluyor

### Dosyalar
| Dosya / klasör | İçerik |
|---|---|
| `server.js` | Sunucu ve tüm API uçları (giriş, seans, danışan, gider, rapor, ayarlar) |
| `db.js` | Veritabanı bağlantısı, tablo oluşturma/güncelleme (migration), ilk kullanıcılar |
| `public/index.html` | Arayüz iskeleti (sekmeler, formlar) |
| `public/app.js` | Arayüz mantığı (API çağrıları, hesaplamalar, tablolar) |
| `public/style.css` | Tasarım (masaüstü, tablet, telefon) |
| `render.yaml` | Render yapılandırması (plan, ortam değişkenleri) |
| `neon.ts` | Neon proje yapılandırması |
| `.github/workflows/uyanik-tut.yml` | Render'ın uyumaması için 10 dk'da bir `/saglik` ping'i |
| `.claude/launch.json` | Geliştirme ortamı çalıştırma ayarları (`muhasebe-yerel` = test veritabanı) |
| `.env.local` | **Gizli.** Neon bağlantı adresi. GitHub'a gönderilmez |
| `SIFRELER.md` | **Gizli.** Kullanıcı şifreleri notu. GitHub'a gönderilmez |
| `data/` | Yerel test veritabanı (PGlite). GitHub'a gönderilmez |

### Veritabanı tabloları (Neon / PostgreSQL)
| Tablo | İçerik |
|---|---|
| `users` | Kullanıcılar, şifre özeti, rol, komisyon oranı (%) |
| `danisanlar` | Danışanlar: ad, telefon, varsayılan ücret, not, aktif/pasif |
| `seanslar` | Seanslar: danışan, seansı alan, tarih, saat, ücret, durum, ödendi, ödeme tarihi, not |
| `seans_gecmisi` | Her seans değişikliğinin kaydı (kim, ne zaman, ne değişti) |
| `giderler` | Giderler: tarih, kategori, tutar, açıklama, kime ait (boş = ortak) |
| `ayarlar` | Uygulama ayarları (ör. `sifre_degistirme_acik`) |

Tablolar uygulama her açıldığında yoksa oluşturulur; yeni sütunlar da otomatik eklenir. Elle SQL çalıştırmaya gerek yoktur.

### Ortam değişkenleri (Render → Environment)
| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | Neon bağlantı adresi |
| `SESSION_SECRET` | Oturum çerezlerini imzalama anahtarı (Render otomatik üretti). Değişirse herkesin oturumu kapanır |
| `ADMIN_PASSWORD`, `DEFNE_PASSWORD`, `ELDA_PASSWORD` | Yalnızca ilk kurulumda kullanılan şifreler |
| `ADMIN_SIFRE_SIFIRLA` | Normalde tanımsız. `1` yapılırsa açılışta admin şifresi `ADMIN_PASSWORD`'e sıfırlanır |
| `NODE_VERSION` | Render'daki Node.js sürümü |

## 5. Hesaplama kuralları

- **Gelir (Gelir-Gider raporu):** Tahsilat esaslıdır. Yalnızca "Ödeme alındı" işaretli seansların ücreti, **ödeme tarihine** göre sayılır. İptal seanslar sayılmaz.
- **Bekleyen alacak:** Ödenmemiş, iptal olmayan seansların toplamı (seans tarihine göre). Bilgi amaçlıdır, nete eklenmez.
- **Vergi giderleri:** Stopaj, KDV, gelir vergisi, geçici vergi, damga vergisi kategorileri.
- **Komisyon:** Tahsil edilen tutar × kullanıcının komisyon oranı. Gider olarak düşülür.
- **Net:** Gelir − (vergi giderleri + diğer giderler + komisyon).
- **Seans raporu:** Seans tarihine göre gruplanır; toplam ücret, tahsil edilen, bekleyen, komisyon ve net (tahsilat üzerinden).
- **Hafta:** Pazartesi başlar, pazar biter. Saat dilimi: Europe/Istanbul.
- Gider formunda matrah × oran ile tutar hesaplanabilir (varsayılan oranlar: stopaj %20, KDV %20, damga binde 9,48).

## 6. Hesaplar ve paneller

| Servis | Adres | Not |
|---|---|---|
| Render | https://dashboard.render.com | Servis: `seans-muhasebe`. Loglar, ortam değişkenleri, yeniden başlatma |
| Neon | https://console.neon.tech | Proje: `noisy-haze-24591882`. SQL Editor ile veriye bakılabilir; yedek/geri yükleme (restore) buradan |
| GitHub | https://github.com/gkhnkrcr1903/muhasebe | Actions sekmesinde "Uyanık tut" görevi |

## 7. Bakım ve sorun giderme

- **Site geç açılıyor:** Render uyumuş olabilir. GitHub → Actions → "Uyanık tut" görevinin çalıştığını kontrol edin. Daha güvenilir olması için UptimeRobot gibi bir servisle `https://seans-muhasebe.onrender.com/saglik` adresini 5 dk'da bir kontrol ettirin.
- **Şifre unutuldu:** Admin, Ayarlar → Kullanıcı şifresi sıfırla. Admin şifresi unutulursa: Render → Environment'ta `ADMIN_PASSWORD`'ü yeni şifre yapın ve `ADMIN_SIFRE_SIFIRLA` = `1` ekleyin; servis yeniden başlayınca admin şifresi sıfırlanır. Ardından `ADMIN_SIFRE_SIFIRLA`'yı **silin** (yoksa her yeniden başlatmada sıfırlanır).
- **Hata mesajı:** Render → Logs. Sunucu hataları burada görünür.
- **Yedek:** Neon ücretsiz planı belirli bir süre geriye dönük geri yükleme (point-in-time restore) sunar. Ayrıca raporlardan CSV indirilebilir.
- **Neon bağlantı adresi değişirse:** Neon → Connect'ten yeni adresi alıp Render'da `DATABASE_URL`'i ve yerelde `.env.local`'ı güncelleyin (`neon env pull` da kullanılabilir).
