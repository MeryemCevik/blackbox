import { supabase } from "./supabaseClient.js";

// Extraction des frames depuis la vidéo enregistrée
async function extractFramesFromVideo(videoBlob, intervalMs = 500) {
    return new Promise((resolve) => {
        const video = document.createElement("video");
        video.src = URL.createObjectURL(videoBlob);
        video.muted = true;
        video.preload = "metadata";

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const frames = [];
        let currentTime = 0;

        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            function seek() {
                if (currentTime > video.duration) {
                    resolve(frames);
                    return;
                }
                video.currentTime = currentTime;
            }

            video.onseeked = async () => {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
                const buffer = await blob.arrayBuffer();

                const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
                const hashHex = Array.from(new Uint8Array(hashBuffer))
                    .map(b => b.toString(16).padStart(2, "0"))
                    .join("");

                frames.push(hashHex);

                currentTime += intervalMs / 1000;
                seek();
            };

            seek();
        };
    });
}

// Enregistrement vidéo
const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");

let mediaRecorder;
let chunks = [];

recordBtn.onclick = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;

    mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.start();

    recordBtn.disabled = true;
    uploadBtn.disabled = false;
};

uploadBtn.onclick = async () => {
    mediaRecorder.stop();

    mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const name = `video_${Date.now()}.webm`;

        // Upload vidéo
        await supabase.storage.from("videos").upload(name, blob);

        // Extraction + hash
        const hashes = await extractFramesFromVideo(blob);

        // Upload hashes
        await supabase.from("frame_hashes").insert(
            hashes.map(h => ({ hash: h }))
        );

        alert("Vidéo + hashes envoyés !");
        chunks = [];
    };
};
