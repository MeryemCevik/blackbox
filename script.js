import { supabase } from "./supabaseClient.js";

// DOM Elements
const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");
const frameCountEl = document.getElementById("frameCount");
const recordTimeEl = document.getElementById("recordTime");
const videoStatusEl = document.getElementById("videoStatus");
const networkStatusEl = document.getElementById("networkStatus");

// Variables
let mediaRecorder;
let recordedChunks = [];
let frameHashes = [];
let tempHashes = [];
let captureInterval;
let startTime;
let timerInterval;
let framesCaptured = 0;

// Status update utilitaire
function updateStatus(message, type = "success") {
    statusDiv.textContent = message;
    statusDiv.className = type === "success" ? "status-success" : type === "error" ? "status-error" : "status-warning";
}

// Timer pour durée enregistrement
function startTimer() {
    startTime = Date.now();
    timerInterval = setInterval(() => {
        const seconds = Math.floor((Date.now() - startTime) / 1000);
        recordTimeEl.textContent = seconds;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

// Capture frame et hash
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

    frameHashes.push({ created_at: new Date().toISOString(), hash: hashHex });
    tempHashes.push({ created_at: new Date().toISOString(), hash: hashHex });

    framesCaptured++;
    frameCountEl.textContent = framesCaptured;
    updateStatus(`Frame capturée et hashée : ${hashHex.slice(0, 16)}...`);
}

// Démarrer l'enregistrement
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.start(100);

        captureInterval = setInterval(captureFrameHash, 500);
        startTimer();

        recordBtn.disabled = true;
        uploadBtn.disabled = false;
        recordBtn.classList.add("recording");
        updateStatus("Enregistrement en cours...");
    } catch (err) {
        console.error("Erreur caméra:", err);
        updateStatus("Impossible d'accéder à la caméra.", "error");
    }
}

// Upload vidéo + hashes
async function uploadData() {
    clearInterval(captureInterval);
    stopTimer();
    mediaRecorder.stop();
    recordBtn.classList.remove("recording");

    const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoName = `video_${Date.now()}.webm`;

    const { error: videoError } = await supabase.storage.from('videos').upload(videoName, videoBlob);
    if (videoError) {
        console.error(videoError);
        updateStatus("Erreur upload vidéo. Hashes sauvegardés localement.", "error");
        return;
    }
    videoStatusEl.textContent = "oui";
    updateStatus("Vidéo uploadée avec succès ! Upload des hashes en cours...");

    const { error: hashError } = await supabase.from('frame_hashes').insert(frameHashes);
    if (hashError) {
        console.error(hashError);
        updateStatus("Erreur lors de l'envoi des hashes. Stockage côté client activé.", "error");
    } else {
        updateStatus("Hashes uploadés avec succès !");
        tempHashes = [];
        frameHashes = [];
        recordedChunks = [];
        uploadBtn.disabled = true;
        recordBtn.disabled = false;
        framesCaptured = 0;
        frameCountEl.textContent = 0;
        recordTimeEl.textContent = 0;
    }
}

// Gestion reconnections
window.addEventListener('online', async () => {
    networkStatusEl.textContent = "en ligne";
    if (tempHashes.length > 0) {
        updateStatus("Connexion rétablie, envoi des hashes sauvegardés...");
        const { error } = await supabase.from('frame_hashes').insert(tempHashes);
        if (!error) {
            tempHashes = [];
            updateStatus("Hashes temporaires uploadés !");
        }
    }
});
window.addEventListener('offline', () => { networkStatusEl.textContent = "hors ligne"; });

recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
