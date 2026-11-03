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
Node.js 22.13+ gerekir (yerleşik `node:sqlite` kullanılır).

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
| `DB_PATH` | SQLite dosya yolu (varsayılan `data/muhasebe.db`) |
| `ADMIN_PASSWORD`, `DEFNE_PASSWORD`, `ELDA_PASSWORD` | İlk kurulumda kullanıcı şifreleri |

Şifre değişkenleri verilmezse ilk kurulumda şifre `degistir123` olur; ilk girişte **Ayarlar** sekmesinden değiştirin.

## Yayınlama
Kalıcı disk sunan bir platform gerekir (Render, Railway, Fly.io, VPS vb.). `DB_PATH`'i kalıcı diske yönlendirin ve `SESSION_SECRET` tanımlayın.
