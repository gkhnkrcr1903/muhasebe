const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = { ben: null, kullanicilar: [], danisanlar: [], haftaBas: pazartesi(new Date()), seanslar: [], rapor: [] };
const GUNLER = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const DURUM = { planlandi: 'Planlandı', tamamlandi: 'Tamamlandı', iptal: 'İptal' };
const para = (n) => (Number(n) || 0).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Tarih yardımcıları ----------
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function pazartesi(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function gunEkle(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function trTarih(s, opt = { day: 'numeric', month: 'long', year: 'numeric' }) {
  const [y, m, g] = s.split('-').map(Number);
  return new Date(y, m - 1, g).toLocaleDateString('tr-TR', opt);
}

// ---------- API ----------
async function api(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/giris') { girisGoster(); throw new Error('Oturum sona erdi'); }
  if (!res.ok) throw new Error(data.hata || 'Bir hata oluştu');
  return data;
}
function bildir(msg) {
  const el = $('#bildirim');
  el.textContent = msg; el.classList.add('goster');
  clearTimeout(bildir.t); bildir.t = setTimeout(() => el.classList.remove('goster'), 2200);
}

// ---------- Giriş ----------
function girisGoster() {
  $('#uygulama').classList.add('hidden');
  $('#giris-ekrani').classList.remove('hidden');
}
$('#giris-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/api/giris', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
    e.target.reset(); $('#giris-hata').textContent = '';
    await baslat();
  } catch (err) { $('#giris-hata').textContent = err.message; }
});
$('#cikis').addEventListener('click', async () => { await api('/api/cikis', { method: 'POST' }); girisGoster(); });

async function baslat() {
  try { state.ben = await api('/api/ben'); } catch { return girisGoster(); }
  $('#giris-ekrani').classList.add('hidden');
  $('#uygulama').classList.remove('hidden');
  $('#ben-ad').textContent = state.ben.display_name;
  const admin = state.ben.role === 'admin';
  $$('.sadece-admin').forEach((el) => el.classList.toggle('hidden', !admin));

  state.kullanicilar = await api('/api/kullanicilar');
  const terapistler = state.kullanicilar.filter((u) => u.role === 'user');
  $('#plan-filtre').innerHTML = '<option value="">Herkes</option>' + terapistler.map((u) => `<option value="${u.id}">${esc(u.display_name)}</option>`).join('');
  $('#sifirla-kullanici').innerHTML = state.kullanicilar.map((u) => `<option value="${u.id}">${esc(u.display_name)} (${esc(u.username)})</option>`).join('');

  const sahipSecenek = '<option value="ortak">Ortak</option>' + terapistler.map((u) => `<option value="${u.id}">${esc(u.display_name)}</option>`).join('');
  $('#gider-filtre').innerHTML = '<option value="">Herkes</option>' + sahipSecenek;
  $('#gg-filtre').innerHTML = '<option value="">Herkes</option>' + sahipSecenek;
  giderForm.user_id.innerHTML = sahipSecenek;
  komisyonAlanlariCiz(terapistler);

  const k = await api('/api/gider-kategorileri');
  state.kategoriler = k.kategoriler; state.vergiKategorileri = k.vergi;
  giderForm.kategori.innerHTML = Object.entries(k.kategoriler).map(([v, ad]) => `<option value="${v}">${esc(ad)}</option>`).join('');

  const bugun = new Date();
  const ayBas = iso(new Date(bugun.getFullYear(), bugun.getMonth(), 1));
  const aySon = iso(new Date(bugun.getFullYear(), bugun.getMonth() + 1, 0));
  $('#rapor-bas').value = ayBas; $('#rapor-bit').value = aySon;
  $('#gider-bas').value = ayBas; $('#gider-bit').value = aySon;
  $('#gg-bas').value = iso(new Date(bugun.getFullYear(), 0, 1)); $('#gg-bit').value = iso(new Date(bugun.getFullYear(), 11, 31));

  await danisanlariYukle();
  await haftaYukle();
}

