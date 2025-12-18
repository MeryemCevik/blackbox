import { supabase } from "./supabaseClient.js";

const videoEl = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");

let mediaRecorder;
let recordedChunks = [];
let recordedBlob = null;
let captureInterval;

const FRAME_INTERVAL = 100; // 10 fps

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

// -------------------
// 1️⃣ Initialisation caméra
// -------------------
async function initCamera() {
  try {
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

  } catch (e) {
    alert("Impossible d'accéder à la caméra : " + e.message);
  }
}
initCamera();

// -------------------
// 2️⃣ Capture frame
// -------------------
function captureFrame(videoEl) {
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

// -------------------
// 3️⃣ DataURL → Blob
// -------------------
function dataURLtoBlob(dataURL) {
  const [header, base64] = dataURL.split(',');
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  return new Blob([array], { type: "image/jpeg" });
}

// -------------------
// 4️⃣ aHash simple
// -------------------
async function aHashFromBlob(blob) {
  const img = new Image();
  const url = URL.createObjectURL(blob);
  img.src = url;
  await new Promise(res => img.onload = res);

  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  c.width = 8; c.height = 8;
  ctx.drawImage(img, 0, 0, 8, 8);

  const data = ctx.getImageData(0, 0, 8, 8).data;
  const gray = [];
  for (let i = 0; i < data.length; i += 4) gray.push((data[i] + data[i+1] + data[i+2])/3);
  const avg = gray.reduce((a,b)=>a+b,0)/gray.length;
  return gray.map(v => v >= avg ? "1" : "0").join('');
}

// -------------------
// 5️⃣ Upload frame + hash
// -------------------
async function uploadFrame(frameDataURL) {
  const blob = dataURLtoBlob(frameDataURL);
  const timestamp = Date.now();
  const { data, error } = await supabase.storage
    .from("videos")
    .upload(`frames/frame_${timestamp}.jpg`, blob, { upsert: true });
  if (error) console.error("Upload frame:", error);
  
  const hash = await aHashFromBlob(blob);
  const { error: dbError } = await supabase
    .from("frame_hashes")
    .insert([{ hash, timestamp }]);
  if (dbError) console.error("Upload hash:", dbError);

  return blob;
}

// -------------------
// 6️⃣ Capture continue
// -------------------
function startFrameCapture() {
  captureInterval = setInterval(async () => {
    const frameDataURL = captureFrame(videoEl);
    await uploadFrame(frameDataURL);
  }, FRAME_INTERVAL);
}

function stopFrameCapture() {
  clearInterval(captureInterval);
}

// -------------------
// 7️⃣ Gestion boutons
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

uploadBtn.onclick = async () => {
  if (!recordedBlob) return;
  const timestamp = Date.now();
  const { error } = await supabase.storage
    .from("videos")
    .upload(`video_${timestamp}.mp4`, recordedBlob);
  if (error) alert("Erreur upload vidéo : " + error.message);
  else alert("Vidéo brute envoyée !");
};
