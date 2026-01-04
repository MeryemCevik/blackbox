import { supabase } from "./supabaseClient.js";

const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

let mediaRecorder;
let recordedChunks = [];
let frameHashes = [];
let localHashesQueue = []; // pour coupures réseau

// Accès à la caméra
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        return stream;
    } catch (err) {
        statusDiv.textContent = "Erreur caméra : " + err.message;
    }
}

// Démarrer l'enregistrement
recordBtn.addEventListener("click", async () => {
    const stream = await startCamera();
    if (!stream) return;

    recordedChunks = [];
    frameHashes = [];

    mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });

    mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.start(100); // chunk toutes les 100ms
    statusDiv.textContent = "Enregistrement en cours...";
    uploadBtn.disabled = false;

    captureFrames(stream);
});

// Capture des frames toutes les 200ms
function captureFrames(stream) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const videoTrack = stream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();
    canvas.width = settings.width;
    canvas.height = settings.height;

    const captureInterval = setInterval(async () => {
        if (mediaRecorder.state !== "recording") {
            clearInterval(captureInterval);
            return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        const hash = await generateHash(blob);

        frameHashes.push(hash);
        localHashesQueue.push({ hash, timestamp: new Date().toISOString() });
    }, 200);
}

// Fonction pour générer un hash SHA-256
async function generateHash(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Upload vidéo + frames + hashes
uploadBtn.addEventListener("click", async () => {
    uploadBtn.disabled = true;
    const videoBlob = new Blob(recordedChunks, { type: "video/webm" });
    const videoName = `videos/video_${Date.now()}.webm`;

    // Upload vidéo
    const { data: videoData, error: videoError } = await supabase.storage
        .from("videos")
        .upload(videoName, videoBlob);

    if (videoError) {
        statusDiv.textContent = "Erreur upload vidéo : " + videoError.message;
        return;
    }

    // Upload des hash
    for (let h of localHashesQueue) {
        await supabase.from("frame_hashes").insert({ hash: h.hash });
    }

    localHashesQueue = []; // reset queue
    statusDiv.textContent = "Upload terminé avec succès !";
});

// Gestion suppression données expirées côté client
function cleanOldHashes() {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const now = new Date();
    frameHashes = frameHashes.filter(f => now - new Date(f.timestamp) < TWO_HOURS);
}

setInterval(cleanOldHashes, 60 * 1000); // nettoyage toutes les 1 min
