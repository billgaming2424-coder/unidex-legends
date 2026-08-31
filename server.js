const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve static files from root and public
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// Global tracking
const onlineUsers = new Map(); // socketId -> { name, location, currentSlot }
const rooms = new Map();       // roomId -> [ players ]

function broadcastGlobalStats() {
    const userList = Array.from(onlineUsers.values());
    io.emit('globalOnlineUpdate', {
        totalOnline: userList.length,
        activePlayers: userList
    });
}

io.on('connection', (socket) => {
    // Default presence on connect
    onlineUsers.set(socket.id, { name: "Guest Trainer", location: "Nexus HQ" });
    broadcastGlobalStats();

    // When client sends their trainer details
    socket.on('registerTrainerPresence', (data) => {
        onlineUsers.set(socket.id, {
            name: data.playerName || "Trainer",
            location: data.location || "Nexus HQ"
        });
        broadcastGlobalStats();
    });

    // Room lobbies (Multiplayer Hub)
    socket.on('joinRoom', ({ roomId, player }) => {
        socket.join(roomId);
        socket.currentRoom = roomId;
        if (!rooms.has(roomId)) rooms.set(roomId, []);
        
        const roomList = rooms.get(roomId);
        // Avoid duplicate entries
        const existingIdx = roomList.findIndex(p => p.id === socket.id);
        const playerData = { ...player, id: socket.id };
        if (existingIdx !== -1) roomList[existingIdx] = playerData;
        else roomList.push(playerData);

        io.to(roomId).emit('roomUpdate', { roomId, players: roomList });
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        broadcastGlobalStats();

        if (socket.currentRoom && rooms.has(socket.currentRoom)) {
            const roomList = rooms.get(socket.currentRoom).filter(p => p.id !== socket.id);
            rooms.set(socket.currentRoom, roomList);
            io.to(socket.currentRoom).emit('roomUpdate', { roomId: socket.currentRoom, players: roomList });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});