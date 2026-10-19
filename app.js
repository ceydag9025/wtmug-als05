/* Kamera Çevirmeni — teşhis paneli ile */

const $ = (id) => document.getElementById(id);

const video = $("video"), cameraMsg = $("cameraMsg");
const captureBtn = $("captureBtn"), galleryBtn = $("galleryBtn"), galleryInput = $("galleryInput");
const targetLang = $("targetLang"), manualText = $("manualText"), translateBtn = $("translateTextBtn");
const statusBox = $("status"), resultCard = $("resultCard");
const ocrTextEl = $("ocrText"), detectedEl = $("detectedLang");
const translatedEl = $("translatedText"), translationMeta = $("translationMeta");
const installBtn = $("installBtn");

let worker = null, stream = null, busy = false, deferredInstall = null;

/* ============ TEŞHİS PANELİ ============ */
const debugBox = document.createElement("pre");
debugBox.id = "debugBox";
debugBox.style.cssText = `
  background:#0d1117; color:#7ee787; font:12px/1.5 monospace;
  padding:10px; border-radius:10px; margin:10px 0; max-height:220px;
  overflow:auto; white-space:pre-wrap; word-break:break-all;
  border:1px solid #30363d;
`;
document.querySelector("main").prepend(debugBox);

function log(msg, ok){
  const t = new Date().toLocaleTimeString("tr-TR");
  const line = `[${t}] ${ok === true ? "🟢" : ok === false ? "🔴" : "🔵"} ${msg}`;
  debugBox.textContent += line + "\n";
  debugBox.scrollTop = debugBox.scrollHeight;
  console.log(line);
}
log("Sayfa yüklendi");

/* ============ OLAYLARI HEMEN BAĞLA ============ */
bindEvents();
setupInstallPrompt();
setupServiceWorker();
log("Olaylar bağlandı");

/* ============ KAMERAYI BUTONLA BAŞLAT ============ */
// Kamerayı "Otomatik başlat" yerine, kullanıcı kameraya dokunduğunda başlat.
// Bu, Chrome Android'in autoplay kısıtlamalarını tamamen atlar.
const camStartBtn = document.createElement("button");
camStartBtn.textContent = "📷 Kamerayı Başlat";
camStartBtn.className = "btn primary";
camStartBtn.style.marginBottom = "10px";
camStartBtn.addEventListener("click", startCamera);
document.querySelector(".scanner").after(camStartBtn);

log("'Kamerayı Başlat' butonu hazır — dokunun");

