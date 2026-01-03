import { supabase } from "./supabaseClient.js";

const SUPABASE_ANON_KEY =
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6enpiYWpzZXF5Z3JydGJibGN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyNzMyNjEsImV4cCI6MjA4MDg0OTI2MX0.Y-kwShdUgypTBGPYhnRZ0ivM2jssQwZtcPorhT3kaPg";

async function callDeleteExpiredHashes() {
    try {
        console.log("Appel Edge Function : delete_expired_hashes");

        const res = await fetch(
            "https://hzzzbajseqygrrtbblcy.functions.supabase.co/delete_expired_hashes",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        if (!res.ok) {
            const text = await res.text();
            console.error("Erreur Edge Function :", res.status, text);
            return;
        }

        const data = await res.json();
        console.log("Suppression réussie :", data);

    } catch (err) {
        console.error("Erreur suppression frames expirées :", err);
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

// Supprimer les frames expirées dès le lancement
callDeleteExpiredHashes();

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





