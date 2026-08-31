const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.use(express.json());

const onlineUsers = new Map(); // socketId -> { id, name, location, funds, champion, power }
const rooms = new Map();       // roomId -> [ players ]
const globalChatHistory = [];
const pvpBattles = new Map();

function broadcastGlobalStats() {
    const userList = Array.from(onlineUsers.values());
    const leaderboard = [...userList].sort((a, b) => (b.funds || 0) - (a.funds || 0)).slice(0, 10);

    io.emit('globalOnlineUpdate', {
        totalOnline: userList.length,
        activePlayers: userList,
        leaderboard: leaderboard
    });
}

io.on('connection', (socket) => {
    onlineUsers.set(socket.id, {
        id: socket.id,
        name: "Trainer",
        location: "Nexus HQ",
        funds: 5000,
        champion: "Partner",
        power: 25
    });
    broadcastGlobalStats();

    socket.emit('chatHistory', globalChatHistory);

    socket.on('registerTrainerPresence', (data) => {
        onlineUsers.set(socket.id, {
            id: socket.id,
            name: data.playerName || "Trainer",
            location: data.location || "Nexus HQ",
            funds: data.funds || 0,
            champion: data.champion || "Partner",
            power: data.power || 25
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

    socket.on('sendRoomMessage', ({ roomId, name, text }) => {
        const entry = { 
            name: name || "Trainer", 
            text: text || "", 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        };
        io.to(roomId).emit('receiveRoomMessage', entry);
    });

    socket.on('joinRandomRoom', ({ player }) => {
        let selectedRoom = null;
        for (const [rId, pList] of rooms.entries()) {
            if (pList.length > 0 && pList.length < 4 && rId !== socket.currentRoom) {
                selectedRoom = rId;
                break;
            }
        }
        if (!selectedRoom) {
            selectedRoom = "ROOM_" + Math.floor(1000 + Math.random() * 9000);
        }
        socket.emit('assignedRandomRoom', selectedRoom);
    });

    socket.on('joinRoom', ({ roomId, player }) => {
        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
        }
        socket.join(roomId);
        socket.currentRoom = roomId;

        if (!rooms.has(roomId)) rooms.set(roomId, []);
        const roomList = rooms.get(roomId);
        const existingIdx = roomList.findIndex(p => p.id === socket.id);
        const playerData = { ...player, id: socket.id };

        if (existingIdx !== -1) roomList[existingIdx] = playerData;
        else roomList.push(playerData);

        io.to(roomId).emit('roomUpdate', { roomId, players: roomList });
    });

    // --- ITEM TRADING ---
    socket.on('offerTradeItem', ({ roomId, targetId, item, senderName }) => {
        socket.to(targetId).emit('receiveTradeOffer', {
            senderId: socket.id,
            senderName: senderName,
            item: item
        });
    });

    socket.on('acceptTradeOffer', ({ targetId, targetItem, myItem, senderName }) => {
        socket.to(targetId).emit('tradeCompleted', { receivedItem: myItem, partnerName: senderName });
        socket.emit('tradeCompleted', { receivedItem: targetItem, partnerName: "Partner" });
    });

    // --- CHARACTER / COMPANION TRADING ---
    socket.on('offerTradeCharacter', ({ roomId, targetId, character, senderName }) => {
        socket.to(targetId).emit('receiveCharacterTradeOffer', {
            senderId: socket.id,
            senderName: senderName,
            character: character
        });
    });

    socket.on('acceptCharacterTradeOffer', ({ targetId, targetCharacter, myCharacter, senderName }) => {
        socket.to(targetId).emit('characterTradeCompleted', { receivedCharacter: myCharacter, partnerName: senderName });
        socket.emit('characterTradeCompleted', { receivedCharacter: targetCharacter, partnerName: "Partner" });
    });

    // --- REAL-TIME PVP DUELS ---
    socket.on('requestPvP', ({ roomId, targetId, challengerName, champion }) => {
        socket.to(targetId).emit('pvpChallengeReceived', {
            challengerId: socket.id,
            challengerName: challengerName,
            champion: champion
        });
    });

    socket.on('acceptPvP', ({ challengerId, accepterName, champion }) => {
        const battleId = `PVP_${socket.id}_${challengerId}`;
        const p1Max = 120;
        const p2Max = 120;
        pvpBattles.set(battleId, {
            p1Id: challengerId,
            p2Id: socket.id,
            turn: challengerId,
            p1Name: "Challenger",
            p2Name: accepterName,
            p1Hp: p1Max,
            p2Hp: p2Max,
            p1Guard: false,
            p2Guard: false
        });

        const payload = { battleId, p1Id: challengerId, p2Id: socket.id, p1Max, p2Max };
        io.to(challengerId).emit('startLivePvP', payload);
        socket.emit('startLivePvP', payload);
    });

    socket.on('executeLivePvPAction', ({ battleId, actionType, power, championName }) => {
        const b = pvpBattles.get(battleId);
        if (!b) return;

        let isP1 = socket.id === b.p1Id;
        let logMsg = "";

        if (actionType === "guard") {
            if (isP1) b.p1Guard = true;
            else b.p2Guard = true;
            logMsg = `${championName} braced and took a defensive GUARD stance!`;
        } else {
            let mult = actionType === "special" ? 1.8 : 1.0;
            let rawDmg = Math.floor((power + Math.random() * 10) * mult);
            
            if (isP1) {
                if (b.p2Guard) { rawDmg = Math.floor(rawDmg * 0.5); b.p2Guard = false; }
                b.p2Hp = Math.max(0, b.p2Hp - rawDmg);
            } else {
                if (b.p1Guard) { rawDmg = Math.floor(rawDmg * 0.5); b.p1Guard = false; }
                b.p1Hp = Math.max(0, b.p1Hp - rawDmg);
            }
            logMsg = `${championName} used ${actionType.toUpperCase()} for ${rawDmg} damage!`;
        }

        b.turn = isP1 ? b.p2Id : b.p1Id;

        const statePayload = {
            battleId,
            turn: b.turn,
            p1Hp: b.p1Hp,
            p2Hp: b.p2Hp,
            lastActionLog: logMsg,
            isOver: b.p1Hp <= 0 || b.p2Hp <= 0,
            winnerId: b.p1Hp <= 0 ? b.p2Id : (b.p2Hp <= 0 ? b.p1Id : null)
        };

        io.to(b.p1Id).emit('pvpRoundUpdate', statePayload);
        io.to(b.p2Id).emit('pvpRoundUpdate', statePayload);

        if (statePayload.isOver) {
            pvpBattles.delete(battleId);
        }
    });

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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`UniDex Legends server listening on port ${PORT}`);
});