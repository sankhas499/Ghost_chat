const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path'); // The GPS for your files

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e8,
    cors: { origin: "*" } 
});

const activeRooms = new Map();

// --- THE FIX: Tell the server exactly where the 'public' folder is ---
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Safety Route: If the server is confused, manually point it to index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

io.on('connection', (socket) => {
    socket.on('create_room', (room) => {
        if (!activeRooms.has(room)) {
            activeRooms.set(room, Date.now());
            console.log(`Room Created: ${room}`);
        }
        socket.join(room);
    });

    socket.on('join_attempt', (room) => {
        if (activeRooms.has(room)) {
            socket.join(room);
            socket.emit('join_success', room);
            socket.to(room).emit('peer_ready');
        } else {
            socket.emit('join_error', "invalid output");
        }
    });

    socket.on('encrypted_message', (data) => {
        if (data.room && activeRooms.has(data.room)) {
            socket.to(data.room).emit('encrypted_message', data.payload);
        }
    });

    socket.on('webrtc_signal', (data) => {
        if (data.room && activeRooms.has(data.room)) {
            socket.to(data.room).emit('webrtc_signal', data.signal);
        }
    });
});

setInterval(() => {
    const now = Date.now();
    const expiry = 48 * 60 * 60 * 1000;
    for (const [room, createdTime] of activeRooms.entries()) {
        if (now - createdTime > expiry) activeRooms.delete(room);
    }
}, 3600000);

const PORT = process.env.PORT || 3000;

// Force the server to listen to '0.0.0.0' so Render can find it
server.listen(PORT, '0.0.0.0', () => {
    console.log(`>>> Ghost-chat Secure Engine Live on port ${PORT}`);
});
