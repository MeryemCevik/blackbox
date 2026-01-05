import { supabase } from "./supabaseClient.js";

// -------------------------------
// DOM Elements
// -------------------------------
const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

// -------------------------------
// Variables globales
// -------------------------------
let mediaRecorder;
let recordedChunks = [];
let frameHashes = [];   // Hashes prêts à être envoyés au serveur
let tempHashes = [];    // Stockage côté client en cas de coupure réseau
let captureInterval;
let frameCount = 0;

// D-Hash 9x8
const DHASH_WIDTH = 9;
const DHASH_HEIGHT = 8;

// -------------------------------
// Statut réseau et compteur de frames
// -------------------------------
function updateStatusNetwork() {
    const status = navigator.onLine ? "en ligne" : "hors ligne";
    statusDiv.textContent = `Frames : ${frameCount} | Statut réseau : ${status}`;
}

// -------------------------------
// Calcul D-Hash d'une frame
// -------------------------------
async function computeDHash(canvas) {
    const ctx = canvas.getContext("2d");
    const imgData = ctx.getImageData(0, 0, DHASH_WIDTH, DHASH_HEIGHT);
    let hash = "";
    for (let y = 0; y < DHASH_HEIGHT; y++) {
        for (let x = 0; x < DHASH_WIDTH - 1; x++) {
            const idx = (y * DHASH_WIDTH + x) * 4;
            const lum1 = 0.299 * imgData.data[idx] + 0.587 * imgData.data[idx + 1] + 0.114 * imgData.data[idx + 2];
            const idx2 = (y * DHASH_WIDTH + x + 1) * 4;
            const lum2 = 0.299 * imgData.data[idx2] + 0.587 * imgData.data[idx2 + 1] + 0.114 * imgData.data[idx2 + 2];
            hash += lum1 > lum2 ? "1" : "0";
        }
    }
    return hash;
}

// -------------------------------
// Capture une frame, calcule hash et envoie dynamique
// -------------------------------
async function captureFrameHash() {
    if (!video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = DHASH_WIDTH;
    canvas.height = DHASH_HEIGHT;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, DHASH_WIDTH, DHASH_HEIGHT);

    const dHash = await computeDHash(canvas);
    const timestamp = new Date().toISOString();

    const frame = { created_at: timestamp, hash: dHash };
    frameHashes.push(frame);
    tempHashes.push(frame);

    frameCount++;
    updateStatusNetwork();

    // -------------------------------
    // Transmission dynamique des hashes
    // -------------------------------
    if (navigator.onLine && frameHashes.length >= 5) { // envoyer par paquets de 5 frames
        try {
            const { error } = await supabase.from('frame_hashes').insert(frameHashes);
            if (!error) {
                frameHashes = []; // reset du paquet envoyé
            } else {
                console.error("Erreur envoi dynamique :", error);
            }
        } catch (err) {
            console.error("Exception envoi dynamique :", err);
        }
    }
}

// -------------------------------
// Démarrage de l'enregistrement
// -------------------------------
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.start(100);

        captureInterval = setInterval(captureFrameHash, 500); // 2 frames/sec

        recordBtn.disabled = true;
        uploadBtn.disabled = false;
    } catch (err) {
        console.error("Erreur caméra:", err);
        statusDiv.textContent = "Impossible d'accéder à la caméra.";
    }
}

// -------------------------------
// Upload final vidéo + hashes restants
// -------------------------------
async function uploadData() {
    clearInterval(captureInterval);
    mediaRecorder.stop();
    recordBtn.disabled = false;
    uploadBtn.disabled = true;

    // Upload vidéo
    const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoName = `video_${Date.now()}.webm`;
    const { error: videoError } = await supabase.storage.from('videos').upload(videoName, videoBlob);

    if (videoError) {
        console.error("Erreur upload vidéo:", videoError);
        statusDiv.textContent = "Erreur lors de l'envoi de la vidéo. Hashes sauvegardés localement.";
        return;
    }

    statusDiv.textContent = "Vidéo uploadée avec succès !";

    // Upload des hashes restants
    if (frameHashes.length > 0) {
        try {
            const { error: hashError } = await supabase.from('frame_hashes').insert(frameHashes);
            if (hashError) {
                console.error("Erreur insertion hashes :", hashError);
            }
        } catch (err) { console.error(err); }
    }

    // Reset local
    tempHashes = [];
    frameHashes = [];
    recordedChunks = [];
    frameCount = 0;
}

// -------------------------------
// Gestion réseau pour envoyer les hashes temporaires
// -------------------------------
window.addEventListener('online', async () => {
    updateStatusNetwork();
    if (tempHashes.length > 0) {
        statusDiv.textContent = "Connexion rétablie, envoi des hashes sauvegardés...";
        try {
            const { error } = await supabase.from('frame_hashes').insert(tempHashes);
            if (!error) {
                tempHashes = [];
                statusDiv.textContent = "Hashes temporaires uploadés avec succès !";
            }
        } catch (err) {
            console.error("Erreur upload tempHashes:", err);
        }
    }
});

window.addEventListener('offline', updateStatusNetwork);

// -------------------------------
// Event listeners
// -------------------------------
recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
