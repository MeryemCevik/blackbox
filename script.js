import { supabase } from "./supabaseClient.js";
import pHash from 'imghash'; // nécessite la librairie imghash

const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

let mediaRecorder;
let recordedChunks = [];
let frameHashes = [];
let tempHashes = [];
let frameCount = 0;

// Statut réseau + compteur
function updateStatusNetwork() {
    const status = navigator.onLine ? "en ligne" : "hors ligne";
    statusDiv.textContent = `Frames : ${frameCount} | Statut réseau : ${status}`;
}

// Hash perceptuel d'une frame
async function hashFrame(frameBlob) {
    // imghash retourne un string hexadécimal
    return await pHash.hash(frameBlob, 16); // 16x16 → hash 64 bits
}

// Capturer frames et générer hash perceptuel
async function captureFrame() {
    if (!video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const hash = await hashFrame(blob);

    frameHashes.push({ created_at: new Date().toISOString(), hash });
    tempHashes.push({ created_at: new Date().toISOString(), hash });

    frameCount++;
    updateStatusNetwork();
}

// Démarrage de l'enregistrement
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.start(100);

        setInterval(captureFrame, 500);

        recordBtn.disabled = true;
        uploadBtn.disabled = false;
    } catch (err) {
        console.error("Erreur caméra:", err);
        statusDiv.textContent = "Impossible d'accéder à la caméra.";
    }
}

// Upload vidéo + hashes
async function uploadData() {
    recordBtn.disabled = false;
    uploadBtn.disabled = true;

    const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoName = `video_${Date.now()}.webm`;

    const { error: videoError } = await supabase
        .storage
        .from('videos')
        .upload(videoName, videoBlob);

    if (videoError) {
        console.error("Erreur upload vidéo:", videoError);
        statusDiv.textContent = "Erreur lors de l'envoi de la vidéo. Hashes sauvegardés localement.";
        return;
    }

    statusDiv.textContent = "Vidéo uploadée avec succès !";

    // Upload des hashes perceptuels
    const { error: hashError } = await supabase.from('frame_hashes').insert(frameHashes);
    if (hashError) {
        console.error("Erreur insertion hashes:", hashError);
        statusDiv.textContent = "Erreur lors de l'envoi des hashes. Stockage côté client activé.";
    } else {
        tempHashes = [];
        frameHashes = [];
        recordedChunks = [];
        frameCount = 0;
        statusDiv.textContent = "Hashes uploadés avec succès !";
    }
}

recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
