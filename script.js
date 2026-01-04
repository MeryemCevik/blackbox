import { supabase } from "./supabaseClient.js";

/* =========================
   NETTOYAGE DES DONNÉES
   =========================
async function cleanExpiredData() {
    const limitDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    await supabase.from("frame_hashes").delete().lt("created_at", limitDate);

    const { data: files } = await supabase.storage.from("videos").list();
    if (!files) return;

    const expired = files.filter(f => {
        const m = f.name.match(/video_(\d+)\.mp4/);
        return m && Number(m[1]) < Date.now() - 2 * 60 * 60 * 1000;
    });

    if (expired.length) {
        await supabase.storage.from("videos").remove(expired.map(f => f.name));
    }
}
 */
/* =========================
   DOM
   ========================= */
const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

/* =========================
   VARIABLES
   ========================= */
let mediaRecorder;
let recordedChunks = [];
let frameHashes = [];
let tempHashes = [];
let captureInterval;
let frameCount = 0;

// cleanExpiredData();

/* =========================
   STATUS
   ========================= */
function updateStatus() {
    statusDiv.textContent = `Frames : ${frameCount} | Réseau : ${navigator.onLine ? "OK" : "OFF"}`;
}

/* =========================
   CAPTURE + HASH (STABLE)
   ========================= */
async function captureFrameHash() {
    if (!video.videoWidth) return;

    // NORMALISATION STRICTE
    const SIZE = 128;

    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, SIZE, SIZE);

    // GRAYSCALE (clé pour stabilité)
    const img = ctx.getImageData(0, 0, SIZE, SIZE);
    for (let i = 0; i < img.data.length; i += 4) {
        const g = img.data[i] * 0.299 + img.data[i+1] * 0.587 + img.data[i+2] * 0.114;
        img.data[i] = img.data[i+1] = img.data[i+2] = g;
    }
    ctx.putImageData(img, 0, 0);

    const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
    const buffer = await blob.arrayBuffer();

    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashHex = [...new Uint8Array(hashBuffer)]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

    const entry = { created_at: new Date().toISOString(), hash: hashHex };
    frameHashes.push(entry);
    tempHashes.push(entry);

    frameCount++;
    updateStatus();
}

/* =========================
   RECORD
   ========================= */
async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;

    let mimeType = "video/mp4; codecs=avc1";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        console.warn("MP4 non supporté → fallback WebM");
        mimeType = "video/webm";
    }

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = e => e.data.size && recordedChunks.push(e.data);
    mediaRecorder.start(100);

    captureInterval = setInterval(captureFrameHash, 500);

    recordBtn.disabled = true;
    uploadBtn.disabled = false;
}

/* =========================
   UPLOAD
   ========================= */
async function uploadData() {
    clearInterval(captureInterval);
    mediaRecorder.stop();

    const ext = mediaRecorder.mimeType.includes("mp4") ? "mp4" : "webm";
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
    const name = `video_${Date.now()}.${ext}`;

    await supabase.storage.from("videos").upload(name, blob);
    await supabase.from("frame_hashes").insert(frameHashes);

    recordedChunks = [];
    frameHashes = [];
    tempHashes = [];
    frameCount = 0;

    recordBtn.disabled = false;
    uploadBtn.disabled = true;
}

/* =========================
   RÉSEAU
   ========================= */
window.addEventListener("online", async () => {
    updateStatus();
    if (tempHashes.length) {
        await supabase.from("frame_hashes").insert(tempHashes);
        tempHashes = [];
    }
});

window.addEventListener("offline", updateStatus);

/* =========================
   EVENTS
   ========================= */
recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
