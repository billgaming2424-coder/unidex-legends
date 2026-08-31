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

const onlineUsers = new Map();
const rooms = new Map();
const globalChatHistory = [];
const pvpBattles = new Map();
const globalMarketListings = [];

let raidBosses = {
    titan: { name: "Void Titan Chronos", hp: 5000, maxHp: 5000, level: 50, reward: 2500 },
    dragon: { name: "Shadow Dragon Netherfang", hp: 12000, maxHp: 12000, level: 90, reward: 8000 }
};
let activeRaidKey = "titan";

function broadcastGlobalStats() {
    const userList = Array.from(onlineUsers.values());
    const leaderboard = [...userList].sort((a, b) => (b.funds || 0) - (a.funds || 0)).slice(0, 10);

    io.emit('globalOnlineUpdate', {
        totalOnline: userList.length,
        activePlayers: userList,
        leaderboard: leaderboard,
        raidBoss: raidBosses[activeRaidKey],
        activeRaidKey: activeRaidKey,
        marketListings: globalMarketListings
    });
    broadcastAdminStats();
}

// --- ADMIN MONITORING PANEL ---
// Set ADMIN_PASSWORD in your environment before deploying publicly, e.g.
//   (Windows)  set ADMIN_PASSWORD=your-real-password && node server.js
//   (Mac/Linux) ADMIN_PASSWORD=your-real-password node server.js
// The fallback below is only for local testing - change it before going live.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "unidex-admin-2026";

const serverStartTime = Date.now();
let peakOnline = 0;
let totalConnectionsSinceStart = 0;

function buildAdminStats() {
    return {
        serverStartTime,
        serverUptimeSec: Math.floor((Date.now() - serverStartTime) / 1000),
        totalOnlineNow: onlineUsers.size,
        peakOnline,
        totalConnectionsSinceStart,
        players: Array.from(onlineUsers.values()),
        rooms: Array.from(rooms.entries()).map(([id, players]) => ({ id, playerCount: players.length, players })),
        activePvpBattles: pvpBattles.size,
        marketListings: globalMarketListings,
        raidBoss: { ...raidBosses[activeRaidKey], key: activeRaidKey },
        timestamp: Date.now()
    };
}

// Admin dashboard connects on its own Socket.IO namespace, kept fully separate
// from player sockets/onlineUsers so admin connections never show up as
// "players" and never receive game broadcasts (and vice versa).
const adminIo = io.of('/admin');
const authenticatedAdminIds = new Set();

function broadcastAdminStats() {
    if (authenticatedAdminIds.size === 0) return;
    const stats = buildAdminStats();
    authenticatedAdminIds.forEach((id) => {
        const s = adminIo.sockets.get(id);
        if (s) s.emit('statsUpdate', stats);
    });
}

adminIo.on('connection', (socket) => {
    socket.emit('needAuth');

    socket.on('authenticate', (password) => {
        if (typeof password === 'string' && password === ADMIN_PASSWORD) {
            authenticatedAdminIds.add(socket.id);
            socket.emit('authResult', { success: true });
            socket.emit('statsUpdate', buildAdminStats());
        } else {
            socket.emit('authResult', { success: false });
        }
    });

    socket.on('requestStats', () => {
        if (authenticatedAdminIds.has(socket.id)) {
            socket.emit('statsUpdate', buildAdminStats());
        }
    });

    socket.on('disconnect', () => {
        authenticatedAdminIds.delete(socket.id);
    });
});

