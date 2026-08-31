const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

const onlineUsers = new Map(); // socketId -> { name, location }
const globalChatHistory = [];  // recent chat logs

function broadcastGlobalStats() {
    const userList = Array.from(onlineUsers.values());
    io.emit('globalOnlineUpdate', {
        totalOnline: userList.length,
        activePlayers: userList
    });
}

io.on('connection', (socket) => {
    onlineUsers.set(socket.id, { name: "Guest Trainer", location: "Nexus HQ" });
    broadcastGlobalStats();

    socket.emit('chatHistory', globalChatHistory);

    socket.on('registerTrainerPresence', (data) => {
        onlineUsers.set(socket.id, {
            name: data.playerName || "Trainer",
            location: data.location || "Nexus HQ"
        });
        broadcastGlobalStats();
    });

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

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        broadcastGlobalStats();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});