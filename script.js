// script.js pour l'encodeur
import { supabase } from "./supabaseClient.js";

const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const status = document.getElementById("status");

let mediaRecorder;
let recordedBlobs = [];
let frames = [];
let hashList = [];
let stream;

// Fonction pour initialiser la caméra
async function initCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;
    } catch (err) {
        console.error("Erreur d'accès à la caméra :", err);
        status.textContent = "Erreur d'accès à la caméra.";
    }
}

// Démarrage de l'enregistrement
recordBtn.addEventListener("click", () => {
    recordedBlobs = [];
    frames = [];
    hashList = [];

    mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });

    mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            recordedBlobs.push(event.data);
        }
    };

    mediaRecorder.start(100); // dataavailable tous les 100ms
    recordBtn.disabled = true;
    uploadBtn.disabled = false;
    status.textContent = "Enregistrement en cours...";
});

// Capture des frames et génération de hash
function captureFrames() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // capture frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frameData = canvas.toDataURL("image/jpeg");
    frames.push(frameData);

    // génération hash simple avec SHA-256
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(frameData))
        .then(hashBuffer => {
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            hashList.push(hashHex);
            return hashHex;
        });
}

// Upload frames et hashes sur Supabase
async function uploadFramesAndHashes() {
    status.textContent = "Envoi des frames et hashes...";
    for (let i = 0; i < frames.length; i++) {
        try {
            await supabase
                .from("frame_hashes")
                .insert([{ hash: hashList[i] }]);
        } catch (err) {
            console.error("Erreur lors de l'upload :", err);
        }
    }
    status.textContent = "Upload terminé !";
}

// Bouton pour upload
uploadBtn.addEventListener("click", async () => {
    mediaRecorder.stop();
    status.textContent = "Enregistrement terminé. Traitement des frames...";
    
    // capture frames pour chaque Blob (simplification)
    const videoBlob = new Blob(recordedBlobs, { type: "video/webm" });
    const videoURL = URL.createObjectURL(videoBlob);
    video.src = videoURL;

    // capture frames toutes les 200ms environ
    const captureInterval = setInterval(async () => {
        await captureFrames();
    }, 200);

    // stop capture après 3 secondes (ou adapter selon la longueur vidéo)
    setTimeout(async () => {
        clearInterval(captureInterval);
        await uploadFramesAndHashes();
    }, 3000);
});

// initialisation caméra
initCamera();
