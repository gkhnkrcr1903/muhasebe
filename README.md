# Seans Muhasebe

Defne Çocuk ve Aile ile Elda Psikoloji için danışan seanslarının ve ücretlerinin takip edildiği web uygulaması.

## Özellikler
- 3 kullanıcı: `gokhan` (admin), `defne` (Defne Çocuk ve Aile), `elda` (Elda Psikoloji)
- **Haftalık plan:** seansı kimin alacağı, tarih/saat, ücret, durum (planlandı / tamamlandı / iptal), ödeme bilgisi
- **Seans değişikliği:** tarih, saat, seansı alan kişi vb. değiştirilebilir; her değişiklik geçmişe kaydedilir
- **Ücret raporu:** haftalık veya aylık; toplam, tahsil edilen ve bekleyen tutarlar; CSV dışa aktarma
- **Danışan yönetimi:** varsayılan seans ücreti, aktif/pasif
- Yetki: admin tüm seansları görür ve herkese atayabilir; diğer kullanıcılar yalnızca kendi seanslarını görür/düzenler

## Çalıştırma
Node.js 22.13+ gerekir. Veriler PostgreSQL'de tutulur; `DATABASE_URL` verilmezse yerelde gömülü PostgreSQL (PGlite, `data/pglite`) kullanılır, ek kurulum gerekmez.

```bash
npm install
npm start
```

Uygulama http://localhost:3000 adresinde açılır.

## Ortam değişkenleri
| Değişken | Açıklama |
|---|---|
| `PORT` | Sunucu portu (varsayılan 3000) |
| `SESSION_SECRET` | Oturum imzalama anahtarı — yayında mutlaka uzun rastgele bir değer verin |
| `DATABASE_URL` | PostgreSQL bağlantı adresi (ör. Neon). Yoksa yerel PGlite kullanılır |
| `ADMIN_PASSWORD`, `DEFNE_PASSWORD`, `ELDA_PASSWORD` | İlk kurulumda kullanıcı şifreleri |

Şifre değişkenleri verilmezse ilk kurulumda şifre `degistir123` olur; ilk girişte **Ayarlar** sekmesinden değiştirin.

## Yayınlama
Ücretsiz kurulum: Render (free web servisi) + Neon (ücretsiz PostgreSQL).

1. https://neon.tech üzerinde proje oluşturun, **Connection string**'i kopyalayın.
2. Render'da **New → Blueprint** ile bu repoyu seçin (`render.yaml` okunur).
3. `DATABASE_URL` alanına Neon adresini, şifre alanlarına kullanıcı şifrelerini girin.

Not: Render free planında servis 15 dk istek gelmezse uyur. Bunu önlemek için `.github/workflows/uyanik-tut.yml` 10 dakikada bir `/saglik` adresine istek atar (adres farklıysa repo ayarlarında `APP_URL` değişkeni tanımlayın). Veriler Neon'da kalıcıdır.
