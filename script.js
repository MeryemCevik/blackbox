import { supabase } from "./supabaseClient.js";

/* =========================
   NETTOYAGE DES DONNÉES
   ========================= */
async function cleanExpiredData() {
    const limitDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    await supabase.from("frame_hashes").delete().lt("created_at", limitDate);

    const { data: files } = await supabase.storage.from("videos").list();
    const expired = files.filter(f => {
        const m = f.name.match(/video_(\d+)\.webm/);
        return m && Number(m[1]) < Date.now() - 2 * 60 * 60 * 1000;
    });

    if (expired.length) {
        await supabase.storage.from("videos").remove(expired.map(f => f.name));
    }
}

cleanExpiredData();

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
let frameCount = 0;

/* =========================
   ENREGISTREMENT VIDÉO
   ========================= */
async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;

    recordedChunks = [];

    mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    mediaRecorder.ondataavailable = e => e.data.size && recordedChunks.push(e.data);
    mediaRecorder.start();

    recordBtn.disabled = true;
    uploadBtn.disabled = false;
}

/* =========================
   EXTRACTION DES FRAMES DU WEBM
   ========================= */
async function extractAndHashFrames(videoBlob) {
    const url = URL.createObjectURL(videoBlob);
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;

    await v.play();
    await new Promise(r => v.onloadedmetadata = r);

    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");

    const fps = 2; // 1 frame toutes les 500ms
    const step = 1 / fps;

    for (let t = 0; t < v.duration; t += step) {
        v.currentTime = t;
        await new Promise(r => v.onseeked = r);

        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
        const buffer = await blob.arrayBuffer();

        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        const hash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");

        frameHashes.push({
            hash,
            timestamp: Number(t.toFixed(2)),
            created_at: new Date().toISOString()
        });

        frameCount++;
        statusDiv.textContent = `Frames hashées : ${frameCount}`;
    }

    URL.revokeObjectURL(url);
}

/* =========================
   UPLOAD VIDÉO + HASHES
   ========================= */
async function uploadData() {
    mediaRecorder.stop();
    recordBtn.disabled = false;
    uploadBtn.disabled = true;

    const videoBlob = new Blob(recordedChunks, { type: "video/webm" });
    const videoName = `video_${Date.now()}.webm`;

    await extractAndHashFrames(videoBlob);

    await supabase.storage.from("videos").upload(videoName, videoBlob);
    const { error } = await supabase.from("frame_hashes").insert(frameHashes);

    if (error) {
        tempHashes.push(...frameHashes);
        statusDiv.textContent = "Erreur réseau, hashes stockés localement";
    } else {
        statusDiv.textContent = "Vidéo + hashes envoyés avec succès";
        frameHashes = [];
        frameCount = 0;
    }
}

/* =========================
   RÉSEAU
   ========================= */
window.addEventListener("online", async () => {
    if (tempHashes.length) {
        await supabase.from("frame_hashes").insert(tempHashes);
        tempHashes = [];
    }
});

/* =========================
   EVENTS
   ========================= */
recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
