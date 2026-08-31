const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static("public"));

const players = new Map();
const messages = [];

function broadcastPlayers() {
  const activePlayers = [...players.values()];
  io.emit("globalOnlineUpdate", {
    totalOnline: activePlayers.length,
    activePlayers
  });
}

io.on("connection", (socket) => {
  socket.emit("chatHistory", messages);
  broadcastPlayers();

  socket.on("registerTrainerPresence", (data = {}) => {
    players.set(socket.id, {
      id: socket.id,
      name: String(data.playerName || "Trainer").slice(0, 30),
      location: String(data.location || "Nexus HQ").slice(0, 50)
    });
    broadcastPlayers();
  });

  socket.on("sendGlobalMessage", (data = {}) => {
    const msg = {
      name: String(data.name || "Trainer").slice(0, 30),
      text: String(data.text || "").slice(0, 300),
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })
    };

    if (!msg.text.trim()) return;

    messages.push(msg);
    if (messages.length > 50) messages.shift();
    io.emit("receiveGlobalMessage", msg);
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    broadcastPlayers();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`UniDex server running on http://localhost:${PORT}`);
});
