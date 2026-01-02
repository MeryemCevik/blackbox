import { supabase } from "./supabaseClient.js";

const videoEl = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

let mediaRecorder, chunks = [], videoBlob;
let frameHashes = [];
let framesBuffer = [];
const FRAME_INTERVAL = 200; // ms
let captureInterval;

// Fixer une taille de canvas constante
const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 240;
const canvas = document.createElement("canvas");
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
const ctx = canvas.getContext("2d");

/* Gestion des coupures réseau */
function saveHashesLocally(hashes) {
  const existing = JSON.parse(localStorage.getItem("pending_hashes") || "[]");
  localStorage.setItem("pending_hashes", JSON.stringify(existing.concat(hashes)));
}

function clearLocalHashes() {
  localStorage.removeItem("pending_hashes");
}

window.addEventListener("online", async () => {
  const pending = JSON.parse(localStorage.getItem("pending_hashes") || "[]");
  if (!pending.length) return;

  try {
    const { error } = await supabase.from("frame_hashes").insert(pending);
    if (!error) {
      clearLocalHashes();
      console.log("Hashes envoyés après reconnexion");
    }
  } catch (e) {
    console.warn("Toujours hors ligne, hashes conservés localement");
  }
});

/* Camera */
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });
  videoEl.srcObject = stream;

  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.onstop = () => {
    videoBlob = new Blob(chunks, { type: "video/mp4" });
    uploadBtn.disabled = false;
    statusDiv.textContent = "Vidéo enregistrée et frames prêtes.";
  };

  // attendre que la vidéo soit jouable
  await new Promise(resolve => {
    videoEl.onplaying = () => resolve();
  });
}

initCamera();

/* SHA256 */
async function sha256(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/* Capture et hash frames */
async function captureAndHashFrame() {
  if (!videoEl.videoWidth || !videoEl.videoHeight) return;

  // Dessiner la frame
  ctx.drawImage(videoEl, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Convertir en blob et attendre la fin
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.8));
  if (!blob || blob.size === 0) return; // éviter les blobs vides

  const hash = await sha256(blob);
  framesBuffer.push(blob);
  frameHashes.push({ hash, created_at: new Date().toISOString() });

  console.log(`Frame capturée #${framesBuffer.length}, taille: ${blob.size}`);
}

function startFrameCapture() {
  captureInterval = setInterval(captureAndHashFrame, FRAME_INTERVAL);
}

function stopFrameCapture() {
  clearInterval(captureInterval);
}

/* Upload */
uploadBtn.onclick = async () => {
  if (!videoBlob) return;
  statusDiv.textContent = "Upload en cours...";
  const timestamp = Date.now();

  // 1️⃣ Upload vidéo
  const { error: videoError } = await supabase.storage
    .from("videos")
    .upload(`video_${timestamp}.mp4`, videoBlob, { upsert: true });
  if (videoError) return statusDiv.textContent = "Erreur upload vidéo : " + videoError.message;

  // 2️⃣ Upload frames
  for (let i = 0; i < framesBuffer.length; i++) {
    const frameName = `frames/frame_${timestamp}_${i}.jpg`;
    const { error: frameError } = await supabase.storage
      .from("videos")
      .upload(frameName, framesBuffer[i], { upsert: true });
    if (frameError) console.error("Erreur upload frame:", frameError);
  }

  // 3️⃣ Stocker hashes
  try {
    const { error } = await supabase.from("frame_hashes").insert(frameHashes);
    if (error) throw error;
    clearLocalHashes();
  } catch (e) {
    console.warn("Réseau indisponible, hashes stockés localement");
    saveHashesLocally(frameHashes);
  }

  statusDiv.textContent = "Upload terminé (vidéo + frames + hashes)";
};

/* Record bouton */
recordBtn.onclick = () => {
  if (mediaRecorder.state === "inactive") {
    chunks = [];
    frameHashes = [];
    framesBuffer = [];
    mediaRecorder.start();
    startFrameCapture();
    recordBtn.textContent = "Arrêter enregistrement";
    statusDiv.textContent = "Enregistrement en cours...";
  } else {
    mediaRecorder.stop();
    stopFrameCapture();
    recordBtn.textContent = "Démarrer enregistrement";
  }
};