/* ============ KAMERA ============ */
async function startCamera(){
  log("startCamera() çağrıldı");

  if (!window.isSecureContext){
    log("isSecureContext = false → HTTPS GEREKLİ", false);
    cameraMsg.hidden = false;
    cameraMsg.textContent = "Kamera için HTTPS gerekli. Adres 'https://' ile başlamalı.";
    return;
  }
  log("HTTPS: OK");

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    log("mediaDevices yok", false);
    return;
  }
  log("mediaDevices: OK");

  try{
    log("getUserMedia çağrılıyor…");
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    log("getUserMedia döndü. Track sayısı: " + stream.getVideoTracks().length, true);
    const track = stream.getVideoTracks()[0];
    log("Track: " + track.label + " | enabled=" + track.enabled + " | readyState=" + track.readyState);

    // ÖNEMLİ: autoplay için property'yi de ayarla
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    video.onloadedmetadata = () => {
      log("onloadedmetadata: " + video.videoWidth + "x" + video.videoHeight, true);
    };
    video.onplay = () => log("video 'play' olayı", true);
    video.onplaying = () => log("video 'playing' olayı", true);
    video.onstalled = () => log("video 'stalled' (dondu)", false);
    video.onerror = () => log("video error: " + (video.error && video.error.message), false);

    try{
      await video.play();
      log("video.play() başarılı", true);
    }catch(e){
      log("video.play() hatası: " + e.name + " — " + e.message, false);
      // Bir kez daha dene (bazı Android sürümlerinde ilk deneme reddedilir)
      try{ await video.play(); log("video.play() 2. deneme başarılı", true); }
      catch(e2){ log("video.play() 2. deneme de başarısız: " + e2.name, false); }
    }

    hideCameraError();
    camStartBtn.textContent = "🔄 Kamerayı Yeniden Başlat";

    // 2 sn sonra kare üretiliyor mu?
    setTimeout(() => {
      const w = video.videoWidth, rs = video.readyState, paused = video.paused;
      log(`2sn sonra → readyState=${rs}, videoWidth=${w}, paused=${paused}`,
          w > 0 && !paused ? true : false);
      if (w === 0 || paused){
        cameraMsg.hidden = false;
        cameraMsg.textContent = "Kamera açık ama görüntü gelmiyor. Başka bir uygulama kamerayı kullanıyor olabilir. Tüm uygulamaları kapatıp tekrar deneyin.";
      }
    }, 2000);

  }catch(err){
    log("Kamera HATASI: " + err.name + " — " + err.message, false);
    let msg = "Kamera başlatılamadı: " + err.name;
    if (err.name === "NotAllowedError") msg = "Kamera izni reddedildi. Kilit simgesinden izin verin.";
    else if (err.name === "NotFoundError") msg = "Cihazda kamera bulunamadı.";
    else if (err.name === "NotReadableError") msg = "Kamera başka bir uygulama tarafından kullanılıyor. O uygulamayı kapatın.";
    else if (err.name === "OverconstrainedError") msg = "Kamera istenen ayarları desteklemiyor.";
    cameraMsg.hidden = false;
    cameraMsg.textContent = msg;
  }
}

function hideCameraError(){ cameraMsg.hidden = true; }

/* ============ OLAYLAR ============ */
function bindEvents(){
  captureBtn.addEventListener("click", captureAndTranslate);
  galleryBtn.addEventListener("click", () => galleryInput.click());
  galleryInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleGalleryFile(f);
    galleryInput.value = "";
  });
  translateBtn.addEventListener("click", translateManualText);
  manualText.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") translateManualText();
  });
}

/* ============ OCR ============ */
async function ensureOCR(){
  if (worker) return true;
  if (typeof Tesseract === "undefined"){
    log("Tesseract CDN'den yükleniyor…");
    try{
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
        s.onload = res;
        s.onerror = () => rej(new Error("CDN hatası"));
        document.head.appendChild(s);
      });
      log("Tesseract script yüklendi", true);
    }catch(e){ log("Tesseract YÜKLENEMEDİ: " + e.message, false); return false; }
  }
  log("OCR worker oluşturuluyor…");
  try{
    worker = await Tesseract.createWorker("eng", 1, {
      logger: m => {
        if (m.status === "recognizing text"){
          showStatus("Metin okunuyor… %" + Math.round((m.progress || 0) * 100));
        }
      }
    });
    log("OCR worker HAZIR", true);
    return true;
  }catch(e){ log("OCR worker hatası: " + e.message, false); return false; }
}

/* ============ YAKALA → OCR → ÇEVİR ============ */
async function captureAndTranslate(){
  if (busy) return;
  if (!video.videoWidth){
    log("video.videoWidth=0 → önce kamerayı başlatın", false);
    showStatus("Önce kamerayı başlatın.", true);
    return;
  }
  busy = true;
  try{
    hideResult();
    const ok = await ensureOCR();
    if (!ok){ showStatus("OCR yüklenemedi.", true); return; }

    const c = document.createElement("canvas");
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0);
    log("Kare yakalandı: " + c.width + "x" + c.height);
    await runPipeline(c.toDataURL("image/jpeg", 0.92));
  }catch(e){
    log("Yakalama hatası: " + e.message, false);
    showStatus("Hata: " + e.message, true);
  }finally{ busy = false; hideStatus(); }
}

