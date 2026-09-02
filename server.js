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
const pendingPvpChallenges = new Map(); // key `${challengerId}_${targetId}` -> { challengerName, party }
const globalMarketListings = [];

// Sanitizes a client-submitted party payload for a live PvP duel: caps size at 6,
// coerces hp/maxHp/power to sane numbers, and drops any member already at 0 HP so a
// stale/fainted save state can't be used to sneak a free knockout into a fresh duel.
function normalizePvpParty(rawParty) {
    if (!Array.isArray(rawParty)) return [];
    return rawParty.slice(0, 6).map(m => {
        const maxHp = (typeof m.maxHp === 'number' && m.maxHp > 0) ? m.maxHp : 100;
        const hp = (typeof m.hp === 'number' && m.hp >= 0) ? Math.min(m.hp, maxHp) : maxHp;
        const power = (typeof m.power === 'number' && m.power > 0) ? m.power : 10;
        return { uid: m.uid, name: m.name || "Fighter", power, hp, maxHp };
    }).filter(m => m.hp > 0);
}

// HP boosted ~1.4x (same ENEMY_HP_MULTIPLIER used client-side for regular enemies).
// baseAtk/armorPen are new - the raid boss never retaliated against players at all
// before this pass, so there was no prior ATK value to scale up from.
let raidBosses = {
    titan: { name: "Void Titan Chronos", hp: 7000, maxHp: 7000, level: 50, reward: 2500, baseAtk: 45, armorPen: 0.2 },
    dragon: { name: "Shadow Dragon Netherfang", hp: 17000, maxHp: 17000, level: 90, reward: 8000, baseAtk: 90, armorPen: 0.3 }
};
let activeRaidKey = "titan";

// ---- Combat balance (raid boss retaliation) ----
// Mirrors the client-side constants/formula in public/index.html
// (DEFENSE_MITIGATION_K / MIN_TRUE_DAMAGE_FLOOR / computeMitigatedDamage) - keep
// both copies in sync if these get retuned, since there's no shared module between
// the browser and this server.
const RAID_ENRAGE_HP_PCT = 0.30;      // boss enrages once at or below this % of max HP
const RAID_ENRAGE_ATK_MULT = 1.5;
const RAID_BOSS_CRIT_CHANCE = 0.12;
const RAID_BOSS_CRIT_MULTIPLIER = 1.5;
const DEFENSE_MITIGATION_K = 50;
const MIN_TRUE_DAMAGE_FLOOR = 3;

// Asymptotic mitigation (defense / (defense + K)) can approach but never reach 100%
// reduction, and armorPenPct further shrinks the defense the formula sees. The
// MIN_TRUE_DAMAGE_FLOOR is a second, independent backstop on top of that - together
// these are what make a 0-damage hit impossible (this was the reported bug: with no
// formula like this in place at all, the boss simply never dealt any damage).
function computeMitigatedDamage(rawDamage, defense, armorPenPct) {
    const effectiveDefense = Math.max(0, (defense || 0) * (1 - (armorPenPct || 0)));
    const mitigation = effectiveDefense / (effectiveDefense + DEFENSE_MITIGATION_K);
    const mitigated = rawDamage * (1 - mitigation);
    return Math.max(MIN_TRUE_DAMAGE_FLOOR, Math.round(mitigated));
}

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

