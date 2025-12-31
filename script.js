import { supabase } from "./supabaseClient.js";

const videoEl = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");

let mediaRecorder;
let chunks = [];
let videoBlob;
let intervalId;

const FRAME_INTERVAL = 500; // capture toutes les 0.5 sec
const CANVAS_SIZE = 32;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

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
      console.log("Enregistrement terminé, vidéo prête à être uploadée.");
    };
  } catch (e) {
    alert("Impossible d'accéder à la caméra : " + e.message);
  }
}

initCamera();

// ---------------- Capture frame ----------------
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

// ---------------- Visual Hash ----------------
async function visualHash(blob) {
  return new Promise(resolve => {
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = CANVAS_SIZE;
      c.height = CANVAS_SIZE;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const data = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
      const gray = [];
      for (let i = 0; i < data.length; i += 4) {
        gray.push((data[i]+data[i+1]+data[i+2])/3);
      }
      const avg = gray.reduce((a,b)=>a+b,0)/gray.length;
      const hash = gray.map(v => v >= avg ? "1" : "0").join('');
      resolve(hash);
    };
  });
}

// ---------------- Upload frame ----------------
async function uploadFrame() {
  const frameDataURL = captureFrame();
  const blob = dataURLtoBlob(frameDataURL);
  console.log("Taille du blob :", blob.size);

  const filename = `frames_${Date.now()}.jpg`; // Préfixe frames_

  try {
    const { error } = await supabase.storage.from("videos").upload(filename, blob, { upsert: true });
    if (error) console.error("Erreur upload frame :", error);
    else console.log("Frame uploadée :", filename);

    const hash = await visualHash(blob);
    const { error: dbError } = await supabase.from("frame_hashes").insert([{ hash }]);
    if (dbError) console.error("Erreur upload hash :", dbError);
    else console.log("Hash enregistré :", hash);

  } catch(e) {
    console.error("Erreur lors de l'upload de la frame :", e.message);
  }
}

// ---------------- Start / Stop capture ----------------
function startFrameCapture() {
  intervalId = setInterval(uploadFrame, FRAME_INTERVAL);
}

function stopFrameCapture() {
  clearInterval(intervalId);
}

// ---------------- Record button ----------------
recordBtn.onclick = () => {
  if (mediaRecorder.state === "inactive") {
    chunks = [];
    mediaRecorder.start();
    startFrameCapture();
    recordBtn.textContent = "Arrêter enregistrement";
  } else {
    mediaRecorder.stop();
    stopFrameCapture();
    recordBtn.textContent = "Démarrer enregistrement";
  }
};

// ---------------- Upload vidéo brute ----------------
uploadBtn.onclick = async () => {
  if (!videoBlob) return;
  const name = `video_${Date.now()}.mp4`;
  const { error } = await supabase.storage.from("videos").upload(name, videoBlob);
  if (error) alert("Erreur upload vidéo : " + error.message);
  else alert("Vidéo brute envoyée !");
};
