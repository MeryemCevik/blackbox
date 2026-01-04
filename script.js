import { supabase } from "./supabaseClient.js";
/*
// Nettoyage des données expirées (> 2 heures)
async function cleanExpiredData() {
    console.log("Nettoyage des données expirées…");

    const limitDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // Suppression des hashes
    const { error: hashError } = await supabase
        .from("frame_hashes")
        .delete()
        .lt("created_at", limitDate);

    if (hashError) console.error("Erreur suppression hashes :", hashError);
    else console.log("Hashes expirés supprimés");

    // Suppression des vidéos
    const { data: files, error: listError } = await supabase
        .storage
        .from("videos")
        .list();

    if (listError) {
        console.error("Erreur liste vidéos :", listError);
        return;
    }

    const expiredVideos = files.filter(file => {
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
    const { error: deleteError } = await supabase.storage.from("videos").remove(paths);
    if (deleteError) console.error("Erreur suppression vidéos :", deleteError);
    else console.log(`Vidéos supprimées : ${paths.length}`);
}
*/
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

// Statut réseau + compteur de frames
function updateStatusNetwork(count) {
    const status = navigator.onLine ? "en ligne" : "hors ligne";
    statusDiv.textContent = `Frames : ${count} | Statut réseau : ${status}`;
}

// Nouvelle fonction : extraction des frames de la vidéo Blob et hash
async function hashVideoBlob(videoBlob) {
    return new Promise((resolve) => {
        const offscreenVideo = document.createElement("video");
        offscreenVideo.src = URL.createObjectURL(videoBlob);
        offscreenVideo.muted = true;
        offscreenVideo.play();

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        let hashes = [];
        let frameIndex = 0;

        offscreenVideo.addEventListener("loadedmetadata", () => {
            canvas.width = offscreenVideo.videoWidth;
            canvas.height = offscreenVideo.videoHeight;
        });

        offscreenVideo.addEventListener("timeupdate", async () => {
            ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
            const buffer = await blob.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            hashes.push({ created_at: new Date().toISOString(), hash: hashHex, frame_index: frameIndex });
            frameIndex++;
            updateStatusNetwork(frameIndex);
        });

        offscreenVideo.addEventListener("ended", () => resolve(hashes));
    });
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

        recordBtn.disabled = true;
        uploadBtn.disabled = false;
    } catch (err) {
        console.error("Erreur caméra:", err);
        statusDiv.textContent = "Impossible d'accéder à la caméra.";
    }
}

// Upload
async function uploadData() {
    mediaRecorder.stop();
    recordBtn.disabled = false;
    uploadBtn.disabled = true;

    const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoName = `video_${Date.now()}.webm`;

    // Upload vidéo brute
    const { error: videoError } = await supabase.storage.from('videos').upload(videoName, videoBlob);
    if (videoError) {
        console.error("Erreur upload vidéo:", videoError);
        statusDiv.textContent = "Erreur lors de l'envoi de la vidéo.";
        return;
    }

    // Extraction et hash des frames depuis la vidéo enregistrée
    statusDiv.textContent = "Extraction des frames et hash...";
    frameHashes = await hashVideoBlob(videoBlob);

    try {
        const { error: hashError } = await supabase.from('frame_hashes').insert(frameHashes);
        if (!hashError) {
            tempHashes = [];
            recordedChunks = [];
            statusDiv.textContent = "Vidéo et hashes uploadés avec succès !";
        } else console.error("Erreur insertion hashes:", hashError);
    } catch (err) {
        console.error(err);
    }
}

// Gestion réseau
window.addEventListener('online', async () => {
    if (tempHashes.length > 0) {
        try {
            const { error } = await supabase.from('frame_hashes').insert(tempHashes);
            if (!error) tempHashes = [];
        } catch (err) {
            console.error(err);
        }
    }
});

// Event listeners
recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
