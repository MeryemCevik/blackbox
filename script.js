import { supabase } from "./supabaseClient.js";

const videoEl = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");

let mediaRecorder;
let recordedChunks = [];
let recordedBlob = null;
let captureInterval;
let isRecording = false;
let frameIndex = 0;

const FRAME_INTERVAL = 100; // 10 fps
const FRAME_REDUNDANCY = 3; // Redondance de frames

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

// -------------------
// 1️⃣ Initialisation caméra
// -------------------
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });

    videoEl.srcObject = stream;
    
    // Options MediaRecorder
    const options = {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 2500000
    };
    
    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(recordedChunks, { type: 'video/webm' });
      uploadBtn.disabled = false;
      console.log("Enregistrement terminé");
    };

  } catch (e) {
    alert("Erreur caméra : " + e.message);
    console.error(e);
  }
}
initCamera();

// -------------------
// 2️⃣ Capture frame
// -------------------
function captureFrame() {
  if (!videoEl.videoWidth || !videoEl.videoHeight) {
    return null;
  }
  
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  
  return canvas.toDataURL("image/jpeg", 0.7);
}

// -------------------
// 3️⃣ Calcul SHA-256
// -------------------
async function calculateSHA256(dataURL) {
  try {
    // Convertir DataURL en ArrayBuffer
    const response = await fetch(dataURL);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    
    // Calculer hash SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    console.error("Erreur calcul hash:", error);
    // Fallback simple
    return 'hash_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
}

// -------------------
// 4️⃣ Upload frame vers Supabase Storage
// -------------------
async function uploadToStorage(dataURL, sessionId, frameNum) {
  try {
    // Convertir DataURL en Blob
    const response = await fetch(dataURL);
    const blob = await response.blob();
    
    // Nom unique pour le fichier
    const timestamp = Date.now();
    const fileName = `${sessionId}/frame_${timestamp}_${frameNum}.jpg`;
    
    // Upload vers Supabase Storage
    const { data, error } = await supabase.storage
      .from("videos")
      .upload(fileName, blob, {
        contentType: 'image/jpeg',
        upsert: false
      });
    
    if (error) {
      console.error("Erreur upload storage:", error);
      return null;
    }
    
    console.log("Frame uploadée:", fileName);
    return fileName;
    
  } catch (error) {
    console.error("Erreur dans uploadToStorage:", error);
    return null;
  }
}

// -------------------
// 5️⃣ Sauvegarde hash dans la table frame_hashes
// -------------------
async function saveHashToDatabase(hash, storagePath) {
  try {
    const { error } = await supabase
      .from("frame_hashes")
      .insert([
        {
          hash: hash,
          timestamp: Date.now(),
          frame_path: storagePath
          // created_at sera automatiquement ajouté par Supabase
        }
      ]);
    
    if (error) {
      console.error("Erreur insertion hash:", error);
      return false;
    }
    
    return true;
    
  } catch (error) {
    console.error("Erreur dans saveHashToDatabase:", error);
    return false;
  }
}

// -------------------
// 6️⃣ Processus complet pour une frame
// -------------------
async function processFrame(dataURL, sessionId) {
  if (!dataURL) return;
  
  // Calculer le hash
  const hash = await calculateSHA256(dataURL);
  
  // Upload vers storage
  const storagePath = await uploadToStorage(dataURL, sessionId, frameIndex);
  
  if (storagePath) {
    // Sauvegarder dans la table frame_hashes
    await saveHashToDatabase(hash, storagePath);
    console.log(`Frame ${frameIndex} traitée, hash: ${hash.substring(0, 16)}...`);
  }
  
  frameIndex++;
}

// -------------------
// 7️⃣ Capture continue
// -------------------
function startFrameCapture() {
  const sessionId = `session_${Date.now()}`;
  localStorage.setItem('current_session', sessionId);
  
  captureInterval = setInterval(async () => {
    const frameDataURL = captureFrame();
    if (!frameDataURL) return;
    
    // Upload avec redondance
    for (let i = 0; i < FRAME_REDUNDANCY; i++) {
      await processFrame(frameDataURL, sessionId);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
  }, FRAME_INTERVAL);
}

function stopFrameCapture() {
  clearInterval(captureInterval);
  frameIndex = 0;
}

// -------------------
// 8️⃣ Gestion boutons
// -------------------
recordBtn.onclick = async () => {
  if (!isRecording) {
    // Démarrer
    recordedChunks = [];
    
    try {
      mediaRecorder.start(1000);
      startFrameCapture();
      recordBtn.textContent = "⏹️ Arrêter";
      recordBtn.style.backgroundColor = "#ff4444";
      isRecording = true;
      uploadBtn.disabled = true;
      
      console.log("Enregistrement démarré");
    } catch (error) {
      console.error("Erreur démarrage:", error);
    }
  } else {
    // Arrêter
    mediaRecorder.stop();
    stopFrameCapture();
    recordBtn.textContent = "▶️ Démarrer";
    recordBtn.style.backgroundColor = "";
    isRecording = false;
    
    console.log("Enregistrement arrêté");
  }
};

uploadBtn.onclick = async () => {
  if (!recordedBlob) {
    alert("Aucune vidéo à envoyer");
    return;
  }
  
  const timestamp = Date.now();
  const sessionId = localStorage.getItem('current_session') || `session_${timestamp}`;
  
  try {
    const { error } = await supabase.storage
      .from("videos")
      .upload(`${sessionId}/video_${timestamp}.webm`, recordedBlob, {
        contentType: 'video/webm'
      });
    
    if (error) {
      alert("Erreur upload vidéo : " + error.message);
    } else {
      alert("✅ Vidéo envoyée avec succès !");
      
      // Optionnel: enregistrer dans une table si vous en créez une
      // await supabase.from("video_records").insert([...]);
    }
  } catch (error) {
    console.error("Erreur:", error);
    alert("Erreur lors de l'envoi");
  }
};
