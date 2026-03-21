const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path'); // Added for path safety

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e8,
    cors: { origin: "*" } // Added for connection stability
});

const activeRooms = new Map();

// Strict folder serving
app.use(express.static(path.join(__dirname, 'public')));

// Safety Route: If someone goes to a weird URL, send them back to the portal
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
    const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
    for (const [room, createdTime] of activeRooms.entries()) {
        if (now - createdTime > FORTY_EIGHT_HOURS) {
            activeRooms.delete(room);
        }
    }
}, 3600000);

const PORT = process.env.PORT || 3000;

// THE CRITICAL FIX: Explicitly bind to 0.0.0.0 for cloud deployment
server.listen(PORT, '0.0.0.0', () => {
    console.log(`>>> Ghost-chat Live on Port: ${PORT}`);
});
