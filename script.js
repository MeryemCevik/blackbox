import { supabase } from "./supabaseClient.js";

const videoEl = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");

let mediaRecorder;
let recordedChunks = [];
let recordedBlob = null;
let captureInterval;

const FRAME_INTERVAL = 100; // 100ms pour + de précision (10 fps)

// Création d'un canvas pour capturer frames
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

// -------------------
// 1️⃣ Initialisation caméra
// -------------------
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false // vidéo silencieuse
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
// 2️⃣ Capture frames
// -------------------
function captureFrame(videoEl) {
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

function dataURLtoBlob(dataURL) {
  const [header, base64] = dataURL.split(',');
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  return new Blob([array], { type: "image/jpeg" });
}

// -------------------
// 3️⃣ Upload frame sur Supabase
// -------------------
async function uploadFrame(frameDataURL) {
  const blob = dataURLtoBlob(frameDataURL);
  const timestamp = Date.now();
  const { data, error } = await supabase.storage
    .from("videos")
    .upload(`frames/frame_${timestamp}.jpg`, blob);

  if (error) console.error("Erreur upload frame :", error);
  else console.log("Frame upload réussie :", data.path);

  return blob;
}

// -------------------
// 4️⃣ Génération hash SHA-256
// -------------------
async function hashFrame(frameBlob) {
  const arrayBuffer = await frameBlob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join('');
}

async function saveHashToDB(hash) {
    const { data, error } = await supabase
      .from("frame_hashes")
      .insert([{ hash }]);  // plus besoin de timestamp
    if (error) console.error("Erreur save hash :", error);
    else console.log("Hash sauvegardé :", data);
  }
  

// -------------------
// 5️⃣ Boucle capture continue
// -------------------
function startFrameCapture() {
  captureInterval = setInterval(async () => {
    const frameDataURL = captureFrame(videoEl);
    const blob = await uploadFrame(frameDataURL);
    const hash = await hashFrame(blob);
    await saveHashToDB(hash);
  }, FRAME_INTERVAL);
}

function stopFrameCapture() {
  clearInterval(captureInterval);
}

// -------------------
// 6️⃣ Gestion boutons
// -------------------
recordBtn.onclick = () => {
  if (mediaRecorder.state === "inactive") {
    recordedChunks = [];
    mediaRecorder.start();
    startFrameCapture(); // capture frames
    recordBtn.textContent = "Arrêter enregistrement";
  } else {
    mediaRecorder.stop();
    stopFrameCapture(); // arrêt capture frames
    recordBtn.textContent = "Démarrer enregistrement";
  }
};

// -------------------
// 7️⃣ Upload vidéo brute (optionnel)
// -------------------
uploadBtn.onclick = async () => {
  if (!recordedBlob) return;
  const timestamp = Date.now();
  const { data, error } = await supabase.storage
    .from("videos")
    .upload(`video_${timestamp}.mp4`, recordedBlob);

  if (error) alert("Erreur upload vidéo : " + error.message);
  else alert("Vidéo brute envoyée avec succès !");
};