// ---------- Sekmeler ----------
$$('header nav button').forEach((b) => b.addEventListener('click', () => {
  $$('header nav button').forEach((x) => x.classList.toggle('aktif', x === b));
  $$('.sekme').forEach((s) => s.classList.add('hidden'));
  $(`#sekme-${b.dataset.sekme}`).classList.remove('hidden');
  if (b.dataset.sekme === 'rapor') raporGetir();
  if (b.dataset.sekme === 'danisanlar') danisanlariYukle();
  if (b.dataset.sekme === 'giderler') giderGetir();
  if (b.dataset.sekme === 'gelirgider') ggGetir();
}));
$$('[data-kapat]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// ---------- Haftalık plan ----------
function renkSinifi(userId) {
  const idx = state.kullanicilar.filter((u) => u.role === 'user').findIndex((u) => u.id === userId);
  return idx === 1 ? 'u3' : '';
}

async function haftaYukle() {
  const bas = iso(state.haftaBas), bit = iso(gunEkle(state.haftaBas, 6));
  const filtre = $('#plan-filtre').value;
  state.seanslar = await api(`/api/seanslar?baslangic=${bas}&bitis=${bit}${filtre ? `&user_id=${filtre}` : ''}`);
  $('#hafta-baslik').textContent = `${trTarih(bas, { day: 'numeric', month: 'long' })} – ${trTarih(bit)}`;
  haftaCiz();
}

function haftaCiz() {
  const bugun = iso(new Date());
  let html = '';
  for (let i = 0; i < 7; i++) {
    const gun = iso(gunEkle(state.haftaBas, i));
    const liste = state.seanslar.filter((s) => s.tarih === gun);
    html += `<div class="gun ${gun === bugun ? 'bugun' : ''}">
      <div class="gun-bas"><span><b>${GUNLER[i]}</b> ${trTarih(gun, { day: 'numeric', month: 'short' })}</span>
        <button class="ikincil" data-yeni="${gun}" title="Bu güne seans ekle">+</button></div>
      <div class="gun-icerik">${liste.map(seansKarti).join('')}</div></div>`;
  }
  $('#hafta-grid').innerHTML = html;
  $$('[data-yeni]').forEach((b) => b.addEventListener('click', () => seansFormAc(null, b.dataset.yeni)));
  $$('.seans').forEach((el) => el.addEventListener('click', () => seansFormAc(state.seanslar.find((s) => s.id === Number(el.dataset.id)))));

  // Haftalık özet (kişi bazında)
  const gecerli = state.seanslar.filter((s) => s.durum !== 'iptal');
  const kisiler = {};
  for (const s of gecerli) {
    const k = (kisiler[s.kullanici_ad] ||= { adet: 0, toplam: 0, tahsil: 0 });
    k.adet++; k.toplam += s.ucret; if (s.odendi) k.tahsil += s.ucret;
  }
  const toplam = gecerli.reduce((a, s) => a + s.ucret, 0);
  const tahsil = gecerli.filter((s) => s.odendi).reduce((a, s) => a + s.ucret, 0);
  $('#hafta-ozet').innerHTML =
    `<div class="kutu"><small>Bu hafta toplam</small><b>${para(toplam)}</b><small>${gecerli.length} seans · tahsil ${para(tahsil)}</small></div>` +
    Object.entries(kisiler).map(([ad, k]) =>
      `<div class="kutu"><small>${esc(ad)}</small><b>${para(k.toplam)}</b><small>${k.adet} seans · bekleyen ${para(k.toplam - k.tahsil)}</small></div>`).join('');
}

function seansKarti(s) {
  return `<div class="seans ${renkSinifi(s.user_id)} ${s.durum === 'iptal' ? 'iptal' : ''}" data-id="${s.id}">
    <div class="ust"><b>${esc(s.saat || '--:--')} ${esc(s.danisan_ad)}</b></div>
    <div class="alt"><span>${esc(s.kullanici_ad)}</span><span>${para(s.ucret)}</span></div>
    <div class="alt"><span>${DURUM[s.durum]}</span>
      <span class="rozet ${s.odendi ? 'odendi' : 'bekliyor'}">${s.odendi ? 'Ödendi' : 'Bekliyor'}</span></div>
  </div>`;
}

$('#hafta-onceki').addEventListener('click', () => { state.haftaBas = gunEkle(state.haftaBas, -7); haftaYukle(); });
$('#hafta-sonraki').addEventListener('click', () => { state.haftaBas = gunEkle(state.haftaBas, 7); haftaYukle(); });
$('#hafta-bugun').addEventListener('click', () => { state.haftaBas = pazartesi(new Date()); haftaYukle(); });
$('#plan-filtre').addEventListener('change', haftaYukle);
$('#seans-ekle').addEventListener('click', () => seansFormAc(null, iso(new Date())));

// ---------- Seans formu ----------
const seansForm = $('#seans-form');
async function seansFormAc(seans, tarih) {
  const f = seansForm;
  const admin = state.ben.role === 'admin';
  const aktifDanisan = state.danisanlar.filter((d) => d.aktif || (seans && d.id === seans.danisan_id));
  f.danisan_id.innerHTML = '<option value="">Seçin…</option>' + aktifDanisan.map((d) => `<option value="${d.id}">${esc(d.ad)}</option>`).join('');
  const terapistler = state.kullanicilar.filter((u) => u.role === 'user' && (admin || u.id === state.ben.id));
  f.user_id.innerHTML = terapistler.map((u) => `<option value="${u.id}">${esc(u.display_name)}</option>`).join('');

  f.id.value = seans?.id || '';
  f.danisan_id.value = seans?.danisan_id || '';
  f.user_id.value = seans?.user_id || terapistler[0]?.id || '';
  f.tarih.value = seans?.tarih || tarih;
  f.saat.value = seans?.saat || '';
  f.ucret.value = seans?.ucret ?? '';
  f.durum.value = seans?.durum || 'planlandi';
  f.odendi.checked = !!seans?.odendi;
  f.notlar.value = seans?.notlar || '';
  f.tekrar.value = '0';
  $('#tekrar-alan').classList.toggle('hidden', !!seans);
  $('#seans-baslik').textContent = seans ? 'Seansı düzenle' : 'Yeni seans';
  $('#seans-sil').classList.toggle('hidden', !seans);
  $('#seans-hata').textContent = '';

  const kutu = $('#seans-gecmis-kutu');
  kutu.classList.toggle('hidden', !seans); kutu.open = false;
  $('#seans-gecmis').innerHTML = '';
  if (seans) {
    api(`/api/seanslar/${seans.id}/gecmis`).then((g) => {
      $('#seans-gecmis').innerHTML = g.map((x) => `<li>${esc(x.zaman)} – <b>${esc(x.degistiren)}</b>: ${esc(x.aciklama)}</li>`).join('');
    }).catch(() => {});
  }
  $('#seans-dialog').showModal();
}

// Danışan seçilince varsayılan ücreti öner
seansForm.danisan_id.addEventListener('change', () => {
  const d = state.danisanlar.find((x) => x.id === Number(seansForm.danisan_id.value));
  if (d && !seansForm.ucret.value) seansForm.ucret.value = d.varsayilan_ucret || '';
});

seansForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = seansForm;
  const body = {
    danisan_id: Number(f.danisan_id.value), user_id: Number(f.user_id.value),
    tarih: f.tarih.value, saat: f.saat.value, ucret: Number(f.ucret.value) || 0,
    durum: f.durum.value, odendi: f.odendi.checked, notlar: f.notlar.value,
  };
  try {
    let mesaj = 'Seans kaydedildi';
    if (f.id.value) await api(`/api/seanslar/${f.id.value}`, { method: 'PUT', body });
    else {
      const r = await api('/api/seanslar', { method: 'POST', body: { ...body, tekrar: Number(f.tekrar.value) } });
      if (r.olusturulan > 1) mesaj = `${r.olusturulan} seans oluşturuldu`;
    }
    $('#seans-dialog').close();
    bildir(mesaj);
    haftaYukle();
  } catch (err) { $('#seans-hata').textContent = err.message; }
});