io.on('connection', (socket) => {
    onlineUsers.set(socket.id, {
        id: socket.id,
        name: "Trainer",
        location: "Nexus HQ",
        funds: 5000,
        champion: "Partner",
        power: 25,
        saveSlot: null,
        connectedAt: Date.now()
    });
    totalConnectionsSinceStart++;
    peakOnline = Math.max(peakOnline, onlineUsers.size);
    broadcastGlobalStats();

    socket.emit('chatHistory', globalChatHistory);
    socket.emit('raidBossUpdate', raidBosses[activeRaidKey]);

    socket.on('registerTrainerPresence', (data) => {
        const existing = onlineUsers.get(socket.id);
        onlineUsers.set(socket.id, {
            id: socket.id,
            name: data.playerName || "Trainer",
            location: data.location || "Nexus HQ",
            funds: data.funds || 0,
            champion: data.champion || "Partner",
            power: data.power || 25,
            saveSlot: data.saveSlot || null,
            connectedAt: existing ? existing.connectedAt : Date.now()
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
        broadcastAdminStats();
    });

    socket.on('selectRaidTier', (tierKey) => {
        if (!raidBosses[tierKey]) return;
        const current = raidBosses[activeRaidKey];
        // Don't let someone yank the boss out from under a fight already in progress.
        if (tierKey !== activeRaidKey && current.hp > 0 && current.hp < current.maxHp) {
            socket.emit('raidBossUpdate', current);
            return;
        }
        activeRaidKey = tierKey;
        io.emit('raidBossUpdate', raidBosses[activeRaidKey]);
        broadcastAdminStats();
    });

    socket.on('attackRaidBoss', ({ damage, trainerName, championName }) => {
        const currentBoss = raidBosses[activeRaidKey];
        currentBoss.hp = Math.max(0, currentBoss.hp - damage);
        const logMsg = `💥 ${trainerName}'s ${championName} struck ${currentBoss.name} for ${damage} DMG!`;

        io.emit('raidBossHit', {
            bossHp: currentBoss.hp,
            bossMaxHp: currentBoss.maxHp,
            log: logMsg,
            isDefeated: currentBoss.hp <= 0,
            slayer: trainerName,
            reward: currentBoss.reward
        });

        if (currentBoss.hp <= 0) {
            setTimeout(() => {
                currentBoss.hp = currentBoss.maxHp;
                io.emit('raidBossUpdate', currentBoss);
                broadcastAdminStats();
            }, 25000);
        }
        broadcastAdminStats();
    });

    socket.on('createMarketListing', ({ item, price, sellerName }) => {
        const listing = {
            id: 'LIST_' + Date.now(),
            sellerId: socket.id,
            sellerName: sellerName,
            item: item,
            price: price
        };
        globalMarketListings.push(listing);
        io.emit('marketUpdate', globalMarketListings);
        broadcastAdminStats();
    });

    socket.on('buyMarketListing', ({ listingId, buyerName }) => {
        const idx = globalMarketListings.findIndex(l => l.id === listingId);
        if (idx !== -1) {
            const itemObj = globalMarketListings.splice(idx, 1)[0];
            io.to(itemObj.sellerId).emit('itemSoldNotification', { item: itemObj.item, price: itemObj.price, buyer: buyerName });
            socket.emit('itemPurchasedSuccess', itemObj);
            io.emit('marketUpdate', globalMarketListings);
            broadcastAdminStats();
        }
    });

    socket.on('offerTradeItem', ({ roomId, targetId, item, senderName }) => {
        socket.to(targetId).emit('receiveTradeOffer', { senderId: socket.id, senderName, item });
    });

    socket.on('acceptTradeOffer', ({ targetId, targetItem, myItem, senderName, offererName }) => {
        socket.to(targetId).emit('tradeCompleted', { receivedItem: myItem, partnerName: senderName });
        socket.emit('tradeCompleted', { receivedItem: targetItem, partnerName: offererName || "Partner" });
    });

    socket.on('offerTradeCharacter', ({ roomId, targetId, character, senderName }) => {
        socket.to(targetId).emit('receiveCharacterTradeOffer', { senderId: socket.id, senderName, character });
    });

    socket.on('acceptCharacterTradeOffer', ({ targetId, targetCharacter, myCharacter, senderName, offererName }) => {
        socket.to(targetId).emit('characterTradeCompleted', { receivedCharacter: myCharacter, partnerName: senderName });
        socket.emit('characterTradeCompleted', { receivedCharacter: targetCharacter, partnerName: offererName || "Partner" });
    });

    socket.on('declineTradeOffer', ({ targetId, declinerName }) => {
        socket.to(targetId).emit('tradeOfferDeclined', { declinerName: declinerName || "The trainer" });
    });

    socket.on('requestPvP', ({ roomId, targetId, challengerName, champion }) => {
        socket.to(targetId).emit('pvpChallengeReceived', { challengerId: socket.id, challengerName, champion });
    });

    socket.on('acceptPvP', ({ challengerId, accepterName, champion }) => {
        const battleId = `PVP_${socket.id}_${challengerId}`;
        const p1Max = 120;
        const p2Max = 120;
        pvpBattles.set(battleId, {
            p1Id: challengerId, p2Id: socket.id, turn: challengerId,
            p1Name: "Challenger", p2Name: accepterName,
            p1Hp: p1Max, p2Hp: p2Max, p1Guard: false, p2Guard: false
        });

        const payload = { battleId, p1Id: challengerId, p2Id: socket.id, p1Max, p2Max };
        io.to(challengerId).emit('startLivePvP', payload);
        socket.emit('startLivePvP', payload);
        broadcastAdminStats();
    });

    socket.on('executeLivePvPAction', ({ battleId, actionType, power, championName }) => {
        const b = pvpBattles.get(battleId);
        if (!b) return;

        let isP1 = socket.id === b.p1Id;
        let logMsg = "";

        if (actionType === "guard") {
            if (isP1) b.p1Guard = true;
            else b.p2Guard = true;
            logMsg = `${championName} took a defensive GUARD stance!`;
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
            logMsg = `${championName} executed ${actionType.toUpperCase()} for ${rawDmg} DMG!`;
        }

        b.turn = isP1 ? b.p2Id : b.p1Id;
        const statePayload = {
            battleId, turn: b.turn, p1Hp: b.p1Hp, p2Hp: b.p2Hp,
            lastActionLog: logMsg, isOver: b.p1Hp <= 0 || b.p2Hp <= 0,
            winnerId: b.p1Hp <= 0 ? b.p2Id : (b.p2Hp <= 0 ? b.p1Id : null)
        };

        io.to(b.p1Id).emit('pvpRoundUpdate', statePayload);
        io.to(b.p2Id).emit('pvpRoundUpdate', statePayload);
        if (statePayload.isOver) { pvpBattles.delete(battleId); broadcastAdminStats(); }
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        broadcastGlobalStats();
        if (socket.currentRoom && rooms.has(socket.currentRoom)) {
            let roomList = rooms.get(socket.currentRoom).filter(p => p.id !== socket.id);
            rooms.set(socket.currentRoom, roomList);
            io.to(socket.currentRoom).emit('roomUpdate', { roomId: socket.currentRoom, players: roomList });
            broadcastAdminStats();
        }
    });
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});