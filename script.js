import { supabase } from "./supabaseClient.js";

// DOM Elements
const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

let mediaRecorder;
let recordedChunks = [];
let frameHashes = [];
let tempHashes = [];
let captureInterval;
let frameCount = 0;

// Grille D-Hash
const DHASH_WIDTH = 9;
const DHASH_HEIGHT = 8;

// Convertit une canvas en D-Hash (luminance)
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

// Capture une frame et calcule le D-Hash
async function captureFrame() {
    if (!video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = DHASH_WIDTH;
    canvas.height = DHASH_HEIGHT;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, DHASH_WIDTH, DHASH_HEIGHT);

    const dHash = await computeDHash(canvas);
    const timestamp = new Date().toISOString();

    frameHashes.push({ created_at: timestamp, hash: dHash });
    tempHashes.push({ created_at: timestamp, hash: dHash });

    frameCount++;
    statusDiv.textContent = `Frames : ${frameCount}`;
}

// Démarrer l'enregistrement vidéo
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = stream;

        mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.start(100);

        captureInterval = setInterval(captureFrame, 1000); // 1 hash/sec

        recordBtn.disabled = true;
        uploadBtn.disabled = false;
    } catch (err) {
        console.error("Erreur caméra :", err);
        statusDiv.textContent = "Impossible d'accéder à la caméra";
    }
}

// Upload vidéo + hashes
async function uploadData() {
    clearInterval(captureInterval);
    mediaRecorder.stop();
    recordBtn.disabled = false;
    uploadBtn.disabled = true;

    const videoBlob = new Blob(recordedChunks, { type: "video/webm" });
    const videoName = `video_${Date.now()}.webm`;

    const { error: videoError } = await supabase.storage.from("videos").upload(videoName, videoBlob);
    if (videoError) {
        console.error("Erreur upload vidéo :", videoError);
        statusDiv.textContent = "Erreur vidéo, hashes sauvegardés localement";
        return;
    }

    try {
        const { error: hashError } = await supabase.from("frame_hashes").insert(frameHashes);
        if (hashError) {
            console.error("Erreur insertion hashes :", hashError);
        } else {
            tempHashes = [];
            frameHashes = [];
            recordedChunks = [];
            frameCount = 0;
            statusDiv.textContent = "Vidéo et hashes uploadés avec succès";
        }
    } catch (err) { console.error(err); }
}

// Event listeners
recordBtn.addEventListener("click", startRecording);
uploadBtn.addEventListener("click", uploadData);
