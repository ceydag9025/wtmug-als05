/* =========================================================
   Kamera Çevirmeni — sağlam sürüm
   Tesseract.js (OCR) + MyMemory (çeviri)
   ========================================================= */

const $ = (id) => document.getElementById(id);

const video       = $("video");
const cameraMsg   = $("cameraMsg");
const captureBtn  = $("captureBtn");
const galleryBtn  = $("galleryBtn");
const galleryInput= $("galleryInput");
const targetLang  = $("targetLang");
const manualText  = $("manualText");
const translateBtn= $("translateTextBtn");
const statusBox   = $("status");
const resultCard  = $("resultCard");
const ocrTextEl   = $("ocrText");
const detectedEl  = $("detectedLang");
const translatedEl= $("translatedText");
const translationMeta = $("translationMeta");
const installBtn  = $("installBtn");

let worker = null;
let stream = null;
let busy = false;
let deferredInstall = null;

/* ---------- EN ÖNEMLİ: ÖNCE OLAYLARI BAĞLA ---------- */
bindEvents();
setupInstallPrompt();
setupServiceWorker();

/* Sonra kamera ve OCR (başarısız olsalar bile butonlar çalışır) */
initCamera();
loadTesseract();

/* ---------- OLAY BAĞLAMA ---------- */
function bindEvents(){
  captureBtn.addEventListener("click", () => {
    console.log("📷 captureBtn");
    captureAndTranslate();
  });
  galleryBtn.addEventListener("click", () => {
    console.log("🖼️ galleryBtn");
    galleryInput.click();
  });
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

/* ---------- TESSERACT DİNAMİK YÜKLEME ---------- */
async function loadTesseract(){
  if (typeof Tesseract === "undefined"){
    showStatus("OCR motoru indiriliyor…");
    try{
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
        s.onload = resolve;
        s.onerror = () => reject(new Error("CDN erişilemedi"));
        document.head.appendChild(s);
        setTimeout(() => reject(new Error("zaman aşımı")), 25000);
      });
    }catch(err){
      console.error("Tesseract yüklenemedi:", err);
      showStatus("OCR motoru yüklenemedi (CDN erişimi). Galeri/elle giriş çalışır, OCR için internet gerekli.", true);
      return;
    }
  }
  await initOCR();
}

async function initOCR(){
  showStatus("OCR motoru hazırlanıyor… (ilk seferde 15-20 sn)");
  try{
    worker = await Tesseract.createWorker("eng", 1, {
      logger: m => {
        if (m.status === "recognizing text"){
          showStatus("Metin okunuyor… %" + Math.round((m.progress || 0) * 100));
        } else if (m.status === "loading language traineddata"){
          showStatus("Dil paketi indiriliyor…");
        } else if (m.status === "initializing api"){
          showStatus("OCR başlatılıyor…");
        }
      }
    });
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO_OSD });
    hideStatus();
    console.log("✅ OCR hazır");
  }catch(err){
    console.error("OCR başlatılamadı:", err);
    showStatus("OCR başlatılamadı. İnterneti kontrol edip sayfayı yenileyin.", true);
  }
}

/* ---------- KAMERA ---------- */
async function initCamera(){
  if (!window.isSecureContext){
    showCameraError("Kamera için HTTPS gerekli. Adresin https:// ile başladığından emin olun.");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    showCameraError("Bu tarayıcı kamera API'sini desteklemiyor.");
    return;
  }
  try{
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    hideCameraError();
    console.log("✅ Kamera açıldı");
  }catch(err){
    console.warn("Kamera hatası:", err.name, err.message);
    let msg = "Kamera başlatılamadı. (Hata: " + err.name + ")";
    if (err.name === "NotAllowedError") msg = "Kamera izni reddedildi. Tarayıcıdan izin verin veya galeriden görsel yükleyin.";
    else if (err.name === "NotFoundError") msg = "Cihazda kamera bulunamadı.";
    else if (err.name === "NotReadableError") msg = "Kamera başka bir uygulama tarafından kullanılıyor olabilir.";
    showCameraError(msg);
  }
}

function showCameraError(msg){
  cameraMsg.hidden = false;
  cameraMsg.textContent = msg;
}
function hideCameraError(){ cameraMsg.hidden = true; }

/* ---------- YAKALA → OCR → ÇEVİR ---------- */
async function captureAndTranslate(){
  if (busy) return;
  if (!video.videoWidth || !video.videoHeight){
    showStatus("Kamera görüntüsü yok. Kamera iznini ve önizlemeyi kontrol edin.", true);
    return;
  }
  if (!worker){
    showStatus("OCR motoru henüz hazır değil. Birkaç saniye bekleyip tekrar deneyin.", true);
    return;
  }
  busy = true;
  try{
    hideResult();
    const canvas = document.createElement("canvas");
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    await runPipeline(dataUrl);
  }catch(err){
    console.error(err);
    showStatus("Hata: " + err.message, true);
  }finally{
    busy = false;
    hideStatus();
  }
}

