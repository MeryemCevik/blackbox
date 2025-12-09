import { supabase } from "./supabaseClient.js";

const videoEl = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");

let mediaRecorder;
let recordedChunks = [];
let recordedBlob = null;

// 1. Accès caméra
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: true
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

// Charger la caméra automatiquement
initCamera();


// 2. Enregistrement vidéo
recordBtn.onclick = () => {
  if (mediaRecorder.state === "inactive") {
    recordedChunks = [];
    mediaRecorder.start();
    recordBtn.textContent = "Arrêter enregistrement";
  } else {
    mediaRecorder.stop();
    recordBtn.textContent = "Démarrer enregistrement";
  }
};


// 3. Upload vers Supabase Storage
uploadBtn.onclick = async () => {
  if (!recordedBlob) return;

  const timestamp = Date.now();
  const { data, error } = await supabase.storage
    .from("videos")
    .upload(`video_${timestamp}.mp4`, recordedBlob);

  if (error) {
    alert("Erreur upload : " + error.message);
  } else {
    alert("Vidéo envoyée avec succès !");
  }
};
