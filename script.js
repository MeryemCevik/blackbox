import { supabase } from "./supabaseClient.js";

// DOM Elements
const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

// Variables
let mediaRecorder;
let recordedChunks = [];
let frameHashes = [];
let tempHashes = []; // stockage côté client en cas de coupure réseau
let captureInterval;
let frameCount = 0;

// D-Hash 9x8
const DHASH_WIDTH = 9;
const DHASH_HEIGHT = 8;

// Statut réseau + compteur de frames
function updateStatusNetwork() {
    const status = navigator.onLine ? "en ligne" : "hors ligne";
    statusDiv.textContent = `Frames : ${frameCount} | Statut réseau : ${status}`;
}

// -------------------------------
// Calcul D-Hash
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
// Envoi dynamique d'un hash au serveur
// -------------------------------
async function sendHashDynamic(hashObj) {
    if (!navigator.onLine) {
        // Si hors ligne, stocke temporairement
        tempHashes.push(hashObj);
        console.log("Hors ligne → hash stocké temporairement :", hashObj);
        return;
    }

    try {
        const { error } = await supabase.from('frame_hashes').insert([hashObj]);
        if (error) {
            console.error("Erreur upload hash :", error);
            tempHashes.push(hashObj); // sauvegarde côté client si erreur
        } else {
            console.log("Hash envoyé dynamiquement :", hashObj);
        }
    } catch (err) {
        console.error("Exception lors de l'envoi du hash :", err);
        tempHashes.push(hashObj);
    }
}

// -------------------------------
// Capture frame et calcul hash
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

    const hashObj = { created_at: timestamp, hash: dHash };
    frameHashes.push(hashObj);

    // Envoi dynamique
    await sendHashDynamic(hashObj);

    frameCount++;
    updateStatusNetwork();
}

// -------------------------------
// Démarrer l'enregistrement
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
// Upload vidéo
// -------------------------------
async function uploadData() {
    clearInterval(captureInterval);
    mediaRecorder.stop();
    recordBtn.disabled = false;
    uploadBtn.disabled = true;

    const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoName = `video_${Date.now()}.webm`;

    // Upload vidéo
    const { error: videoError } = await supabase.storage.from('videos').upload(videoName, videoBlob);
    if (videoError) {
        console.error("Erreur upload vidéo:", videoError);
        statusDiv.textContent = "Erreur lors de l'envoi de la vidéo. Hashes déjà envoyés dynamiquement.";
        return;
    }

    statusDiv.textContent = "Vidéo uploadée avec succès !";
    recordedChunks = [];
    frameHashes = [];
    frameCount = 0;
}

// -------------------------------
// Gestion réseau
// -------------------------------
window.addEventListener('online', async () => {
    updateStatusNetwork();
    if (tempHashes.length > 0) {
        statusDiv.textContent = "Connexion rétablie, envoi des hashes sauvegardés...";
        console.log("Envoi des hashes temporaires :", tempHashes.length);
        for (const hashObj of tempHashes) {
            await sendHashDynamic(hashObj);
        }
        tempHashes = [];
    }
});

window.addEventListener('offline', updateStatusNetwork);

// -------------------------------
// Event listeners
// -------------------------------
recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
