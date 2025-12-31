import { supabase } from "./supabaseClient.js";

const videoEl = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

let mediaRecorder, chunks = [], videoBlob;
let frameHashes = [];
let framesBuffer = [];

const FRAME_INTERVAL = 200; // ms
const CANVAS_SIZE = 32;
let captureInterval;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

// ---------------- Camera ----------------
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  videoEl.srcObject = stream;

  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.onstop = () => {
    videoBlob = new Blob(chunks, { type: "video/mp4" });
    uploadBtn.disabled = false;
    statusDiv.textContent = "Vidéo enregistrée et frames prêtes.";
  };
}

initCamera();

// ---------------- SHA256 ----------------
async function sha256(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

// ---------------- Capture frame ----------------
function captureFrame() {
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  ctx.drawImage(videoEl, 0, 0);
  return new Promise(res => canvas.toBlob(res, "image/jpeg", 0.7));
}

// ---------------- Start / Stop capture frames ----------------
function startFrameCapture() {
  captureInterval = setInterval(async () => {
    const blob = await captureFrame();
    framesBuffer.push(blob);
    const hash = await sha256(blob);
    frameHashes.push({ hash });  // plus de timestamp
  }, FRAME_INTERVAL);
}

function stopFrameCapture() {
  clearInterval(captureInterval);
}

// ---------------- Upload ----------------
uploadBtn.onclick = async () => {
  if(!videoBlob) return;
  statusDiv.textContent = "Upload en cours...";

  // 1️⃣ Upload vidéo brute
  const timestamp = Date.now();
  const videoName = `video_${timestamp}.mp4`;
  const { error: videoError } = await supabase.storage.from("videos").upload(videoName, videoBlob);
  if(videoError){ statusDiv.textContent = "Erreur upload vidéo : "+videoError.message; return; }

  // 2️⃣ Upload frames + hashes
  for(let i=0;i<framesBuffer.length;i++){
    const frameName = `frames/frame_${timestamp}_${i}.jpg`;
    const { error: frameError } = await supabase.storage.from("videos").upload(frameName, framesBuffer[i]);
    if(frameError) console.error("Erreur upload frame:", frameError);
  }

  const { error: hashError } = await supabase.from("frame_hashes").insert(frameHashes);
  if(hashError){ console.error("Erreur hash:", hashError); statusDiv.textContent="Erreur stockage hash"; return; }

  statusDiv.textContent = "Vidéo, frames et hashes uploadés !";
};

// ---------------- Record bouton ----------------
recordBtn.onclick = () => {
  if(mediaRecorder.state === "inactive"){
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
