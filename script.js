
import { supabase } from "./supabaseClient.js";

// Nettoyage des données expirées (> 2 heures)
async function cleanExpiredData() {
    console.log("Nettoyage des données expirées…");

    const limitDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    /* =========================
       1) SUPPRESSION DES HASHES
       ========================= */
    const { error: hashError } = await supabase
        .from("frame_hashes")
        .delete()
        .lt("created_at", limitDate);

    if (hashError) {
        console.error("Erreur suppression hashes :", hashError);
    } else {
        console.log("Hashes expirés supprimés");
    }

    /* =========================
       2) SUPPRESSION DES VIDÉOS
       ========================= */
    const { data: files, error: listError } = await supabase
        .storage
        .from("videos")
        .list();

    if (listError) {
        console.error("Erreur liste vidéos :", listError);
        return;
    }

    const expiredVideos = files.filter(file => {
        // video_1699999999999.webm
        const match = file.name.match(/video_(\d+)\.webm/);
        if (!match) return false;

        const timestamp = Number(match[1]);
        return timestamp < Date.now() - 2 * 60 * 60 * 1000;
    });

    if (expiredVideos.length === 0) {
        console.log("Aucune vidéo expirée");
        return;
    }

    const paths = expiredVideos.map(v => v.name);

    const { error: deleteError } = await supabase
        .storage
        .from("videos")
        .remove(paths);

    if (deleteError) {
        console.error("Erreur suppression vidéos :", deleteError);
    } else {
        console.log(`Vidéos supprimées : ${paths.length}`);
    }
}

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

// Nettoyage automatique au démarrage
cleanExpiredData();

// Statut réseau + compteur de frames
function updateStatusNetwork() {
    const status = navigator.onLine ? "en ligne" : "hors ligne";
    statusDiv.textContent = `Frames : ${frameCount} | Statut réseau : ${status}`;
}

// Fonction pour capturer les frames et calculer le hash
async function captureFrameHash() {
    if (!video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const buffer = await blob.arrayBuffer();

    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Stockage des hashes
    frameHashes.push({ created_at: new Date().toISOString(), hash: hashHex });
    tempHashes.push({ created_at: new Date().toISOString(), hash: hashHex });

    frameCount++;
    updateStatusNetwork(); // mise à jour du compteur à chaque frame
}

// Démarrer l'enregistrement
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.start(100);

        captureInterval = setInterval(captureFrameHash, 500);

        recordBtn.disabled = true;
        uploadBtn.disabled = false;
    } catch (err) {
        console.error("Erreur caméra:", err);
        statusDiv.textContent = "Impossible d'accéder à la caméra.";
    }
}

// Upload
async function uploadData() {
    clearInterval(captureInterval);

    mediaRecorder.stop();
    recordBtn.disabled = false;
    uploadBtn.disabled = true;

    const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoName = `video_${Date.now()}.webm`;

    const { data: videoData, error: videoError } = await supabase
        .storage
        .from('videos')
        .upload(videoName, videoBlob);

    if (videoError) {
        console.error("Erreur upload vidéo:", videoError);
        statusDiv.textContent = "Erreur lors de l'envoi de la vidéo. Hashes sauvegardés localement.";
        return;
    }

    statusDiv.textContent = "Vidéo uploadée avec succès !";

    try {
        const { error: hashError } = await supabase.from('frame_hashes').insert(frameHashes);

        if (hashError) {
            console.error("Erreur insertion hashes:", hashError);
            statusDiv.textContent = "Erreur lors de l'envoi des hashes. Stockage côté client activé.";
        } else {
            statusDiv.textContent = "Hashes uploadés avec succès !";
            tempHashes = [];
            frameHashes = [];
            recordedChunks = [];
            frameCount = 0;
        }
    } catch (err) {
        console.error(err);
    }
}



// Gestion réseau
window.addEventListener('online', async () => {
    updateStatusNetwork();
    if (tempHashes.length > 0) {
        statusDiv.textContent = "Connexion réseau rétablie, envoi des hashes sauvegardés...";
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

// Event listeners
recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