// Removes a player from a room's roster (used both when they switch rooms and when
// they disconnect entirely) and broadcasts the updated room list to whoever's left.
function removeFromRoom(socketId, roomId) {
    if (!roomId || !rooms.has(roomId)) return;
    const roomList = rooms.get(roomId).filter(p => p.id !== socketId);
    if (roomList.length) {
        rooms.set(roomId, roomList);
    } else {
        rooms.delete(roomId);
    }
    io.to(roomId).emit('roomUpdate', { roomId, players: roomList });
}

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
        const trainerName = data.playerName || "Trainer";
        onlineUsers.set(socket.id, {
            id: socket.id,
            name: trainerName,
            location: data.location || "Nexus HQ",
            funds: data.funds || 0,
            champion: data.champion || "Partner",
            power: data.power || 25,
            saveSlot: data.saveSlot || null,
            connectedAt: existing ? existing.connectedAt : Date.now()
        });

        // registerTrainerPresence fires on every save/UI update, but a "join" should only
        // be announced once per connection - the first time we learn this socket's real name.
        if (!socket.joinAnnounced) {
            socket.joinAnnounced = true;
            socket.broadcast.emit('playerJoinedServer', { name: trainerName });
        }
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
        if (socket.currentRoom && socket.currentRoom !== roomId) {
            socket.leave(socket.currentRoom);
            removeFromRoom(socket.id, socket.currentRoom);
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

    socket.on('leaveRoom', () => {
        if (socket.currentRoom) {
            const oldRoom = socket.currentRoom;
            socket.leave(oldRoom);
            removeFromRoom(socket.id, oldRoom);
            socket.currentRoom = null;
            broadcastAdminStats();
        }
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

    socket.on('attackRaidBoss', ({ damage, trainerName, championName, defense }) => {
        const currentBoss = raidBosses[activeRaidKey];
        // Once the boss is at 0 HP it's waiting on its 25s respawn timer - without this
        // guard, every stray hit during that window re-broadcast isDefeated:true (with
        // reward info) to whoever was attacking, letting a player leave and re-enter the
        // raid screen to re-claim the kill reward repeatedly before it actually respawned.
        if (currentBoss.hp <= 0) return;
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
        } else {
            // The boss strikes back at whoever just landed a hit (not a kill - no point
            // retaliating from beyond the grave). Enrage phase kicks in under 30% HP.
            const enraged = currentBoss.hp <= currentBoss.maxHp * RAID_ENRAGE_HP_PCT;
            const baseAtk = currentBoss.baseAtk || 40;
            const atk = enraged ? Math.round(baseAtk * RAID_ENRAGE_ATK_MULT) : baseAtk;
            const isCrit = Math.random() < RAID_BOSS_CRIT_CHANCE;
            const rawRetaliation = atk * (isCrit ? RAID_BOSS_CRIT_MULTIPLIER : 1);
            const retaliation = computeMitigatedDamage(rawRetaliation, defense, currentBoss.armorPen || 0.15);
            socket.emit('raidBossRetaliate', { damage: retaliation, isCrit, enraged, bossName: currentBoss.name });
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
        if (idx !== -1 && globalMarketListings[idx].sellerId !== socket.id) {
            const itemObj = globalMarketListings.splice(idx, 1)[0];
            io.to(itemObj.sellerId).emit('itemSoldNotification', { item: itemObj.item, price: itemObj.price, buyer: buyerName });
            socket.emit('itemPurchasedSuccess', itemObj);
            io.emit('marketUpdate', globalMarketListings);
            broadcastAdminStats();
        }
    });

    socket.on('cancelMarketListing', ({ listingId }) => {
        const idx = globalMarketListings.findIndex(l => l.id === listingId && l.sellerId === socket.id);
        if (idx !== -1) {
            const itemObj = globalMarketListings.splice(idx, 1)[0];
            socket.emit('marketListingCancelled', itemObj);
            io.emit('marketUpdate', globalMarketListings);
            broadcastAdminStats();
        }
    });

    // Generalized trade protocol - one pipeline for items, characters, and cash alike.
    // offerTrade carries {kind, payload}; acceptTrade carries what the accepter gives
    // back (`give`) plus an echo of what they received (`receive`) so both sides can
    // apply the swap to their own save without the server needing to know game state.
    socket.on('offerTrade', ({ roomId, targetId, kind, payload, senderName }) => {
        socket.to(targetId).emit('receiveTradeOffer', { senderId: socket.id, senderName, kind, payload });
    });

    socket.on('acceptTrade', ({ targetId, senderName, offererName, give, receive }) => {
        socket.to(targetId).emit('tradeCompleted', { received: give, partnerName: senderName });
        socket.emit('tradeCompleted', { received: receive, partnerName: offererName || "Partner" });
    });

    socket.on('declineTradeOffer', ({ targetId, declinerName }) => {
        socket.to(targetId).emit('tradeOfferDeclined', { declinerName: declinerName || "The trainer" });
    });

    socket.on('requestPvP', ({ roomId, targetId, challengerName, party }) => {
        pendingPvpChallenges.set(`${socket.id}_${targetId}`, { challengerName, party });
        socket.to(targetId).emit('pvpChallengeReceived', { challengerId: socket.id, challengerName, party });
    });

    socket.on('declinePvP', ({ challengerId, declinerName }) => {
        pendingPvpChallenges.delete(`${challengerId}_${socket.id}`);
        socket.to(challengerId).emit('pvpChallengeDeclined', { declinerName: declinerName || "The trainer" });
    });

    socket.on('acceptPvP', ({ challengerId, challengerName, accepterName, party }) => {
        const battleId = `PVP_${challengerId}_${socket.id}_${Date.now()}`;
        const pending = pendingPvpChallenges.get(`${challengerId}_${socket.id}`);
        pendingPvpChallenges.delete(`${challengerId}_${socket.id}`);

        const p1Party = normalizePvpParty((pending && pending.party) || []);
        const p2Party = normalizePvpParty(party || []);
        if (!p1Party.length || !p2Party.length) return; // malformed/empty party payload - bail safely

        pvpBattles.set(battleId, {
            p1Id: challengerId, p2Id: socket.id, turn: challengerId,
            p1Name: (pending && pending.challengerName) || challengerName || "Challenger", p2Name: accepterName,
            p1Party, p2Party, p1ActiveIdx: 0, p2ActiveIdx: 0,
            p1Guard: false, p2Guard: false, needsSwap: null
        });

        const payload = {
            battleId, p1Id: challengerId, p2Id: socket.id, turn: challengerId,
            p1Party, p2Party, p1ActiveIdx: 0, p2ActiveIdx: 0,
            challengerName: (pending && pending.challengerName) || challengerName, accepterName
        };
        io.to(challengerId).emit('startLivePvP', payload);
        socket.emit('startLivePvP', payload);
        broadcastAdminStats();
    });

    socket.on('executeLivePvPAction', ({ battleId, actionType, power, championName, swapToIdx }) => {
        const b = pvpBattles.get(battleId);
        if (!b) return;

        const isP1 = socket.id === b.p1Id;
        const isP2 = socket.id === b.p2Id;
        if (!isP1 && !isP2) return; // not a participant in this duel

        // Turn/authority validation: normally only the player whose turn it is may act.
        // While a side has a fainted active fighter (needsSwap set), ONLY that side may
        // act, and ONLY via a swap - this closes off both "acting out of turn" and
        // "attacking while your own fighter is down" exploits.
        if (b.needsSwap) {
            const mySide = isP1 ? 'p1' : 'p2';
            if (mySide !== b.needsSwap || actionType !== 'swap') return;
        } else if (socket.id !== b.turn) {
            return;
        }

        const myParty = isP1 ? b.p1Party : b.p2Party;
        const oppParty = isP1 ? b.p2Party : b.p1Party;
        const myActiveIdxKey = isP1 ? 'p1ActiveIdx' : 'p2ActiveIdx';
        const oppActiveIdxKey = isP1 ? 'p2ActiveIdx' : 'p1ActiveIdx';
        const myGuardKey = isP1 ? 'p1Guard' : 'p2Guard';
        const oppGuardKey = isP1 ? 'p2Guard' : 'p1Guard';
        const myName = isP1 ? b.p1Name : b.p2Name;

        let logMsg = "";

        if (actionType === "swap") {
            const target = myParty[swapToIdx];
            if (!target || target.hp <= 0) return; // can't swap into an empty/fainted slot
            b[myActiveIdxKey] = swapToIdx;
            logMsg = `${myName} sent out ${target.name}!`;
            b.needsSwap = null;
            b.turn = isP1 ? b.p2Id : b.p1Id; // swapping (forced or voluntary) passes the turn
        } else if (actionType === "guard") {
            b[myGuardKey] = true;
            logMsg = `${championName || myName} took a defensive GUARD stance!`;
            b.turn = isP1 ? b.p2Id : b.p1Id;
        } else {
            const attacker = myParty[b[myActiveIdxKey]];
            const defender = oppParty[b[oppActiveIdxKey]];
            if (!attacker || !defender) return;
            const mult = actionType === "special" ? 1.8 : 1.0;
            let rawDmg = Math.floor(((power || attacker.power || 10) + Math.random() * 10) * mult);
            if (b[oppGuardKey]) { rawDmg = Math.floor(rawDmg * 0.5); b[oppGuardKey] = false; }
            defender.hp = Math.max(0, defender.hp - rawDmg);
            logMsg = `${attacker.name} executed ${actionType.toUpperCase()} for ${rawDmg} DMG on ${defender.name}!`;

            if (defender.hp <= 0) {
                logMsg += ` ${defender.name} fainted!`;
                const oppAlive = oppParty.some(m => m.hp > 0);
                if (!oppAlive) {
                    const statePayload = {
                        battleId, turn: null, p1Party: b.p1Party, p2Party: b.p2Party,
                        p1ActiveIdx: b.p1ActiveIdx, p2ActiveIdx: b.p2ActiveIdx,
                        lastActionLog: `${logMsg} ${isP1 ? b.p2Name : b.p1Name}'s whole party is down!`,
                        isOver: true, winnerId: socket.id, needsSwap: null
                    };
                    io.to(b.p1Id).emit('pvpRoundUpdate', statePayload);
                    io.to(b.p2Id).emit('pvpRoundUpdate', statePayload);
                    pvpBattles.delete(battleId);
                    broadcastAdminStats();
                    return;
                }
                b.needsSwap = isP1 ? 'p2' : 'p1';
            } else {
                b.turn = isP1 ? b.p2Id : b.p1Id;
            }
        }

        const statePayload = {
            battleId, turn: b.needsSwap ? null : b.turn,
            p1Party: b.p1Party, p2Party: b.p2Party,
            p1ActiveIdx: b.p1ActiveIdx, p2ActiveIdx: b.p2ActiveIdx,
            lastActionLog: logMsg, isOver: false, winnerId: null,
            needsSwap: b.needsSwap
        };

        io.to(b.p1Id).emit('pvpRoundUpdate', statePayload);
        io.to(b.p2Id).emit('pvpRoundUpdate', statePayload);
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        broadcastGlobalStats();
        if (socket.currentRoom) {
            removeFromRoom(socket.id, socket.currentRoom);
            broadcastAdminStats();
        }
        // Don't leave the other side of a live duel stuck waiting forever.
        for (const [battleId, b] of pvpBattles.entries()) {
            if (b.p1Id === socket.id || b.p2Id === socket.id) {
                const survivorId = b.p1Id === socket.id ? b.p2Id : b.p1Id;
                io.to(survivorId).emit('pvpRoundUpdate', {
                    battleId, turn: null,
                    p1Party: b.p1Party, p2Party: b.p2Party,
                    p1ActiveIdx: b.p1ActiveIdx, p2ActiveIdx: b.p2ActiveIdx,
                    lastActionLog: "Your opponent disconnected - you win by default!",
                    isOver: true, winnerId: survivorId, needsSwap: null
                });
                pvpBattles.delete(battleId);
            }
        }
        for (const key of pendingPvpChallenges.keys()) {
            if (key.startsWith(`${socket.id}_`) || key.endsWith(`_${socket.id}`)) pendingPvpChallenges.delete(key);
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