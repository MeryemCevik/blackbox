import { supabase } from "./supabaseClient.js";

// DOM Elements
const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

// Variables
let mediaRecorder;
let recordedChunks = [];
let frameHashes = [];       // Hashes prêts à envoyer
let tempHashes = [];        // Hashes côté client si offline
let captureInterval;
let frameCount = 0;

// D-Hash 9x8
const DHASH_WIDTH = 9;
const DHASH_HEIGHT = 8;

// -------------------------------
// Met à jour le statut réseau et compteur de frames
// -------------------------------
function updateStatusNetwork() {
    const status = navigator.onLine ? "en ligne" : "hors ligne";
    statusDiv.textContent = `Frames: ${frameCount} | Hashes prêts: ${frameHashes.length} | TempHashes: ${tempHashes.length} | Statut réseau: ${status}`;
}

// -------------------------------
// Calcul D-Hash pour une frame
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
// Capture frame, calcule hash et transmet dynamiquement
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
    tempHashes.push(hashObj); // toujours garder côté client pour offline

    frameCount++;
    updateStatusNetwork();

    // -------------------------------
    // Transmission dynamique
    // -------------------------------
    if (navigator.onLine) {
        try {
            const { error } = await supabase.from('frame_hashes').insert([hashObj]);
            if (!error) {
                // Si envoyé avec succès, on peut le retirer de frameHashes
                frameHashes.shift();
                console.log(`✅ Frame envoyée dynamiquement: ${dHash}`);
            } else {
                console.warn("⚠️ Erreur envoi frame dynamique:", error);
            }
        } catch (err) {
            console.error("⚠️ Exception envoi frame dynamique:", err);
        }
    } else {
        console.log(`📌 Frame stockée localement (offline): ${dHash}`);
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
        console.log("🎬 Enregistrement démarré");
    } catch (err) {
        console.error("Erreur caméra:", err);
        statusDiv.textContent = "Impossible d'accéder à la caméra.";
    }
}

// -------------------------------
// Upload complet (video + hashes restants)
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
        statusDiv.textContent = "Erreur lors de l'envoi de la vidéo. Hashes sauvegardés localement.";
        return;
    }
    console.log(`✅ Vidéo uploadée: ${videoName}`);
    statusDiv.textContent = "Vidéo uploadée avec succès !";

    // Upload des hashes restants
    if (frameHashes.length > 0) {
        try {
            const { error: hashError } = await supabase.from('frame_hashes').insert(frameHashes);
            if (!hashError) {
                console.log(`✅ ${frameHashes.length} hashes restants envoyés`);
                frameHashes = [];
                tempHashes = [];
            } else {
                console.warn("⚠️ Erreur upload hashes restants:", hashError);
            }
        } catch (err) {
            console.error("⚠️ Exception upload hashes restants:", err);
        }
    }

    // Reset
    recordedChunks = [];
    frameCount = 0;
    updateStatusNetwork();
}

// -------------------------------
// Gestion réseau dynamique
// -------------------------------
window.addEventListener('online', async () => {
    updateStatusNetwork();
    console.log("Connexion rétablie");

    if (tempHashes.length > 0) {
        statusDiv.textContent = "Connexion rétablie, envoi des hashes sauvegardés...";
        try {
            const { error } = await supabase.from('frame_hashes').insert(tempHashes);
            if (!error) {
                console.log(`✅ ${tempHashes.length} hashes temporaires envoyés`);
                tempHashes = [];
            }
        } catch (err) {
            console.error("⚠️ Erreur upload tempHashes:", err);
        }
    }
});

window.addEventListener('offline', () => {
    updateStatusNetwork();
    console.log("🔌 Hors ligne");
});

// -------------------------------
// Event listeners
// -------------------------------
recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
