import { supabase } from "./supabaseClient.js";

// Nettoyage des données expirées
async function cleanExpiredData() {
    console.log("Nettoyage des données expirées…");
    const limitDate = new Date(Date.now() - 2*60*60*1000).toISOString();

    // Supprimer les hashes expirés
    const { error: hashError } = await supabase
        .from("frame_hashes")
        .delete()
        .lt("created_at", limitDate);
    if(hashError) console.error("Erreur suppression hashes :", hashError);

    // Supprimer les vidéos expirées
    const { data: files, error: listError } = await supabase
        .storage
        .from("videos")
        .list();
    if(listError) { console.error("Erreur liste vidéos :", listError); return; }

    const expiredVideos = files.filter(f => {
        const match = f.name.match(/video_(\d+)\.webm/);
        if(!match) return false;
        return Number(match[1]) < Date.now() - 2*60*60*1000;
    });
    if(expiredVideos.length) {
        const paths = expiredVideos.map(v => v.name);
        const { error: deleteError } = await supabase
            .storage.from("videos")
            .remove(paths);
        if(deleteError) console.error("Erreur suppression vidéos :", deleteError);
        else console.log(`Vidéos supprimées : ${paths.length}`);
    }
}

// DOM
const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

// Variables
let mediaRecorder, recordedChunks = [], frameHashes = [], tempHashes = [], frameCount = 0, captureInterval;

// Nettoyage auto
cleanExpiredData();

// Mise à jour status
function updateStatusNetwork() {
    const status = navigator.onLine ? "en ligne" : "hors ligne";
    statusDiv.textContent = `Frames : ${frameCount} | Statut réseau : ${status}`;
}

// Capture hash d'une frame
async function captureFrame(videoElement) {
    if(!videoElement.videoWidth || !videoElement.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

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

// Démarrer l'enregistrement
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        mediaRecorder.ondataavailable = e => { if(e.data.size) recordedChunks.push(e.data); };
        mediaRecorder.start(100);

        // Capture hash toutes les 500ms
        captureInterval = setInterval(() => captureFrame(video), 500);

        recordBtn.disabled = true;
        uploadBtn.disabled = false;
    } catch(err) {
        console.error("Erreur caméra:", err);
        statusDiv.textContent = "Impossible d'accéder à la caméra.";
    }
}

// Upload vidéo et hashes
async function uploadData() {
    clearInterval(captureInterval);
    mediaRecorder.stop();
    recordBtn.disabled = false;
    uploadBtn.disabled = true;

    const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoName = `video_${Date.now()}.webm`;

    // Upload vidéo
    const { error: videoError } = await supabase
        .storage.from('videos')
        .upload(videoName, videoBlob);
    if(videoError) { console.error(videoError); statusDiv.textContent="Erreur upload vidéo"; return; }

    statusDiv.textContent="Vidéo uploadée !";

    // Upload hashes
    try {
        const { error: hashError } = await supabase.from('frame_hashes').insert(frameHashes);
        if(hashError) console.error(hashError);
        else { frameHashes = []; tempHashes = []; recordedChunks = []; frameCount = 0; }
    } catch(err) { console.error(err); }
}

// Gestion réseau
window.addEventListener('online', async () => {
    updateStatusNetwork();
    if(tempHashes.length) {
        try {
            const { error } = await supabase.from('frame_hashes').insert(tempHashes);
            if(!error) tempHashes = [];
        } catch(err){ console.error(err); }
    }
});
window.addEventListener('offline', updateStatusNetwork);

recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
