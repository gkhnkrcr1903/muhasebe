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

  const bugun = new Date();
  $('#rapor-bas').value = iso(new Date(bugun.getFullYear(), bugun.getMonth(), 1));
  $('#rapor-bit').value = iso(new Date(bugun.getFullYear(), bugun.getMonth() + 1, 0));

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
    if (f.id.value) await api(`/api/seanslar/${f.id.value}`, { method: 'PUT', body });
    else await api('/api/seanslar', { method: 'POST', body });
    $('#seans-dialog').close();
    bildir('Seans kaydedildi');
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
    <td><button class="ikincil" data-duzenle="${d.id}">Düzenle</button></td></tr>`).join('')
    || '<tr><td colspan="6" class="ipucu">Kayıtlı danışan yok.</td></tr>';
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
      <td class="sayi">${para(x.toplam_ucret)}</td><td class="sayi">${para(x.tahsil_edilen)}</td><td class="sayi">${para(x.bekleyen)}</td></tr>`).join('')
      || '<tr><td colspan="7" class="ipucu">Bu aralıkta seans yok.</td></tr>';

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
$('#rapor-csv').addEventListener('click', () => {
  const satirlar = [['Dönem', 'Seansı alan', 'Seans', 'Tamamlanan', 'Toplam ücret', 'Tahsil edilen', 'Bekleyen'],
    ...state.rapor.map((x) => [x.etiket, x.kullanici_ad, x.seans_sayisi, x.tamamlanan, x.toplam_ucret, x.tahsil_edilen, x.bekleyen])];
  const csv = '﻿' + satirlar.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `rapor-${$('#rapor-bas').value}_${$('#rapor-bit').value}.csv`;
  a.click();
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
