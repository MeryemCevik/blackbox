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
let timerInterval;
let seconds = 0;
let frameCount = 0;

// Statut réseau
function updateNetworkStatus() {
    const status = navigator.onLine ? "en ligne" : "hors ligne";
    statusDiv.textContent = `Durée : ${seconds}s | Frames : ${frameCount} | Statut réseau : ${status}`;
}

// Fonction utilitaire pour afficher le status
function updateStatus(message, type = "") {
    statusDiv.textContent = message;
    statusDiv.className = type; // '' / 'status-success' / 'status-error' / 'status-warning'
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
}

// Timer
function startTimer() {
    seconds = 0;
    frameCount = 0;
    timerInterval = setInterval(updateNetworkStatus, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
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
        recordBtn.classList.add("recording");
        uploadBtn.disabled = false;

        startTimer();
    } catch (err) {
        console.error("Erreur caméra:", err);
        updateStatus("Impossible d'accéder à la caméra.", "status-error");
    }
}

// Upload
async function uploadData() {
    clearInterval(captureInterval);
    stopTimer();
    recordBtn.disabled = false;
    recordBtn.classList.remove("recording");

    mediaRecorder.stop();

    const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoName = `video_${Date.now()}.webm`;

    const { data: videoData, error: videoError } = await supabase
        .storage
        .from('videos')
        .upload(videoName, videoBlob);

    if (videoError) {
        console.error("Erreur upload vidéo:", videoError);
        updateStatus("Erreur lors de l'envoi de la vidéo. Hashes sauvegardés localement.", "status-error");
        return;
    }

    updateStatus("Vidéo uploadée avec succès !", "status-success");

    try {
        const { error: hashError } = await supabase.from('frame_hashes').insert(frameHashes);

        if (hashError) {
            console.error("Erreur insertion hashes:", hashError);
            updateStatus("Erreur lors de l'envoi des hashes. Stockage côté client activé.", "status-warning");
        } else {
            updateStatus("Hashes uploadés avec succès !", "status-success");
            tempHashes = [];
            frameHashes = [];
            recordedChunks = [];
            uploadBtn.disabled = true;
            frameCount = 0;
            seconds = 0;
        }
    } catch (err) {
        console.error(err);
    }
}

// Gestion réseau
window.addEventListener('online', async () => {
    updateNetworkStatus();
    if (tempHashes.length > 0) {
        updateStatus("Connexion réseau rétablie, envoi des hashes sauvegardés...", "status-success");
        try {
            const { error } = await supabase.from('frame_hashes').insert(tempHashes);
            if (!error) {
                tempHashes = [];
                updateStatus("Hashes temporaires uploadés avec succès !", "status-success");
            }
        } catch (err) {
            console.error("Erreur upload tempHashes:", err);
        }
    }
});

window.addEventListener('offline', updateNetworkStatus);

// Event listeners
recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