$('#seans-sil').addEventListener('click', async () => {
  if (!confirm('Bu seans silinsin mi?')) return;
  try {
    await api(`/api/seanslar/${seansForm.id.value}`, { method: 'DELETE' });
    $('#seans-dialog').close(); bildir('Seans silindi'); haftaYukle();
  } catch (err) { $('#seans-hata').textContent = err.message; }
});

// ---------- Danışanlar ----------
async function danisanlariYukle() {
  state.danisanlar = await api('/api/danisanlar?tumu=1');
  danisanCiz();
}
function danisanCiz() {
  const q = $('#danisan-ara').value.toLocaleLowerCase('tr');
  const pasif = $('#danisan-pasif').checked;
  const liste = state.danisanlar.filter((d) => (pasif || d.aktif) && d.ad.toLocaleLowerCase('tr').includes(q));
  $('#danisan-liste').innerHTML = liste.map((d) => `<tr>
    <td>${esc(d.ad)}</td><td>${esc(d.telefon)}</td><td>${para(d.varsayilan_ucret)}</td>
    <td>${esc(d.notlar)}</td><td>${d.aktif ? 'Aktif' : 'Pasif'}</td>
    <td><button class="ikincil" data-hesap="${d.id}">Hesap</button> <button class="ikincil" data-duzenle="${d.id}">Düzenle</button></td></tr>`).join('')
    || '<tr><td colspan="6" class="ipucu">Kayıtlı danışan yok.</td></tr>';
  $$('[data-hesap]').forEach((b) => b.addEventListener('click', () => hesapAc(Number(b.dataset.hesap))));
  $$('[data-duzenle]').forEach((b) => b.addEventListener('click', () => danisanFormAc(state.danisanlar.find((d) => d.id === Number(b.dataset.duzenle)))));
}
$('#danisan-ara').addEventListener('input', danisanCiz);
$('#danisan-pasif').addEventListener('change', danisanCiz);
$('#danisan-ekle').addEventListener('click', () => danisanFormAc(null));

