import { supabase } from "./supabaseClient.js";

// ============================
// DOM
// ============================
const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

// ============================
// Variables globales
// ============================
let mediaRecorder;
let recordedChunks = [];
let frameHashes = [];    // Hashes à envoyer
let tempHashes = [];     // Stockage temporaire en cas de coupure réseau
let captureInterval;
let frameCount = 0;

// D-Hash 9x8
const DHASH_WIDTH = 9;
const DHASH_HEIGHT = 8;

// ============================
// Calcul D-Hash
// ============================
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

// ============================
// Capture d'une frame
// ============================
async function captureFrame() {
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
    tempHashes.push(frame);  // Pour stockage en cas de coupure réseau

    frameCount++;
    statusDiv.textContent = `Frames : ${frameCount}`;

    // ============================
    // Envoi dynamique de la frame
    // ============================
    try {
        const { error } = await supabase.from("frame_hashes").insert([frame]);
        if (error) throw error;
        // Si succès, retirer du stockage temporaire
        tempHashes = tempHashes.filter(f => f !== frame);
    } catch (err) {
        console.warn("Erreur réseau, frame stockée localement", err);
        // Frame reste dans tempHashes pour renvoi ultérieur
    }
}

// ============================
// Gestion reconnexion réseau
// ============================
async function sendPendingFrames() {
    if (tempHashes.length === 0) return;
    const pending = [...tempHashes]; // Copie pour éviter mutation pendant envoi

    try {
        const { error } = await supabase.from("frame_hashes").insert(pending);
        if (!error) {
            tempHashes = []; // Vidage du stockage temporaire
            console.log("Frames en attente envoyées avec succès");
        }
    } catch (err) {
        console.warn("Toujours pas de réseau, frames restent en attente", err);
    }
}

// Vérification réseau toutes les 10s
setInterval(sendPendingFrames, 10000);

// ============================
// Start Recording
// ============================
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;

        mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.start(100);

        captureInterval = setInterval(captureFrame, 500); // 2 frames/sec

        recordBtn.disabled = true;
        uploadBtn.disabled = false;
    } catch (err) {
        console.error("Erreur caméra :", err);
        statusDiv.textContent = "Impossible d'accéder à la caméra";
    }
}

// ============================
// Upload vidéo final
// ============================
async function uploadData() {
    clearInterval(captureInterval);
    mediaRecorder.stop();
    recordBtn.disabled = false;
    uploadBtn.disabled = true;

    const videoBlob = new Blob(recordedChunks, { type: "video/webm" });
    const videoName = `video_${Date.now()}.webm`;

    try {
        const { error } = await supabase.storage.from("videos").upload(videoName, videoBlob);
        if (error) throw error;

        // Tentative d'envoi des frames restantes
        await sendPendingFrames();

        // Reset local
        tempHashes = [];
        frameHashes = [];
        recordedChunks = [];
        frameCount = 0;
        statusDiv.textContent = "Vidéo et hashes uploadés avec succès";
    } catch (err) {
        console.error("Erreur upload vidéo :", err);
        statusDiv.textContent = "Erreur vidéo, hashes sauvegardés localement";
    }
}

// ============================
// Nettoyage automatique (>2h)
// ============================
async function cleanExpiredData() {
    console.log("Nettoyage des données expirées…");

    const limitDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // 1) Supprimer hashes expirés
    const { error: hashError } = await supabase
        .from("frame_hashes")
        .delete()
        .lt("created_at", limitDate);
    if (hashError) console.error("Erreur suppression hashes :", hashError);
    else console.log("Hashes expirés supprimés");

    // 2) Supprimer vidéos expirées
    const { data: files, error: listError } = await supabase.storage.from("videos").list();
    if (listError) { console.error("Erreur liste vidéos :", listError); return; }

    const expiredVideos = files.filter(file => {
        const match = file.name.match(/video_(\d+)\.webm/);
        if (!match) return false;
        const timestamp = Number(match[1]);
        return timestamp < Date.now() - 2 * 60 * 60 * 1000;
    });

    if (expiredVideos.length > 0) {
        const paths = expiredVideos.map(v => v.name);
        const { error: deleteError } = await supabase.storage.from("videos").remove(paths);
        if (deleteError) console.error("Erreur suppression vidéos :", deleteError);
        else console.log(`Vidéos supprimées : ${paths.length}`);
    } else console.log("Aucune vidéo expirée");
}

// Nettoyage automatique toutes les heures
setInterval(cleanExpiredData, 60 * 60 * 1000);

// ============================
// Events
// ============================
recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
