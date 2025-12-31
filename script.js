import { supabase } from "./supabaseClient.js";

const videoEl = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");

let mediaRecorder;
let chunks = [];
let videoBlob;
let intervalId;

const FRAME_INTERVAL = 300;

// ---------------- Canvas ----------------
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

// ---------------- Camera ----------------
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
  };
}

initCamera();

// ---------------- Convert DataURL -> Blob ----------------
function captureFrame() {
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  ctx.drawImage(videoEl, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.7);
}

function dataURLtoBlob(dataURL) {
  const bin = atob(dataURL.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: "image/jpeg" });
}

// ---------------- SHA256 ----------------
async function sha256(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

// ---------------- Upload frame ----------------
async function uploadFrame() {
  const frame = captureFrame();
  const blob = dataURLtoBlob(frame);
  const filename = `frames/frame_${Date.now()}.jpg`;

  await supabase.storage.from("videos").upload(filename, blob, { upsert: true });

  const hash = await sha256(blob);

  await supabase.from("frame_hashes").insert([{ hash }]);
}

// ---------------- Record ----------------
recordBtn.onclick = () => {
  if (mediaRecorder.state === "inactive") {
    chunks = [];
    mediaRecorder.start();
    intervalId = setInterval(uploadFrame, FRAME_INTERVAL);
    recordBtn.textContent = "Arrêter";
  } else {
    mediaRecorder.stop();
    clearInterval(intervalId);
    recordBtn.textContent = "Démarrer";
  }
};

// ---------------- Upload vidéo brute ----------------
uploadBtn.onclick = async () => {
  if (!videoBlob) return;
  const name = `video_${Date.now()}.mp4`;
  await supabase.storage.from("videos").upload(name, videoBlob);
  alert("Vidéo brute envoyée !");
};
