/* =========================================================
   Kamera Çevirmeni — PWA
   OCR: Tesseract.js (cihaz üzerinde)
   Çeviri: MyMemory (anahtarsız, ücretsiz)
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

/* ---------- Durum ---------- */
let worker = null;          // Tesseract worker
let stream = null;          // kamera akışı
let busy = false;
let deferredInstall = null;

/* =========================================================
   BAŞLAT
   ========================================================= */
async function init(){
  // 1) ÖNCE olayları bağla — butonlar hemen çalışsın
  bindEvents();
  setupInstallPrompt();
  setupServiceWorker();

  // 2) Sonra kamera ve OCR'ı başlat (hata olsa bile butonlar zaten bağlı)
  await initCamera();
  initOCR(); // await YOK — arka planda yüklensin, hata verse de butonlar çalışır
}



/* =========================================================
   KAMERA
   ========================================================= */
async function initCamera(){
  try{
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width:{ideal:1920}, height:{ideal:1080} },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    hideCameraError();
  }catch(err){
    console.warn("Kamera hatası", err);
    let msg = "Kamera başlatılamadı.";
    if (err.name === "NotAllowedError") msg = "Kamera izni reddedildi. Tarayıcı ayarlarından izin verin veya galeriden görsel yükleyin / metni elle girin.";
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

/* =========================================================
   OCR — Tesseract.js
   ========================================================= */
async function initOCR(){
  showStatus("OCR motoru hazırlanıyor… (ilk seferde 10-20 sn sürebilir)");
  try{
    worker = await Tesseract.createWorker("eng", 1, {
      logger: m => {
        if (m.status === "recognizing text"){
          showStatus(`Metin okunuyor… %${Math.round((m.progress || 0) * 100)}`);
        } else if (m.status === "loading tesseract core"){
          showStatus("OCR motoru indiriliyor…");
        } else if (m.status === "loading language traineddata"){
          showStatus("Dil paketi indiriliyor…");
        } else if (m.status === "initializing api"){
          showStatus("OCR başlatılıyor…");
        }
      }
    });
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO_OSD,
    });
    hideStatus();
    console.log("✅ OCR hazır");
  }catch(err){
    console.error("❌ OCR başlatılamadı", err);
    showStatus("OCR motoru yüklenemedi. İnternet bağlantınızı kontrol edin ve sayfayı yenileyin.", true);
  }
}

/* =========================================================
   YAKALA → OCR → ÇEVİR
   ========================================================= */
async function captureAndTranslate(){
  if (busy) return;

  if (!worker){
    showStatus("OCR motoru henüz hazır değil. Lütfen birkaç saniye bekleyip tekrar deneyin.", true);
    return;
  }

  busy = true;
  try{
    hideResult();
    const canvas = document.createElement("canvas");
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    if (!canvas.width || !canvas.height){
      showStatus("Kamera görüntüsü alınamadı. Kameranın açık olduğundan emin olun.", true);
      return;
    }
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    await runPipeline(imageDataUrl);
  }catch(err){
    console.error(err);
    showStatus("Görüntü işlenirken hata oluştu: " + err.message, true);
  }finally{
    busy = false;
    hideStatus();
  }
}

/* Galeriden görsel */
async function handleGalleryFile(file){
  if (!file || busy) return;
  busy = true;
  try{
    hideResult();
    if (!worker){
      showStatus("OCR motoru hazır değil.", true);
      return;
    }
    const dataUrl = await fileToDataURL(file);
    await runPipeline(dataUrl);
  }catch(err){
    console.error(err);
    showStatus("Görsel okunamadı. Lütfen başka bir görsel deneyin.", true);
  }finally{
    busy = false;
    hideStatus();
  }
}

/* Elle metin → çeviri */
async function translateManualText(){
  if (busy) return;
  const text = manualText.value.trim();
  if (!text){
    showStatus("Lütfen çevrilecek metni girin.", true);
    return;
  }
  busy = true;
  try{
    hideResult();
    showStatus("Çeviri yapılıyor…");
    const target = targetLang.value;
    const { translated, detected } = await translateText(text, target);
    renderResult({
      original: text,
      detected: detected || "—",
      translated,
      note: "Elle girilen metin"
    });
  }catch(err){
    console.error(err);
    showStatus("Çeviri yapılamadı. İnternet bağlantınızı kontrol edin.", true);
  }finally{
    busy = false;
    hideStatus();
  }
}

