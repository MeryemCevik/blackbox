import { supabase } from "./supabaseClient.js";

const videoEl = document.getElementById("preview");
const recordBtn = document.getElementById("recordBtn");
const uploadBtn = document.getElementById("uploadBtn");

let mediaRecorder;
let recordedChunks = [];
let recordedBlob = null;
let captureInterval;
let isRecording = false;

const FRAME_INTERVAL = 100; // 10 fps
const FRAME_REDUNDANCY = 3; // Envoi chaque frame 3 fois pour redondance

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
    
    // Options pour MediaRecorder
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
      console.log("Enregistrement terminé, taille:", recordedBlob.size);
    };

  } catch (e) {
    alert("Impossible d'accéder à la caméra : " + e.message);
    console.error(e);
  }
}
initCamera();

// -------------------
// 2️⃣ Capture frame optimisée
// -------------------
function captureFrame(videoEl) {
  if (!videoEl.videoWidth || !videoEl.videoHeight) {
    console.warn("Dimensions vidéo non disponibles");
    return null;
  }
  
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  
  // Qualité réduite pour optimisation
  return canvas.toDataURL("image/jpeg", 0.5);
}

// -------------------
// 3️⃣ Calcul de hash MD5 (plus robuste)
// -------------------
async function calculateHash(blob) {
  try {
    // Utilisation de l'API SubtleCrypto pour un hash plus fiable
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    console.error("Erreur calcul hash:", error);
    // Fallback: hash simple basé sur les données
    return 'fallback_' + blob.size + '_' + Date.now();
  }
}

// -------------------
// 4️⃣ Upload frame + hash avec redondance
// -------------------
async function uploadFrame(frameDataURL, frameIndex) {
  if (!frameDataURL) return null;
  
  const blob = dataURLtoBlob(frameDataURL);
  const timestamp = Date.now();
  const sessionId = localStorage.getItem('recording_session_id') || `session_${timestamp}`;
  
  if (!localStorage.getItem('recording_session_id')) {
    localStorage.setItem('recording_session_id', sessionId);
  }
  
  // Calculer le hash
  const hash = await calculateHash(blob);
  
  try {
    // Upload de la frame avec nom unique
    const frameName = `frames/${sessionId}/frame_${timestamp}_${frameIndex}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("videos")
      .upload(frameName, blob, { 
        upsert: true,
        contentType: 'image/jpeg'
      });
    
    if (uploadError) {
      console.error("Erreur upload frame:", uploadError);
      return null;
    }
    
    // Enregistrement du hash avec metadata
    const { error: dbError } = await supabase
      .from("frame_hashes")
      .insert([{ 
        hash, 
        timestamp,
        session_id: sessionId,
        frame_index: frameIndex,
        frame_path: frameName
      }]);
    
    if (dbError) {
      console.error("Erreur insertion hash:", dbError);
    }
    
    console.log(`Frame ${frameIndex} uploadée, hash: ${hash.substring(0, 16)}...`);
    return { hash, timestamp, frameName };
    
  } catch (error) {
    console.error("Erreur dans uploadFrame:", error);
    return null;
  }
}

// -------------------
// 5️⃣ Conversion DataURL → Blob
// -------------------
function dataURLtoBlob(dataURL) {
  try {
    const byteString = atob(dataURL.split(',')[1]);
    const mimeString = dataURL.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    
    return new Blob([ab], { type: mimeString });
  } catch (error) {
    console.error("Erreur conversion DataURL:", error);
    return new Blob([]);
  }
}

// -------------------
// 6️⃣ Capture continue avec redondance
// -------------------
function startFrameCapture() {
  let frameIndex = 0;
  
  captureInterval = setInterval(async () => {
    if (!videoEl.videoWidth) return;
    
    const frameDataURL = captureFrame(videoEl);
    if (!frameDataURL) return;
    
    // Upload avec redondance (multiple uploads de la même frame)
    for (let i = 0; i < FRAME_REDUNDANCY; i++) {
      await uploadFrame(frameDataURL, frameIndex);
      await new Promise(resolve => setTimeout(resolve, 10)); // Petit délai entre les uploads
    }
    
    frameIndex++;
    
  }, FRAME_INTERVAL);
}

function stopFrameCapture() {
  clearInterval(captureInterval);
}

// -------------------
// 7️⃣ Gestion boutons
// -------------------
recordBtn.onclick = async () => {
  if (!isRecording) {
    // Démarrer l'enregistrement
    recordedChunks = [];
    const sessionId = `session_${Date.now()}`;
    localStorage.setItem('recording_session_id', sessionId);
    
    try {
      mediaRecorder.start(1000); // Collecte des données chaque seconde
      startFrameCapture();
      recordBtn.textContent = "Arrêter enregistrement";
      recordBtn.style.backgroundColor = "#ff4444";
      isRecording = true;
      uploadBtn.disabled = true;
      
      console.log("Enregistrement démarré, session:", sessionId);
    } catch (error) {
      console.error("Erreur démarrage enregistrement:", error);
    }
  } else {
    // Arrêter l'enregistrement
    mediaRecorder.stop();
    stopFrameCapture();
    recordBtn.textContent = "Démarrer enregistrement";
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
  
  const sessionId = localStorage.getItem('recording_session_id') || `session_${Date.now()}`;
  const timestamp = Date.now();
  
  try {
    const { error } = await supabase.storage
      .from("videos")
      .upload(`videos/${sessionId}/video_${timestamp}.webm`, recordedBlob, {
        contentType: 'video/webm'
      });
    
    if (error) {
      alert("Erreur upload vidéo : " + error.message);
      console.error(error);
    } else {
      alert("Vidéo brute envoyée avec succès !");
      
      // Mettre à jour la base de données avec l'info vidéo
      await supabase
        .from("video_records")
        .insert([{
          session_id: sessionId,
          video_path: `videos/${sessionId}/video_${timestamp}.webm`,
          timestamp,
          duration: recordedChunks.length * 1000 // Estimation
        }]);
    }
  } catch (error) {
    console.error("Erreur:", error);
    alert("Erreur lors de l'envoi de la vidéo");
  }
};