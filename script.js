import { supabase } from "./supabaseClient.js";

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

    if (listError) { console.error("Erreur liste vidéos :", listError); return; }

    const expiredVideos = files.filter(file => {
        const match = file.name.match(/video_(\d+)\.webm/);
        if (!match) return false;
        return Number(match[1]) < Date.now() - 2 * 60 * 60 * 1000;
    });

    if (!expiredVideos.length) { console.log("Aucune vidéo expirée"); return; }

    const paths = expiredVideos.map(v => v.name);
    const { error: deleteError } = await supabase
        .storage
        .from("videos")
        .remove(paths);

    if (deleteError) console.error("Erreur suppression vidéos :", deleteError);
    else console.log(`Vidéos supprimées : ${paths.length}`);
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
let tempHashes = [];
let frameCount = 0;

// Nettoyage automatique au démarrage
cleanExpiredData();

// Statut réseau + compteur de frames
function updateStatusNetwork() {
    const status = navigator.onLine ? "en ligne" : "hors ligne";
    statusDiv.textContent = `Frames : ${frameCount} | Statut réseau : ${status}`;
}

// HASH DE LA VIDEO WEBM (au lieu de la caméra)
async function hashWebMFrames(videoBlob) {
    const url = URL.createObjectURL(videoBlob);
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.playsInline = true;

    // attendre que les métadonnées soient chargées
    await new Promise(resolve => v.onloadedmetadata = resolve);

    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");

    const fps = 2; // 1 frame toutes les 500ms
    const step = 1 / fps;

    for (let t = 0; t < v.duration; t += step) {
        v.currentTime = t;
        await new Promise(resolve => v.onseeked = resolve);

        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
        const buffer = await blob.arrayBuffer();

        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        const hashHex = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");

        frameHashes.push({ created_at: new Date().toISOString(), hash: hashHex });
        tempHashes.push({ created_at: new Date().toISOString(), hash: hashHex });

        frameCount++;
        updateStatusNetwork();
    }

    URL.revokeObjectURL(url);
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
    recordBtn.disabled = false;
    uploadBtn.disabled = true;

    const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoName = `video_${Date.now()}.webm`;

    // Upload vidéo
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

    // HASHING des frames du WebM
    await hashWebMFrames(videoBlob);

    // Upload des hashes
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