const danisanForm = $('#danisan-form');
function danisanFormAc(d) {
  const f = danisanForm;
  f.id.value = d?.id || ''; f.ad.value = d?.ad || ''; f.telefon.value = d?.telefon || '';
  f.varsayilan_ucret.value = d?.varsayilan_ucret ?? ''; f.notlar.value = d?.notlar || '';
  f.aktif.checked = d ? !!d.aktif : true;
  $('#danisan-hata').textContent = '';
  $('#danisan-dialog').showModal();
}
danisanForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = danisanForm;
  const body = { ad: f.ad.value, telefon: f.telefon.value, varsayilan_ucret: Number(f.varsayilan_ucret.value) || 0, notlar: f.notlar.value, aktif: f.aktif.checked };
  try {
    if (f.id.value) await api(`/api/danisanlar/${f.id.value}`, { method: 'PUT', body });
    else await api('/api/danisanlar', { method: 'POST', body });
    $('#danisan-dialog').close(); bildir('Danışan kaydedildi'); danisanlariYukle();
  } catch (err) { $('#danisan-hata').textContent = err.message; }
});

// ---------- Rapor ----------
function donemEtiket(grup, donem) {
  if (grup === 'ay') return trTarih(`${donem}-01`, { month: 'long', year: 'numeric' });
  const bit = iso(gunEkle(new Date(donem + 'T00:00:00'), 6));
  return `${trTarih(donem, { day: 'numeric', month: 'short' })} – ${trTarih(bit, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
async function raporGetir() {
  try {
    const r = await api(`/api/rapor?grup=${$('#rapor-grup').value}&baslangic=${$('#rapor-bas').value}&bitis=${$('#rapor-bit').value}`);
    state.rapor = r.satirlar.map((x) => ({ ...x, etiket: donemEtiket(r.grup, x.donem) }));
    $('#rapor-liste').innerHTML = state.rapor.map((x) => `<tr>
      <td>${esc(x.etiket)}</td><td>${esc(x.kullanici_ad)}</td><td class="sayi">${x.seans_sayisi}</td><td class="sayi">${x.tamamlanan}</td>
      <td class="sayi">${para(x.toplam_ucret)}</td><td class="sayi">${para(x.tahsil_edilen)}</td><td class="sayi">${para(x.bekleyen)}</td>
      <td class="sayi">${para(x.komisyon)}${x.komisyon_orani ? ` <small>(%${x.komisyon_orani})</small>` : ''}</td><td class="sayi">${para(x.net)}</td></tr>`).join('')
      || '<tr><td colspan="9" class="ipucu">Bu aralıkta seans yok.</td></tr>';

    const kisi = {};
    for (const x of state.rapor) {
      const k = (kisi[x.kullanici_ad] ||= { seans: 0, toplam: 0, tahsil: 0 });
      k.seans += x.seans_sayisi; k.toplam += x.toplam_ucret; k.tahsil += x.tahsil_edilen;
    }
    const genel = Object.values(kisi).reduce((a, k) => ({ seans: a.seans + k.seans, toplam: a.toplam + k.toplam, tahsil: a.tahsil + k.tahsil }), { seans: 0, toplam: 0, tahsil: 0 });
    $('#rapor-toplam').innerHTML =
      `<div class="kutu"><small>Genel toplam</small><b>${para(genel.toplam)}</b><small>${genel.seans} seans · bekleyen ${para(genel.toplam - genel.tahsil)}</small></div>` +
      Object.entries(kisi).map(([ad, k]) => `<div class="kutu"><small>${esc(ad)}</small><b>${para(k.toplam)}</b><small>${k.seans} seans · tahsil ${para(k.tahsil)}</small></div>`).join('');
  } catch (err) { bildir(err.message); }
}
$('#rapor-getir').addEventListener('click', raporGetir);
$('#rapor-grup').addEventListener('change', raporGetir);
function csvIndir(dosya, satirlar) {
  const csv = '﻿' + satirlar.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = dosya;
  a.click();
}
$('#rapor-csv').addEventListener('click', () => {
  csvIndir(`seans-raporu-${$('#rapor-bas').value}_${$('#rapor-bit').value}.csv`, [
    ['Dönem', 'Seansı alan', 'Seans', 'Tamamlanan', 'Toplam ücret', 'Tahsil edilen', 'Bekleyen', 'Komisyon', 'Net'],
    ...state.rapor.map((x) => [x.etiket, x.kullanici_ad, x.seans_sayisi, x.tamamlanan, x.toplam_ucret, x.tahsil_edilen, x.bekleyen, x.komisyon, x.net])]);
});

// ---------- Danışan hesabı ----------
async function hesapAc(id) {
  try {
    const h = await api(`/api/danisanlar/${id}/hesap`);
    $('#hesap-baslik').textContent = `${h.danisan.ad} — hesap`;
    $('#hesap-ozet').innerHTML =
      `<div class="kutu"><small>Toplam ücret</small><b>${para(h.ozet.toplam)}</b><small>${h.ozet.seans_sayisi} seans</small></div>` +
      `<div class="kutu"><small>Ödenen</small><b>${para(h.ozet.odenen)}</b></div>` +
      `<div class="kutu"><small>Kalan borç</small><b class="${h.ozet.borc > 0 ? 'negatif' : ''}">${para(h.ozet.borc)}</b></div>`;
    $('#hesap-liste').innerHTML = h.seanslar.map((s) => `<tr>
      <td>${trTarih(s.tarih, { day: 'numeric', month: 'short', year: 'numeric' })} ${esc(s.saat || '')}</td><td>${esc(s.kullanici_ad)}</td>
      <td>${DURUM[s.durum]}</td><td class="sayi">${para(s.ucret)}</td>
      <td>${s.durum === 'iptal' ? '—' : `<span class="rozet ${s.odendi ? 'odendi' : 'bekliyor'}">${s.odendi ? 'Ödendi' : 'Bekliyor'}</span>`}</td></tr>`).join('')
      || '<tr><td colspan="5" class="ipucu">Bu danışana ait seans yok.</td></tr>';
    $('#hesap-dialog').showModal();
  } catch (err) { bildir(err.message); }
}

// ---------- Giderler ----------
const giderForm = $('#gider-form');
const sahipAdi = (g) => g.kullanici_ad || 'Ortak';

async function giderGetir() {
  try {
    const f = $('#gider-filtre').value;
    state.giderler = await api(`/api/giderler?baslangic=${$('#gider-bas').value}&bitis=${$('#gider-bit').value}${f ? `&user_id=${f}` : ''}`);
    $('#gider-liste').innerHTML = state.giderler.map((g) => `<tr>
      <td>${trTarih(g.tarih, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${esc(state.kategoriler[g.kategori] || g.kategori)}</td>
      <td>${esc(g.aciklama)}</td><td>${esc(sahipAdi(g))}</td><td class="sayi">${para(g.tutar)}</td>
      <td><button class="ikincil" data-gider="${g.id}">Düzenle</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="ipucu">Bu aralıkta gider yok.</td></tr>';
    $$('[data-gider]').forEach((b) => b.addEventListener('click', () => giderFormAc(state.giderler.find((g) => g.id === Number(b.dataset.gider)))));

    const vergi = state.giderler.filter((g) => state.vergiKategorileri.includes(g.kategori)).reduce((a, g) => a + g.tutar, 0);
    const toplam = state.giderler.reduce((a, g) => a + g.tutar, 0);
    $('#gider-ozet').innerHTML =
      `<div class="kutu"><small>Toplam gider</small><b>${para(toplam)}</b><small>${state.giderler.length} kayıt</small></div>` +
      `<div class="kutu"><small>Vergi giderleri</small><b>${para(vergi)}</b><small>stopaj, KDV, gelir vergisi…</small></div>` +
      `<div class="kutu"><small>Diğer giderler</small><b>${para(toplam - vergi)}</b></div>`;
  } catch (err) { bildir(err.message); }
}
$('#gider-getir').addEventListener('click', giderGetir);
$('#gider-filtre').addEventListener('change', giderGetir);
$('#gider-ekle').addEventListener('click', () => giderFormAc(null));

function giderFormAc(g) {
  const f = giderForm;
  f.id.value = g?.id || '';
  f.tarih.value = g?.tarih || iso(new Date());
  f.kategori.value = g?.kategori || 'stopaj';
  f.user_id.value = g ? (g.user_id ?? 'ortak') : (state.ben.role === 'admin' ? 'ortak' : state.ben.id);
  f.tutar.value = g?.tutar ?? '';
  f.aciklama.value = g?.aciklama || '';
  f.matrah.value = ''; f.oran.value = varsayilanOran(f.kategori.value);
  $('#gider-baslik').textContent = g ? 'Gideri düzenle' : 'Yeni gider';
  $('#gider-sil').classList.toggle('hidden', !g);
  $('#gider-hata').textContent = '';
  $('#gider-dialog').showModal();
}

// Matrah × oran ile tutar hesaplama (ör. kira stopajı %20)
const VARSAYILAN_ORAN = { stopaj: 20, kdv: 20, damga: 0.948 };
const varsayilanOran = (k) => VARSAYILAN_ORAN[k] ?? '';
giderForm.kategori.addEventListener('change', () => { giderForm.oran.value = varsayilanOran(giderForm.kategori.value); oranHesapla(); });
function oranHesapla() {
  const m = Number(giderForm.matrah.value), o = Number(giderForm.oran.value);
  if (m > 0 && o > 0) giderForm.tutar.value = (Math.round(m * o) / 100).toFixed(2);
}
giderForm.matrah.addEventListener('input', oranHesapla);
giderForm.oran.addEventListener('input', oranHesapla);

giderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = giderForm;
  const body = { tarih: f.tarih.value, kategori: f.kategori.value, tutar: Number(f.tutar.value), aciklama: f.aciklama.value, user_id: f.user_id.value };
  try {
    if (f.id.value) await api(`/api/giderler/${f.id.value}`, { method: 'PUT', body });
    else await api('/api/giderler', { method: 'POST', body });
    $('#gider-dialog').close(); bildir('Gider kaydedildi'); giderGetir();
  } catch (err) { $('#gider-hata').textContent = err.message; }
});
$('#gider-sil').addEventListener('click', async () => {
  if (!confirm('Bu gider silinsin mi?')) return;
  try {
    await api(`/api/giderler/${giderForm.id.value}`, { method: 'DELETE' });
    $('#gider-dialog').close(); bildir('Gider silindi'); giderGetir();
  } catch (err) { $('#gider-hata').textContent = err.message; }
});