async function handleGalleryFile(file){
  if (busy) return;
  if (!worker){
    showStatus("OCR motoru henüz hazır değil. Birkaç saniye bekleyip tekrar deneyin.", true);
    return;
  }
  busy = true;
  try{
    hideResult();
    const dataUrl = await fileToDataURL(file);
    await runPipeline(dataUrl);
  }catch(err){
    console.error(err);
    showStatus("Görsel okunamadı: " + err.message, true);
  }finally{
    busy = false;
    hideStatus();
  }
}

async function translateManualText(){
  if (busy) return;
  const text = manualText.value.trim();
  if (!text){ showStatus("Lütfen çevrilecek metni girin.", true); return; }
  busy = true;
  try{
    hideResult();
    showStatus("Çeviri yapılıyor…");
    const target = targetLang.value;
    const { translated, detected } = await translateText(text, target);
    renderResult({ original: text, detected: detected || "—", translated, note: "Elle girilen metin" });
  }catch(err){
    console.error(err);
    showStatus("Çeviri yapılamadı: " + err.message, true);
  }finally{
    busy = false;
    hideStatus();
  }
}

async function runPipeline(imageDataUrl){
  showStatus("Metin okunuyor…");
  const { data } = await worker.recognize(imageDataUrl);
  const text = (data.text || "").trim();
  if (!text){
    showStatus("Görselde okunabilir metin bulunamadı. Farklı bir açıyla veya daha yakın mesafeyle tekrar deneyin.", true);
    return;
  }
  const confidence = typeof data.confidence === "number" ? Math.round(data.confidence) : null;
  const script = data.script || "";
  showStatus("Çeviri yapılıyor…");
  const target = targetLang.value;
  const { translated, detected } = await translateText(text, target);
  renderResult({
    original: text,
    detected: detected || (script ? "Yazı sistemi: " + script : "Otomatik algılandı"),
    translated,
    note: confidence !== null ? "OCR güveni: %" + confidence : ""
  });
}

/* ---------- ÇEVİRİ ---------- */
async function translateText(text, targetLangCode){
  const chunks = splitText(text, 480);
  const out = [];
  let detected = "";
  for (const chunk of chunks){
    const url = "https://api.mymemory.translated.net/get?q=" +
      encodeURIComponent(chunk) + "&langpair=auto|" + encodeURIComponent(targetLangCode);
    const res = await fetch(url);
    if (!res.ok) throw new Error("MyMemory HTTP " + res.status);
    const json = await res.json();
    if (json.responseStatus !== 200) throw new Error(json.responseDetails || "Çeviri hatası");
    out.push(json.responseData && json.responseData.translatedText || "");
    if (!detected && json.responseData && json.responseData.detectedLanguage)
      detected = json.responseData.detectedLanguage;
  }
  return { translated: out.join(" ").trim() || "(Çeviri boş)", detected };
}

function splitText(text, maxBytes){
  const enc = new TextEncoder();
  if (enc.encode(text).length <= maxBytes) return [text];
  const parts = []; let cur = "";
  for (const w of text.split(/\s+/)){
    const cand = cur ? cur + " " + w : w;
    if (enc.encode(cand).length > maxBytes){ if (cur) parts.push(cur); cur = w; }
    else cur = cand;
  }
  if (cur) parts.push(cur);
  return parts.length ? parts : [text.slice(0, 150)];
}

/* ---------- GÖRÜNÜM ---------- */
function renderResult({ original, detected, translated, note }){
  ocrTextEl.textContent = original;
  detectedEl.textContent = detected ? "Kaynak dil: " + detected : "";
  translatedEl.textContent = translated;
  translationMeta.textContent = note || "";
  resultCard.hidden = false;
  resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function hideResult(){ resultCard.hidden = true; }

function showStatus(msg, isError){
  statusBox.hidden = false;
  statusBox.textContent = msg;
  statusBox.style.color = isError ? "#c62828" : "#1a5cff";
  statusBox.style.background = isError ? "#fdecec" : "#e8eeff";
}
function hideStatus(){ statusBox.hidden = true; }

function fileToDataURL(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ---------- PWA ---------- */
function setupInstallPrompt(){
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    installBtn.hidden = true;
  });
}

function setupServiceWorker(){
  if ("serviceWorker" in navigator){
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW:", e));
    });
  }
}