const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const captureBtn = document.getElementById('captureBtn');
const galleryInput = document.getElementById('galleryInput');
const targetLanguageSelect = document.getElementById('targetLanguage');
const sourceTextEl = document.getElementById('sourceText');
const translatedTextEl = document.getElementById('translatedText');
const statusEl = document.getElementById('status');
const manualTextEl = document.getElementById('manualText');
const translateManualBtn = document.getElementById('translateManualBtn');

// 1. Kamerayı Başlat (Arka Kamera Öncelikli - Pixel 7 uyumlu)
async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { exact: "environment" } }
        });
        video.srcObject = stream;
    } catch (err) {
        // Eğer arka kamera zorlaması hata verirse varsayılan kamerayı aç
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = stream;
        } catch (e) {
            statusEl.textContent = "Kamera erişimi sağlanamadı! Lütfen izin verin.";
        }
    }
}

// 2. OCR İşlemi (Tesseract.js - On Device)
async function processImage(imageSource) {
    statusEl.textContent = "Metin taranıyor (OCR çalışıyor)...";
    sourceTextEl.textContent = "...";
    translatedTextEl.textContent = "...";

    try {
        // 'eng+tur' veya otomatik dil tespiti için ek dil paketleri eklenebilir. 
        // Tesseract varsayılan olarak İngilizce kullanır, geniş kapsam için ek diller otomatik indirilir.
        const { data: { text } } = await Tesseract.recognize(
            imageSource,
            'eng+tur',
            { 
                logger: m => {
                    if (m.status === 'recognizing text') {
                        statusEl.textContent = `İşleniyor: %${Math.round(m.progress * 100)}`;
                    }
                }
            }
        );

        const cleanText = text.trim();
        if (!cleanText) {
            statusEl.textContent = "Görselde okunabilir metin bulunamadı.";
            sourceTextEl.textContent = "-";
            translatedTextEl.textContent = "-";
            return;
        }

        sourceTextEl.textContent = cleanText;
        statusEl.textContent = "Çevriliyor...";
        await translateText(cleanText);

    } catch (error) {
        statusEl.textContent = "OCR sırasında hata oluştu.";
        console.error(error);
    }
}

// 3. API Anahtarsız Ücretsiz Çeviri (MyMemory API)
async function translateText(text) {
    const targetLang = targetLanguageSelect.value;
    try {
        const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`);
        const data = await response.json();
        
        if (data && data.responseData) {
            translatedTextEl.textContent = data.responseData.translatedText;
            statusEl.textContent = "Çeviri tamamlandı.";
        } else {
            translatedTextEl.textContent = "Çeviri alınamadı.";
            statusEl.textContent = "";
        }
    } catch (error) {
        statusEl.textContent = "Çeviri sunucusuna bağlanılamadı.";
        console.error(error);
    }
}

// Olay Dinleyicileri
captureBtn.addEventListener('click', () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const imageUrl = canvas.toDataURL('image/png');
    processImage(imageUrl);
});

galleryInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            processImage(e.target.result);
        };
        reader.readAsDataURL(file);
    }
});

translateManualBtn.addEventListener('click', () => {
    const text = manualTextEl.value.trim();
    if (text) {
        sourceTextEl.textContent = text;
        statusEl.textContent = "Çevriliyor...";
        translateText(text);
    }
});

// PWA Service Worker Kaydı
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker Kayıtlı:', reg.scope))
            .catch(err => console.log('Service Worker Hatası:', err));
    });
}

// Uygulama açılışında kamerayı başlat
initCamera();