// ---------- Gelir-gider raporu ----------
async function ggGetir() {
  try {
    const f = $('#gg-filtre').value;
    const r = await api(`/api/gelir-gider?grup=${$('#gg-grup').value}&baslangic=${$('#gg-bas').value}&bitis=${$('#gg-bit').value}${f ? `&user_id=${f}` : ''}`);
    state.gg = r.satirlar.map((x) => ({ ...x, etiket: donemEtiket(r.grup, x.donem) }));
    const netHucre = (n) => `<td class="sayi ${n < 0 ? 'negatif' : ''}"><b>${para(n)}</b></td>`;
    $('#gg-liste').innerHTML = state.gg.map((x) => `<tr>
      <td>${esc(x.etiket)}</td><td class="sayi">${para(x.gelir)}</td><td class="sayi">${para(x.tahsilat)}</td>
      <td class="sayi">${para(x.vergi)}</td><td class="sayi">${para(x.diger_gider)}</td><td class="sayi">${para(x.komisyon)}</td>
      <td class="sayi">${para(x.toplam_gider)}</td>${netHucre(x.net)}</tr>`).join('')
      || '<tr><td colspan="8" class="ipucu">Bu aralıkta kayıt yok.</td></tr>';

    const t = state.gg.reduce((a, x) => {
      for (const k of ['gelir', 'tahsilat', 'vergi', 'diger_gider', 'komisyon', 'toplam_gider', 'net']) a[k] += x[k];
      return a;
    }, { gelir: 0, tahsilat: 0, vergi: 0, diger_gider: 0, komisyon: 0, toplam_gider: 0, net: 0 });
    $('#gg-toplam').innerHTML =
      `<div class="kutu"><small>Toplam gelir</small><b>${para(t.gelir)}</b><small>tahsil edilen ${para(t.tahsilat)}</small></div>` +
      `<div class="kutu"><small>Toplam gider</small><b>${para(t.toplam_gider)}</b><small>vergi ${para(t.vergi)}</small></div>` +
      `<div class="kutu"><small>Net kâr</small><b class="${t.net < 0 ? 'negatif' : ''}">${para(t.net)}</b></div>`;
  } catch (err) { bildir(err.message); }
}
$('#gg-getir').addEventListener('click', ggGetir);
$('#gg-grup').addEventListener('change', ggGetir);
$('#gg-filtre').addEventListener('change', ggGetir);
$('#gg-csv').addEventListener('click', () => {
  csvIndir(`gelir-gider-${$('#gg-bas').value}_${$('#gg-bit').value}.csv`, [
    ['Dönem', 'Gelir', 'Tahsilat', 'Vergi giderleri', 'Diğer giderler', 'Komisyon', 'Toplam gider', 'Net'],
    ...state.gg.map((x) => [x.etiket, x.gelir, x.tahsilat, x.vergi, x.diger_gider, x.komisyon, x.toplam_gider, x.net])]);
});