/* =========================================================
   ORTAK PIPELINE (OCR → ÇEVİRİ)
   ========================================================= */
async function runPipeline(imageDataUrl){
  showStatus("Metin okunuyor…");
  const { data } = await worker.recognize(imageDataUrl);
  const text = (data.text || "").trim();

  if (!text){
    showStatus("Görselde okunabilir metin bulunamadı. Farklı bir açıyla tekrar deneyin veya metni elle girin.", true);
    return;
  }

  const confidence = typeof data.confidence === "number" ? Math.round(data.confidence) : null;
  const script = data.script || "";
  const detectedInfo = script ? `Algılanan yazı sistemi: ${script}` : "";

  showStatus("Çeviri yapılıyor…");
  const target = targetLang.value;
  const { translated, detected } = await translateText(text, target);

  renderResult({
    original: text,
    detected: detected || detectedInfo || "Otomatik algılandı",
    translated,
    note: confidence !== null ? `OCR güveni: %${confidence}` : ""
  });
}

/* =========================================================
   ÇEVİRİ — MyMemory (anahtarsız)
   ========================================================= */
async function translateText(text, targetLangCode){
  /* MyMemory tek istekte ~500 bayt sınırı koyar; uzun metni bölelim */
  const chunks = splitTextForMyMemory(text, 480);
  const translatedParts = [];
  let detected = "";

  for (const chunk of chunks){
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=auto|${encodeURIComponent(targetLangCode)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
    const json = await res.json();
    if (json.responseStatus !== 200) throw new Error(json.responseDetails || "Çeviri servisi hatası");
    const t = json.responseData?.translatedText || "";
    translatedParts.push(t);
    if (!detected && json.responseData?.detectedLanguage){
      detected = json.responseData.detectedLanguage;
    }
  }

  return {
    translated: translatedParts.join(" ").trim() || "(Çeviri boş)",
    detected
  };
}

/* UTF-8 bayt sınırına göre böl */
function splitTextForMyMemory(text, maxBytes){
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return [text];

  const parts = [];
  let current = "";
  for (const word of text.split(/\s+/)){
    const candidate = current ? current + " " + word : word;
    if (encoder.encode(candidate).length > maxBytes){
      if (current) parts.push(current);
      current = word;
    }else{
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts.length ? parts : [text.slice(0, 150)];
}

/* =========================================================
   SONUÇ GÖSTERİMİ
   ========================================================= */
function renderResult({ original, detected, translated, note }){
  ocrTextEl.textContent = original;
  detectedEl.textContent = detected ? `Kaynak dil: ${detected}` : "";
  translatedEl.textContent = translated;
  translationMeta.textContent = note || "";
  resultCard.hidden = false;
  resultCard.scrollIntoView({ behavior:"smooth", block:"nearest" });
}
function hideResult(){ resultCard.hidden = true; }

/* =========================================================
   DURUM / YARDIMCILAR
   ========================================================= */
function showStatus(msg, isError = false){
  statusBox.hidden = false;
  statusBox.textContent = msg;
  statusBox.style.color = isError ? "var(--danger)" : "var(--blue)";
  statusBox.style.background = isError ? "#fdecec" : "#e8eeff";
}
function hideStatus(){ statusBox.hidden = true; }

function fileToDataURL(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* =========================================================
   OLAY BAĞLAMA
   ========================================================= */
function bindEvents(){
  captureBtn.addEventListener("click", captureAndTranslate);

  galleryBtn.addEventListener("click", () => galleryInput.click());
  galleryInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleGalleryFile(file);
    galleryInput.value = "";
  });

  translateBtn.addEventListener("click", translateManualText);

  /* Enter (Ctrl/Cmd) ile çevir */
  manualText.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") translateManualText();
  });
}

/* =========================================================
   PWA — KURULUM + SERVICE WORKER
   ========================================================= */
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
      navigator.serviceWorker.register("sw.js")
        .catch(err => console.warn("SW kaydı başarısız", err));
    });
  }
}