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

async function initCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;
    } catch (err) {
        console.error("Erreur d'accès à la caméra :", err);
        status.textContent = "Erreur d'accès à la caméra.";
    }
}

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

    mediaRecorder.start(100);
    recordBtn.disabled = true;
    uploadBtn.disabled = false;
    status.textContent = "Enregistrement en cours...";
});

// Upload vidéo dans le bucket
async function uploadVideo(blob) {
    const fileName = `video_${Date.now()}.webm`;
    const { data, error } = await supabase.storage
        .from("videos")
        .upload(fileName, blob);

    if (error) {
        console.error("Erreur upload vidéo :", error);
        status.textContent = "Erreur upload vidéo.";
        return null;
    }
    status.textContent = `Vidéo uploadée dans le bucket : ${fileName}`;
    return fileName;
}

// Upload frames et hashs
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
    status.textContent = "Upload des hashs terminé !";
}

uploadBtn.addEventListener("click", async () => {
    mediaRecorder.stop();
    status.textContent = "Enregistrement terminé. Traitement des frames...";

    // création du Blob vidéo
    const videoBlob = new Blob(recordedBlobs, { type: "video/webm" });
    video.src = URL.createObjectURL(videoBlob);

    // Upload vidéo dans le bucket
    await uploadVideo(videoBlob);

    // capture frames pour hash
    const captureInterval = setInterval(async () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frameData = canvas.toDataURL("image/jpeg");
        frames.push(frameData);

        const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(frameData));
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        hashList.push(hashHex);
    }, 200);

    // stop capture après 3 secondes (à ajuster selon la durée)
    setTimeout(async () => {
        clearInterval(captureInterval);
        await uploadFramesAndHashes();
    }, 3000);
});

// initialisation
initCamera();
