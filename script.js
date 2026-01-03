import { supabase } from "./supabaseClient.js";

const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

let mediaRecorder;
let chunks = [];
let recordedBlob = null;
let currentVideoId = null;

// Extraction de frames depuis la vidéo enregistrée
async function extractFramesFromVideo(videoBlob, intervalMs = 500) {
    return new Promise((resolve) => {
        const videoEl = document.createElement("video");
        videoEl.src = URL.createObjectURL(videoBlob);
        videoEl.muted = true;
        videoEl.preload = "metadata";

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const hashes = [];
        let currentTime = 0;

        videoEl.onloadedmetadata = () => {
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;

            function seek() {
                if (currentTime > videoEl.duration) {
                    resolve(hashes);
                    return;
                }
                videoEl.currentTime = currentTime;
            }

            videoEl.onseeked = async () => {
                ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

                const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
                const buffer = await blob.arrayBuffer();

                const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
                const hashHex = Array.from(new Uint8Array(hashBuffer))
                    .map(b => b.toString(16).padStart(2, "0"))
                    .join("");

                hashes.push(hashHex);

                currentTime += intervalMs / 1000;
                seek();
            };

            seek();
        };
    });
}

recordBtn.onclick = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;

    chunks = [];
    recordedBlob = null;
    currentVideoId = Date.now().toString(); // identifiant unique

    mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.start();

    statusDiv.textContent = `Enregistrement en cours… video_id = ${currentVideoId}`;
    recordBtn.disabled = true;
    stopBtn.disabled = false;
    uploadBtn.disabled = true;
};

stopBtn.onclick = () => {
    mediaRecorder.stop();
    mediaRecorder.onstop = () => {
        const stream = video.srcObject;
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            video.srcObject = null;
        }

        recordedBlob = new Blob(chunks, { type: "video/webm" });
        statusDiv.textContent = `Enregistrement terminé. video_id = ${currentVideoId}`;
        stopBtn.disabled = true;
        uploadBtn.disabled = false;
    };
};

uploadBtn.onclick = async () => {
    if (!recordedBlob || !currentVideoId) {
        alert("Aucune vidéo enregistrée.");
        return;
    }

    statusDiv.textContent = "Upload vidéo en cours…";

    const videoName = `video_${currentVideoId}.webm`;

    // 1) Upload vidéo
    const { error: uploadError } = await supabase
        .storage
        .from("videos")
        .upload(videoName, recordedBlob);

    if (uploadError) {
        console.error(uploadError);
        statusDiv.textContent = "Erreur upload vidéo.";
        return;
    }

    statusDiv.textContent = "Extraction des frames et génération des hashes…";

    // 2) Extraction des frames + hashes
    const hashes = await extractFramesFromVideo(recordedBlob, 500);

    // 3) Insertion des hashes avec video_id
    const rows = hashes.map((h, index) => ({
        video_id: currentVideoId,
        frame_index: index,
        hash: h
    }));

    const { error: hashError } = await supabase
        .from("frame_hashes")
        .insert(rows);

    if (hashError) {
        console.error(hashError);
        statusDiv.textContent = "Erreur insertion hashes.";
        return;
    }

    statusDiv.textContent = `Upload terminé. video_id = ${currentVideoId}, hashes = ${hashes.length}`;
    uploadBtn.disabled = true;
    recordBtn.disabled = false;
};
