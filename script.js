import { supabase } from "./supabaseClient.js";

/* =========================
   NETTOYAGE DONNÉES EXPIRÉES
   ========================= */
async function cleanExpiredData() {
    console.log("[ENCODEUR] Nettoyage données expirées…");

    const limitDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { error: hashError } = await supabase
        .from("frame_hashes")
        .delete()
        .lt("created_at", limitDate);
    if (hashError) console.error("[ENCODEUR] Erreur suppression hashes :", hashError);

    const { data: files, error: listError } = await supabase.storage.from("videos").list();
    if (listError) return console.error("[ENCODEUR] Erreur liste vidéos :", listError);

    const expired = files.filter(f => {
        const m = f.name.match(/video_(\d+)\.webm/);
        return m && Number(m[1]) < Date.now() - 2 * 60 * 60 * 1000;
    });

    if (expired.length) {
        await supabase.storage.from("videos").remove(expired.map(f => f.name));
        console.log(`[ENCODEUR] ${expired.length} vidéos supprimées`);
    }
}

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
let frameCount = 0;

cleanExpiredData();

/* =========================
   HASH CANVAS
   ========================= */
async function hashCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    // récupère les pixels (RGBA)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buffer = imageData.data.buffer;
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

/* =========================
   CAPTURE FRAME
   ========================= */
async function captureFrameHash() {
    if (!video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, 32, 32);

    const hash = await hashCanvas(canvas);

    frameHashes.push({
        created_at: new Date().toISOString(),
        hash
    });

    frameCount++;
    console.log(`[ENCODEUR] Frame ${frameCount} → ${hash.slice(0, 16)}…`);
    statusDiv.textContent = `Frames : ${frameCount}`;
}

/* =========================
   ENREGISTREMENT
   ========================= */
async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;

    mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
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

    const videoBlob = new Blob(recordedChunks, { type: "video/webm" });
    const videoName = `video_${Date.now()}.webm`;

    await supabase.storage.from("videos").upload(videoName, videoBlob);
    await supabase.from("frame_hashes").insert(frameHashes);

    console.log("[ENCODEUR] Upload terminé !");
    frameHashes = [];
    recordedChunks = [];
    frameCount = 0;

    recordBtn.disabled = false;
    uploadBtn.disabled = true;
}

recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
