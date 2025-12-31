import { supabase } from "./supabaseClient.js";

const videoEl = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");

let mediaRecorder;
let chunks = [];
let videoBlob;

// ---------------- Camera ----------------
async function initCamera() {
  try {
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
      statusDiv.textContent = "Vidéo enregistrée, prête à uploader.";
    };
  } catch (e) {
    alert("Impossible d'accéder à la caméra : " + e.message);
  }
}

initCamera();

// ---------------- SHA256 ----------------
async function sha256(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

// ---------------- Upload vidéo + hash ----------------
uploadBtn.onclick = async () => {
  if(!videoBlob) return;

  const timestamp = Date.now();
  const videoName = `video_${timestamp}.mp4`;
  statusDiv.textContent = "Upload en cours...";

  // 1️⃣ Upload vidéo brute
  let { error: uploadError } = await supabase.storage.from("videos").upload(videoName, videoBlob);
  if(uploadError){
    statusDiv.textContent = "Erreur upload vidéo : " + uploadError.message;
    return;
  }

  // 2️⃣ Calcul hash
  const hash = await sha256(videoBlob);

  // 3️⃣ Stocker hash dans Supabase
  const { error: hashError } = await supabase.from("frame_hashes").insert([{ hash }]);
  if(hashError){
    statusDiv.textContent = "Erreur stockage hash : " + hashError.message;
    return;
  }

  statusDiv.textContent = `Vidéo et hash enregistrés ! Hash: ${hash}`;
};

// ---------------- Record bouton ----------------
recordBtn.onclick = () => {
  if(mediaRecorder.state === "inactive"){
    chunks = [];
    mediaRecorder.start();
    statusDiv.textContent = "Enregistrement en cours...";
    recordBtn.textContent = "Arrêter enregistrement";
  } else {
    mediaRecorder.stop();
    recordBtn.textContent = "Démarrer enregistrement";
  }
};
