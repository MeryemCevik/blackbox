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
let tempHashes = []; // pour stockage côté client en cas de coupure réseau
let captureInterval;
let timerInterval;
let seconds = 0;
let frameCount = 0;

// Statut réseau
function updateNetworkStatus() {
    const status = navigator.onLine ? "en ligne" : "hors ligne";
    statusDiv.textContent = `Statut réseau : ${status}`;
}

// Fonction utilitaire pour afficher le status
function updateStatus(message, type = "") {
    statusDiv.textContent = message;
    statusDiv.className = type; // '' / 'status-success' / 'status-error' / 'status-warning'
}

// Fonction pour capturer les frames et calculer le hash
async function captureFrameHash() {
    if (!video.videoWidth || !video.videoHeight) return;

    // Créer un canvas pour capturer la frame
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convertir en Blob et en ArrayBuffer pour le hash
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const buffer = await blob.arrayBuffer();

    // Calcul du hash SHA-256
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Stocker le hash temporairement
    frameHashes.push({ created_at: new Date().toISOString(), hash: hashHex });
    tempHashes.push({ created_at: new Date().toISOString(), hash: hashHex });

    frameCount++;
    updateStatus(`Frame capturée (${frameCount}) et hashée : ${hashHex.slice(0, 16)}...`);
}

// Fonction timer
function startTimer() {
    seconds = 0;
    timerInterval = setInterval(() => {
        seconds++;
        statusDiv.textContent = `Durée enregistrement : ${seconds}s | Frames : ${frameCount} | Statut réseau : ${navigator.onLine ? "en ligne" : "hors ligne"}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

// Fonction pour démarrer l'enregistrement vidéo
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.start(100); // envoie des données toutes les 100ms

        // Capture de frames toutes les 500ms
        captureInterval = setInterval(captureFrameHash, 500);

        recordBtn.disabled = true;
        recordBtn.classList.add("recording");
        uploadBtn.disabled = false;

        frameCount = 0;
        startTimer();
    } catch (err) {
        console.error("Erreur caméra:", err);
        updateStatus("Impossible d'accéder à la caméra.", "status-error");
    }
}

// Fonction pour envoyer les frames et hashs à Supabase
async function uploadData() {
    clearInterval(captureInterval);
    stopTimer();
    recordBtn.disabled = false;
    recordBtn.classList.remove("recording");

    mediaRecorder.stop();

    const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoName = `video_${Date.now()}.webm`;

    // Upload vidéo
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

    // Upload hashes
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

// Gestion des reconnections réseau
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
