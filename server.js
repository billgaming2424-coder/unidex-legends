const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Parse JSON bodies for API requests
app.use(express.json());

// Global state tracking for multiplayer and live presence
const onlineUsers = new Map(); // socketId -> { name, location }
const rooms = new Map();       // roomId -> [ players ]
const globalChatHistory = [];  // recent global chat messages

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

    // Send existing chat history to new connection
    socket.emit('chatHistory', globalChatHistory);

    // Register active user metadata
    socket.on('registerTrainerPresence', (data) => {
        onlineUsers.set(socket.id, {
            name: data.playerName || "Trainer",
            location: data.location || "Nexus HQ"
        });
        broadcastGlobalStats();
    });

    // Global Chat Messaging
    socket.on('sendGlobalMessage', (msgData) => {
        const entry = { 
            name: msgData.name || "Trainer", 
            text: msgData.text || "", 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        };
        globalChatHistory.push(entry);
        if (globalChatHistory.length > 50) globalChatHistory.shift();
        io.emit('receiveGlobalMessage', entry);
    });

    // Multiplayer Room Lobbies (Joining Rooms)
    socket.on('joinRoom', ({ roomId, player }) => {
        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
        }
        
        socket.join(roomId);
        socket.currentRoom = roomId;
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, []);
        }
        
        const roomList = rooms.get(roomId);
        const existingIdx = roomList.findIndex(p => p.id === socket.id);
        const playerData = { ...player, id: socket.id };
        
        if (existingIdx !== -1) {
            roomList[existingIdx] = playerData;
        } else {
            roomList.push(playerData);
        }

        io.to(roomId).emit('roomUpdate', { roomId, players: roomList });
    });

    // Clean up on disconnect
    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        broadcastGlobalStats();

        if (socket.currentRoom && rooms.has(socket.currentRoom)) {
            let roomList = rooms.get(socket.currentRoom).filter(p => p.id !== socket.id);
            rooms.set(socket.currentRoom, roomList);
            io.to(socket.currentRoom).emit('roomUpdate', { roomId: socket.currentRoom, players: roomList });
        }
    });
});

// Catch-all route to serve your index.html for UI navigation
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});