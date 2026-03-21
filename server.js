const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

// THE REGISTRY: Stores valid room keys and their creation time
const activeRooms = new Map();

app.use(express.static('public'));

io.on('connection', (socket) => {
    
    // 1. CREATE ROOM: Host registers a real key
    socket.on('create_room', (room) => {
        if (!activeRooms.has(room)) {
            activeRooms.set(room, Date.now());
            console.log(`Room Created: ${room}`);
        }
        socket.join(room);
    });

    // 2. JOIN ROOM: Server checks if the key is real
    socket.on('join_attempt', (room) => {
        if (activeRooms.has(room)) {
            socket.join(room);
            socket.emit('join_success', room);
            socket.to(room).emit('peer_ready'); // Tell host someone joined
        } else {
            // Reject invalid/random keys
            socket.emit('join_error', "invalid output");
        }
    });

    // Routing chat & files ONLY if the room is valid
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

// 3. AUTO-DESTRUCT: 48-Hour Garbage Collector
setInterval(() => {
    const now = Date.now();
    const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
    
    for (const [room, createdTime] of activeRooms.entries()) {
        if (now - createdTime > FORTY_EIGHT_HOURS) {
            activeRooms.delete(room);
            console.log(`Room Self-Destructed (48H): ${room}`);
        }
    }
}, 3600000); // Scans the registry every 1 hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\x1b[32m%s\x1b[0m`, `>>> Ghost-chat Secure Engine Live: http://localhost:${PORT}`);
});