async function handleGalleryFile(file){
  if (busy) return;
  busy = true;
  try{
    hideResult();
    const ok = await ensureOCR();
    if (!ok){ showStatus("OCR yüklenemedi.", true); return; }
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    await runPipeline(dataUrl);
  }catch(e){
    log("Galeri hatası: " + e.message, false);
    showStatus("Görsel okunamadı: " + e.message, true);
  }finally{ busy = false; hideStatus(); }
}

async function translateManualText(){
  if (busy) return;
  const text = manualText.value.trim();
  if (!text){ showStatus("Metin girin.", true); return; }
  busy = true;
  try{
    hideResult();
    showStatus("Çeviri yapılıyor…");
    const r = await translateText(text, targetLang.value);
    renderResult({ original: text, detected: r.detected || "—", translated: r.translated, note: "Elle girilen metin" });
  }catch(e){
    showStatus("Çeviri hatası: " + e.message, true);
  }finally{ busy = false; hideStatus(); }
}

async function runPipeline(dataUrl){
  showStatus("Metin okunuyor…");
  log("OCR recognize çağrılıyor…");
  const { data } = await worker.recognize(dataUrl);
  const text = (data.text || "").trim();
  log("OCR bitti. Karakter sayısı: " + text.length);
  if (!text){
    showStatus("Görselde metin bulunamadı. Daha yakından deneyin.", true);
    return;
  }
  showStatus("Çeviri yapılıyor…");
  const r = await translateText(text, targetLang.value);
  renderResult({
    original: text,
    detected: r.detected || (data.script ? "Yazı sistemi: " + data.script : "Otomatik"),
    translated: r.translated,
    note: typeof data.confidence === "number" ? "OCR güveni: %" + Math.round(data.confidence) : ""
  });
}

/* ============ ÇEVİRİ ============ */
async function translateText(text, target){
  const enc = new TextEncoder();
  const parts = [];
  if (enc.encode(text).length <= 480){ parts.push(text); }
  else{
    let cur = "";
    for (const w of text.split(/\s+/)){
      const cand = cur ? cur + " " + w : w;
      if (enc.encode(cand).length > 480){ if (cur) parts.push(cur); cur = w; }
      else cur = cand;
    }
    if (cur) parts.push(cur);
  }
  const out = []; let detected = "";
  for (const p of parts){
    const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(p) + "&langpair=auto|" + encodeURIComponent(target);
    const res = await fetch(url);
    if (!res.ok) throw new Error("MyMemory HTTP " + res.status);
    const j = await res.json();
    if (j.responseStatus !== 200) throw new Error(j.responseDetails || "Çeviri hatası");
    out.push((j.responseData && j.responseData.translatedText) || "");
    if (!detected && j.responseData && j.responseData.detectedLanguage) detected = j.responseData.detectedLanguage;
  }
  return { translated: out.join(" ").trim() || "(boş)", detected };
}

/* ============ GÖRÜNÜM ============ */
function renderResult({ original, detected, translated, note }){
  ocrTextEl.textContent = original;
  detectedEl.textContent = detected ? "Kaynak dil: " + detected : "";
  translatedEl.textContent = translated;
  translationMeta.textContent = note || "";
  resultCard.hidden = false;
  resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function hideResult(){ resultCard.hidden = true; }
function showStatus(m, err){
  statusBox.hidden = false; statusBox.textContent = m;
  statusBox.style.color = err ? "#c62828" : "#1a5cff";
  statusBox.style.background = err ? "#fdecec" : "#e8eeff";
}
function hideStatus(){ statusBox.hidden = true; }

/* ============ PWA ============ */
function setupInstallPrompt(){
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferredInstall = e; installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null; installBtn.hidden = true;
  });
}
function setupServiceWorker(){
  if ("serviceWorker" in navigator){
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(e => log("SW: " + e.message, false));
    });
  }
}