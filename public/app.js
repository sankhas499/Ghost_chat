const socket = io();
let roomKey = "", pc, dc;

// --- 1. CRYPTO ENGINE (AES-GCM) ---
async function genKey() {
    const key = await crypto.subtle.generateKey({name: "AES-GCM", length: 256}, true, ["encrypt", "decrypt"]);
    const exported = await crypto.subtle.exportKey("raw", key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

async function importKey(base64Key) {
    const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
}

async function encMsg(text) {
    const key = await importKey(roomKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, key, encoded);
    const payload = new Uint8Array(iv.length + ciphertext.byteLength);
    payload.set(iv, 0);
    payload.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...payload));
}

async function decMsg(base64Payload) {
    try {
        const key = await importKey(roomKey);
        const payload = Uint8Array.from(atob(base64Payload), c => c.charCodeAt(0));
        const iv = payload.slice(0, 12);
        const ciphertext = payload.slice(12);
        const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv: iv}, key, ciphertext);
        return new TextDecoder().decode(decrypted);
    } catch(e) { 
        console.error("Decryption failed", e); 
        return null; 
    }
}

// --- 2. UI & ROOM LOGIC ---
function showChat(key) {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('chat').style.display = 'flex';
    document.getElementById('currentKey').innerText = key;
}

function renderMsg(htmlContent, type) {
    const box = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = `msg ${type}`;
    div.innerHTML = htmlContent;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

async function createNewRoom() {
    roomKey = await genKey();
    socket.emit('create_room', roomKey); 
    showChat(roomKey);
    initPC();
}

function joinExistingRoom() {
    const k = document.getElementById('joinIn').value.trim();
    if(!k) return alert("Enter a key!");
    socket.emit('join_attempt', k); 
}

socket.on('join_success', (k) => {
    roomKey = k;
    showChat(k);
    initPC();
});

socket.on('join_error', (msg) => { alert("Invalid Room Key"); });

// --- 3. P2P WEBRTC ENGINE (Files & Audio) ---
const peerConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

function initPC() {
    if (pc) pc.close(); 
    pc = new RTCPeerConnection(peerConfig);
    
    pc.onicecandidate = e => {
        if (e.candidate) {
            socket.emit('webrtc_signal', {room: roomKey, signal: {type:'candidate', candidate: e.candidate}});
        }
    };

    pc.ondatachannel = e => {
        dc = e.channel;
        setupDC();
    };
}

function setupDC() {
    dc.onopen = () => console.log(">>> P2P Tunnel Open");
    dc.onmessage = e => {
        const data = JSON.parse(e.data);
        if(data.type === 'file') {
            const link = `<a href="${data.val}" download="${data.name}" style="color: #fff; text-decoration: underline;">Download: ${data.name}</a>`;
            renderMsg(link, 'received');
        }
    };
}

socket.on('peer_ready', async () => {
    dc = pc.createDataChannel("fileTransfer");
    setupDC();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc_signal', {room: roomKey, signal: {type:'offer', sdp: offer}});
});

socket.on('webrtc_signal', async (sig) => {
    try {
        if (sig.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
            socket.emit('webrtc_signal', {room: roomKey, signal: {type:'answer', sdp: ans}});
        } else if (sig.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
        } else if (sig.type === 'candidate') {
            await pc.addIceCandidate(new RTCIceCandidate(sig.candidate));
        }
    } catch (e) { console.error("Signaling Error", e); }
});

// --- 4. TEXT MESSAGING ---
async function sendText() {
    const v = document.getElementById('mIn').value.trim(); 
    if(!v) return;
    renderMsg(v, 'sent');
    const p = await encMsg(JSON.stringify({type:'text', val: v}));
    socket.emit('encrypted_message', {room: roomKey, payload: p});
    document.getElementById('mIn').value='';
}

socket.on('encrypted_message', async (p) => {
    const d = await decMsg(p); 
    if(!d) return;
    const data = JSON.parse(d);
    if(data.type === 'text') renderMsg(data.val, 'received');
    if(data.type === 'audio') {
        renderMsg(`<audio controls src="${data.val}" style="width:100%; outline:none;"></audio>`, 'received');
    }
});

// --- 5. AUDIO RECORDING ---
let recorder;
async function toggleMic() {
    const btn = document.getElementById('mic');
    if(!recorder) {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            recorder = new MediaRecorder(s);
            let chunks = [];
            recorder.ondataavailable = e => chunks.push(e.data);
            recorder.onstop = async () => {
                const blob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' });
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = async () => {
                    const base64data = reader.result;
                    const p = await encMsg(JSON.stringify({ type: 'audio', val: base64data }));
                    socket.emit('encrypted_message', { room: roomKey, payload: p });
                    renderMsg(`<audio controls src="${base64data}" style="width:100%; outline:none;"></audio>`, 'sent');
                };
            };
            recorder.start();
            btn.classList.add('recording');
            btn.innerText = "Stop";
        } catch (err) { alert("Microphone access blocked by browser!"); }
    } else {
        recorder.stop();
        recorder.stream.getTracks().forEach(t => t.stop());
        recorder = null;
        btn.classList.remove('recording');
        btn.innerText = "Mic";
    }
}

// --- 6. FILE TRANSFER (P2P) ---
function sendFile(file) {
    if(!file) return;
    if(!dc || dc.readyState !== 'open') {
        return alert("Peer connection not ready yet. Make sure the other person is in the room!");
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
        const payload = JSON.stringify({type: 'file', name: file.name, val: reader.result});
        dc.send(payload);
        renderMsg(`Sent file: ${file.name}`, 'sent');
    };
}
