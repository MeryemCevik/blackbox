import { supabase } from "./supabaseClient.js";

const videoEl = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");

let mediaRecorder;
let recordedChunks = [];
let recordedBlob = null;
let captureInterval;

const FRAME_INTERVAL = 300; // même fréquence que le décodeur

// Canvas pour capture
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

// -------------------
// Initialisation caméra
// -------------------
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });

  videoEl.srcObject = stream;

  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
  mediaRecorder.onstop = () => {
    recordedBlob = new Blob(recordedChunks, { type: "video/mp4" });
    uploadBtn.disabled = false;
  };
}

initCamera();

// -------------------
// Capture frame
// -------------------
function captureFrame() {
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  ctx.drawImage(videoEl, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.7);
}

// -------------------
// aHash perceptuel
// -------------------
async function aHashFromDataURL(dataURL) {
  return new Promise(resolve => {
    const img = new Image();
    img.src = dataURL;
    img.onload = () => {
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d");
      c.width = 8;
      c.height = 8;

      ctx.drawImage(img, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;

      const gray = [];
      for (let i = 0; i < data.length; i += 4) {
        gray.push((data[i] + data[i + 1] + data[i + 2]) / 3);
      }

      const avg = gray.reduce((a, b) => a + b, 0) / gray.length;

      const hash = gray.map(v => (v >= avg ? "1" : "0")).join("");
      resolve(hash);
    };
  });
}

// -------------------
// Sauvegarde hash
// -------------------
async function saveHashToDB(hash, timestamp) {
  await supabase.from("frame_hashes").insert([
    { hash, timestamp }
  ]);
}

// -------------------
// Boucle capture
// -------------------
function startFrameCapture() {
  captureInterval = setInterval(async () => {
    const frame = captureFrame();
    const hash = await aHashFromDataURL(frame);
    await saveHashToDB(hash, Date.now());
  }, FRAME_INTERVAL);
}

function stopFrameCapture() {
  clearInterval(captureInterval);
}

// -------------------
// Bouton record
// -------------------
recordBtn.onclick = () => {
  if (mediaRecorder.state === "inactive") {
    recordedChunks = [];
    mediaRecorder.start();
    startFrameCapture();
    recordBtn.textContent = "Arrêter enregistrement";
  } else {
    mediaRecorder.stop();
    stopFrameCapture();
    recordBtn.textContent = "Démarrer enregistrement";
  }
};

// -------------------
// Upload vidéo brute
// -------------------
uploadBtn.onclick = async () => {
  const { error } = await supabase.storage
    .from("videos")
    .upload(`video_${Date.now()}.mp4`, recordedBlob);

  if (!error) alert("Vidéo envoyée");
};
