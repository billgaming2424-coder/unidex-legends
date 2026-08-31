const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/pictures', express.static(path.join(__dirname, 'public', 'pictures')));
app.use('/music', express.static(path.join(__dirname, 'public', 'music')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Multiplayer Lobby State
const rooms = {};

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  socket.on('joinRoom', ({ roomId, player }) => {
    socket.join(roomId);
    socket.currentRoom = roomId;

    if (!rooms[roomId]) rooms[roomId] = [];

    const existingIdx = rooms[roomId].findIndex(p => p.id === socket.id);
    const playerData = {
      id: socket.id,
      name: player.name || "Manager",
      staffCount: (player.staff || []).length,
      leadStaff: player.staff && player.staff.length > 0 ? player.staff[0].name : "None",
      funds: player.funds || 0
    };

    if (existingIdx !== -1) {
      rooms[roomId][existingIdx] = playerData;
    } else {
      rooms[roomId].push(playerData);
    }

    console.log(`[Lobby Joined] ${playerData.name} entered Room ${roomId} (Total: ${rooms[roomId].length})`);
    io.to(roomId).emit('roomUpdate', { roomId, players: rooms[roomId] });
  });

  socket.on('sendLobbyChat', ({ roomId, sender, message }) => {
    io.to(roomId).emit('chatMessage', { sender, message, timestamp: new Date().toLocaleTimeString() });
  });

  socket.on('disconnect', () => {
    const roomId = socket.currentRoom;
    if (roomId && rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(p => p.id !== socket.id);
      io.to(roomId).emit('roomUpdate', { roomId, players: rooms[roomId] });
      if (rooms[roomId].length === 0) delete rooms[roomId];
    }
    console.log(`[Socket Disconnected] ID: ${socket.id}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});