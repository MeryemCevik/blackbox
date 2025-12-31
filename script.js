import { supabase } from "./supabaseClient.js";

const video = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");

let mediaRecorder;
let chunks = [];
let videoBlob;
let intervalId;

const FRAME_INTERVAL = 300;
const HASH_SIZE = 32;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

// ---------------- CAMERA ----------------
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });

  video.srcObject = stream;

  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.onstop = () => {
    videoBlob = new Blob(chunks, { type: "video/mp4" });
    uploadBtn.disabled = false;
  };
}

initCamera();

// ---------------- FRAME ----------------
function captureFrame() {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.7);
}

function dataURLtoBlob(dataURL) {
  const bin = atob(dataURL.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: "image/jpeg" });
}

// ---------------- HASH ----------------
async function visualHash(blob) {
  return new Promise(resolve => {
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = HASH_SIZE;
      c.height = HASH_SIZE;
      const cx = c.getContext("2d");
      cx.drawImage(img, 0, 0, HASH_SIZE, HASH_SIZE);
      const d = cx.getImageData(0, 0, HASH_SIZE, HASH_SIZE).data;

      let gray = [];
      for (let i = 0; i < d.length; i += 4)
        gray.push((d[i] + d[i+1] + d[i+2]) / 3);

      const avg = gray.reduce((a,b)=>a+b,0)/gray.length;
      resolve(gray.map(v => v >= avg ? "1" : "0").join(""));
    };
  });
}

// ---------------- UPLOAD ----------------
async function uploadFrame() {
  const frame = captureFrame();
  const blob = dataURLtoBlob(frame);
  const filename = `frames/frame_${Date.now()}.jpg`;

  await supabase.storage
    .from("videos")
    .upload(filename, blob, { upsert: true });

  const hash = await visualHash(blob);

  await supabase
    .from("frame_hashes")
    .insert([{ hash }]);
}

// ---------------- RECORD ----------------
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

uploadBtn.onclick = async () => {
  const name = `video_${Date.now()}.mp4`;
  await supabase.storage.from("videos").upload(name, videoBlob);
  alert("Vidéo envoyée");
};