// ---------- Komisyon oranları ----------
function komisyonAlanlariCiz(terapistler) {
  $('#komisyon-alanlar').innerHTML = terapistler.map((u) =>
    `<label>${esc(u.display_name)} (%) <input type="number" min="0" max="100" step="0.01" data-komisyon="${u.id}" value="${u.komisyon_orani || 0}"></label>`).join('');
}
$('#komisyon-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    for (const inp of $$('[data-komisyon]')) {
      await api(`/api/kullanicilar/${inp.dataset.komisyon}/komisyon`, { method: 'PUT', body: { komisyon_orani: Number(inp.value) } });
    }
    state.kullanicilar = await api('/api/kullanicilar');
    bildir('Oranlar kaydedildi');
  } catch (err) { bildir(err.message); }
});

// ---------- Ayarlar ----------
$('#sifre-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try { await api('/api/sifre', { method: 'POST', body: { eski: f.get('eski'), yeni: f.get('yeni') } }); e.target.reset(); bildir('Şifre değiştirildi'); }
  catch (err) { bildir(err.message); }
});
$('#sifirla-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try { await api(`/api/kullanicilar/${f.get('id')}/sifre`, { method: 'POST', body: { yeni: f.get('yeni') } }); e.target.reset(); bildir('Şifre sıfırlandı'); }
  catch (err) { bildir(err.message); }
});

baslat();
