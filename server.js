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
// roomId -> { membersOnly: boolean } - set once, at room creation, from the creator's
// VIP-toggle choice; never changes for that room's lifetime. Cleared when the room empties.
const roomMeta = new Map();
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
    titan: { name: "Void Titan Chronos", hp: 7000, maxHp: 7000, level: 50, reward: 1250, baseAtk: 45, armorPen: 0.2 },
    dragon: { name: "Shadow Dragon Netherfang", hp: 17000, maxHp: 17000, level: 90, reward: 4000, baseAtk: 90, armorPen: 0.3 },
    // The final raid boss - only offered to players client-side once every Guardian's
    // quest line is finished and the Frozen Death has unlocked (see the client's
    // 'frozen_death_unlocked' story flag), but selectable here like any other tier.
    hollowKing: { name: "The Hollow King", hp: 35000, maxHp: 35000, level: 150, reward: 9000, baseAtk: 140, armorPen: 0.4 }
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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "raven";

// ---- Registered accounts (Supabase, service-role) ----
// The client only ever uses the public anon key (see public/index.html), which is
// locked down by row-level security to "each account can see its own row". Listing
// EVERY registered account for the admin panel needs the service_role key instead,
// which bypasses RLS entirely - so it must never be shipped to the browser. Set it
// server-side only:
//   (Windows)  set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key && node server.js
//   (Mac/Linux) SUPABASE_SERVICE_ROLE_KEY=your-service-role-key node server.js
// (Find it in the Supabase dashboard: Project Settings -> API -> service_role secret.)
// Without it, the "Registered Accounts" panel just shows a setup hint instead of data -
// nothing else breaks.
const SUPABASE_URL = "https://rvetucuqburqnrgoatui.supabase.co";
let supabaseAdmin = null;
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
        const { createClient } = require('@supabase/supabase-js');
        supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    } catch (e) {
        console.warn("SUPABASE_SERVICE_ROLE_KEY is set but @supabase/supabase-js isn't installed - run `npm install` to enable the Registered Accounts admin panel.");
        supabaseAdmin = null;
    }
}

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

// Pulls every registered account (profiles) and left-joins each one's cloud save
// summary, using the service-role client so RLS doesn't limit it to one row.
async function fetchRegisteredPlayers() {
    if (!supabaseAdmin) return { available: false };
    try {
        const { data: profiles, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('id, email, welcome_bundle_claimed, created_at')
            .order('created_at', { ascending: false });
        if (profileErr) throw profileErr;

        const { data: saves, error: saveErr } = await supabaseAdmin
            .from('player_saves')
            .select('user_id, updated_at, save_data');
        if (saveErr) throw saveErr;

        const saveByUser = new Map((saves || []).map(s => [s.user_id, s]));
        const players = (profiles || []).map(p => {
            const save = saveByUser.get(p.id);
            const sd = save ? (save.save_data || {}) : null;
            return {
                id: p.id,
                email: p.email,
                createdAt: p.created_at,
                welcomeBundleClaimed: !!p.welcome_bundle_claimed,
                hasCloudSave: !!save,
                lastSynced: save ? save.updated_at : null,
                playerName: sd ? sd.playerName : null,
                day: sd ? sd.day : null,
                funds: sd ? sd.funds : null
            };
        });
        return { available: true, players, total: players.length };
    } catch (e) {
        return { available: false, error: "Query failed - double-check SUPABASE_SERVICE_ROLE_KEY and that the profiles/player_saves tables exist." };
    }
}

// Mirrors CLOUD_WELCOME_BUNDLE.apply() + addStaffMember()/recordDex() from
// public/index.html so the admin panel can grant the exact same reward
// (Nova, the Cloudlink Sentinel, dexId 9901) directly into a stored cloud
// save - used when a player's account already has welcome_bundle_claimed
// set true (so the client's own one-time grant won't fire again) but their
// actual save data is missing it, e.g. after relinking and overwriting the
// cloud copy with an older/fresh local save.
function adminGenerateSaveUid() {
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
const WELCOME_BUNDLE_DEX_ID = 9901;
function grantWelcomeBundleToSaveData(sd) {
    sd = sd && typeof sd === 'object' ? sd : {};
    if (!Array.isArray(sd.staff)) sd.staff = [];
    if (!Array.isArray(sd.partyUids)) sd.partyUids = [];
    const alreadyHasNova = sd.staff.some(s => s && s.dexId === WELCOME_BUNDLE_DEX_ID);
    if (!alreadyHasNova) {
        const member = {
            uid: adminGenerateSaveUid(),
            name: "Nova, the Cloudlink Sentinel",
            power: 85,
            origin: "Chase Studios Network",
            dexId: WELCOME_BUNDLE_DEX_ID,
            legendary: true
        };
        sd.staff.push(member);
        if (sd.partyUids.length < 6) sd.partyUids.push(member.uid);
        if (!sd.championUid) sd.championUid = member.uid;
    }
    if (!sd.pokedex || typeof sd.pokedex !== 'object') sd.pokedex = {};
    const key = String(WELCOME_BUNDLE_DEX_ID);
    if (!sd.pokedex[key]) sd.pokedex[key] = { discovered: true, shiny: false, count: 1 };
    return sd;
}

adminIo.on('connection', (socket) => {
    socket.emit('needAuth');

    socket.on('authenticate', async (password) => {
        if (typeof password === 'string' && password === ADMIN_PASSWORD) {
            authenticatedAdminIds.add(socket.id);
            socket.emit('authResult', { success: true });
            socket.emit('statsUpdate', buildAdminStats());
            socket.emit('registeredPlayersResult', await fetchRegisteredPlayers());
        } else {
            socket.emit('authResult', { success: false });
        }
    });

    socket.on('requestStats', () => {
        if (authenticatedAdminIds.has(socket.id)) {
            socket.emit('statsUpdate', buildAdminStats());
        }
    });

    socket.on('requestRegisteredPlayers', async () => {
        if (!authenticatedAdminIds.has(socket.id)) return;
        socket.emit('registeredPlayersResult', await fetchRegisteredPlayers());
    });

    // Switches the live raid boss and gives it a full-HP reset. Reuses the same guard
    // players get (selectRaidTier) isn't applied here on purpose - an admin should be
    // able to force a swap even mid-fight if something's stuck.
    socket.on('adminSetRaidTier', (tierKey) => {
        if (!authenticatedAdminIds.has(socket.id) || !raidBosses[tierKey]) return;
        activeRaidKey = tierKey;
        raidBosses[activeRaidKey].hp = raidBosses[activeRaidKey].maxHp;
        io.emit('raidBossUpdate', raidBosses[activeRaidKey]);
        broadcastAdminStats();
    });

    socket.on('adminHealRaidBoss', () => {
        if (!authenticatedAdminIds.has(socket.id)) return;
        const boss = raidBosses[activeRaidKey];
        boss.hp = boss.maxHp;
        io.emit('raidBossUpdate', boss);
        broadcastAdminStats();
    });

    // Drops a message into the same global chat feed every player already has open,
    // tagged so it reads as an official notice rather than another trainer talking.
    socket.on('adminBroadcast', (text) => {
        if (!authenticatedAdminIds.has(socket.id)) return;
        let msg = typeof text === 'string' ? text.trim().slice(0, 300) : '';
        if (!msg) return;
        const entry = { name: "📢 ADMIN", text: msg, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
        globalChatHistory.push(entry);
        if (globalChatHistory.length > 50) globalChatHistory.shift();
        io.emit('receiveGlobalMessage', entry);
    });

    socket.on('adminKickPlayer', (targetSocketId) => {
        if (!authenticatedAdminIds.has(socket.id) || typeof targetSocketId !== 'string') return;
        const target = io.sockets.sockets.get(targetSocketId);
        if (!target) return;
        target.emit('kickedByAdmin', { reason: "Disconnected by an administrator." });
        setTimeout(() => target.disconnect(true), 250);
    });

    // ---- Registered-account support tools (all require the service-role client) ----
    // Every handler below emits a single shared 'adminActionResult' event tagged with
    // an `action` name so the panel can show one generic success/error toast instead
    // of needing a bespoke result event per button.
    function requireAdminDb(action) {
        if (!authenticatedAdminIds.has(socket.id)) return false;
        if (!supabaseAdmin) {
            socket.emit('adminActionResult', { action, success: false, error: "SUPABASE_SERVICE_ROLE_KEY isn't configured on the server." });
            return false;
        }
        return true;
    }

    // Directly injects the welcome bundle (Nova) into a player's stored cloud save,
    // regardless of their profiles.welcome_bundle_claimed flag - for accounts that
    // already "claimed" it once but lost it by relinking over their cloud save with
    // a local save that never had it. Also (re)stamps the claimed flag true so the
    // client's own grant-on-link logic doesn't try to double-grant it later.
    socket.on('adminRegrantWelcomeBundle', async (userId) => {
        const action = 'regrantWelcomeBundle';
        if (!requireAdminDb(action) || typeof userId !== 'string') return;
        try {
            const { data: existing, error: fetchErr } = await supabaseAdmin
                .from('player_saves').select('save_data').eq('user_id', userId).maybeSingle();
            if (fetchErr) throw fetchErr;
            if (!existing) {
                socket.emit('adminActionResult', { action, success: false, error: "That account has no cloud save yet - nothing to grant it into." });
                return;
            }
            const newSaveData = grantWelcomeBundleToSaveData(existing.save_data);
            const { error: updateErr } = await supabaseAdmin
                .from('player_saves').update({ save_data: newSaveData }).eq('user_id', userId);
            if (updateErr) throw updateErr;
            await supabaseAdmin.from('profiles').update({ welcome_bundle_claimed: true }).eq('id', userId);
            socket.emit('adminActionResult', { action, success: true, message: "Welcome bundle granted - Nova is in their roster." });
            socket.emit('registeredPlayersResult', await fetchRegisteredPlayers());
        } catch (e) {
            socket.emit('adminActionResult', { action, success: false, error: "Failed to grant bundle: " + (e.message || 'unknown error') });
        }
    });

    // amount: number. mode: 'add' (default) adds/subtracts from current funds,
    // 'set' pins funds to exactly `amount`. Result is clamped to >= 0.
    socket.on('adminAdjustFunds', async ({ userId, amount, mode } = {}) => {
        const action = 'adjustFunds';
        if (!requireAdminDb(action)) return;
        amount = Number(amount);
        if (typeof userId !== 'string' || !Number.isFinite(amount)) {
            socket.emit('adminActionResult', { action, success: false, error: "Invalid amount." });
            return;
        }
        try {
            const { data: existing, error: fetchErr } = await supabaseAdmin
                .from('player_saves').select('save_data').eq('user_id', userId).maybeSingle();
            if (fetchErr) throw fetchErr;
            if (!existing) {
                socket.emit('adminActionResult', { action, success: false, error: "That account has no cloud save yet." });
                return;
            }
            let sd = existing.save_data && typeof existing.save_data === 'object' ? existing.save_data : {};
            let current = Number(sd.funds) || 0;
            let next = mode === 'set' ? amount : current + amount;
            next = Math.max(0, Math.round(next));
            sd.funds = next;
            const { error: updateErr } = await supabaseAdmin
                .from('player_saves').update({ save_data: sd }).eq('user_id', userId);
            if (updateErr) throw updateErr;
            socket.emit('adminActionResult', { action, success: true, message: `Funds updated - now $${next}.` });
            socket.emit('registeredPlayersResult', await fetchRegisteredPlayers());
        } catch (e) {
            socket.emit('adminActionResult', { action, success: false, error: "Failed to adjust funds: " + (e.message || 'unknown error') });
        }
    });

    // Read-only dump of a player's full save_data blob for debugging support cases.
    socket.on('adminGetRawSave', async (userId) => {
        if (!authenticatedAdminIds.has(socket.id)) return;
        if (!supabaseAdmin) {
            socket.emit('adminRawSaveResult', { userId, success: false, error: "SUPABASE_SERVICE_ROLE_KEY isn't configured on the server." });
            return;
        }
        if (typeof userId !== 'string') return;
        try {
            const { data, error } = await supabaseAdmin
                .from('player_saves').select('save_data, updated_at').eq('user_id', userId).maybeSingle();
            if (error) throw error;
            socket.emit('adminRawSaveResult', {
                userId, success: true,
                saveData: data ? data.save_data : null,
                updatedAt: data ? data.updated_at : null
            });
        } catch (e) {
            socket.emit('adminRawSaveResult', { userId, success: false, error: e.message || 'unknown error' });
        }
    });

    // Deletes a player's cloud save row entirely so they can do a clean fresh link
    // next time - for a save that's gotten into a broken/unrecoverable state. Does
    // NOT touch their profiles row (email/login), only the save data.
    socket.on('adminWipeCloudSave', async (userId) => {
        const action = 'wipeCloudSave';
        if (!requireAdminDb(action) || typeof userId !== 'string') return;
        try {
            const { error } = await supabaseAdmin.from('player_saves').delete().eq('user_id', userId);
            if (error) throw error;
            socket.emit('adminActionResult', { action, success: true, message: "Cloud save deleted - they can link a fresh save next time." });
            socket.emit('registeredPlayersResult', await fetchRegisteredPlayers());
        } catch (e) {
            socket.emit('adminActionResult', { action, success: false, error: "Failed to wipe save: " + (e.message || 'unknown error') });
        }
    });

    // Triggers Supabase's own password-reset email for a given account - same flow
    // as the "Forgot password" link would, just kicked off from the admin panel for
    // support requests instead of needing the Supabase dashboard.
    socket.on('adminSendPasswordReset', async (email) => {
        const action = 'sendPasswordReset';
        if (!requireAdminDb(action) || typeof email !== 'string' || !email.includes('@')) {
            socket.emit('adminActionResult', { action, success: false, error: "Invalid email." });
            return;
        }
        try {
            const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo: 'https://www.chase-studios.org' });
            if (error) throw error;
            socket.emit('adminActionResult', { action, success: true, message: `Password reset email sent to ${email}.` });
        } catch (e) {
            socket.emit('adminActionResult', { action, success: false, error: "Failed to send reset email: " + (e.message || 'unknown error') });
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
        roomMeta.delete(roomId);
    }
    const meta = roomMeta.get(roomId) || { membersOnly: false };
    io.to(roomId).emit('roomUpdate', { roomId, players: roomList, membersOnly: meta.membersOnly });
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
            // Never route random matchmaking into a VIP Members-Only room - those are only
            // reachable by a member typing the exact room code.
            const meta = roomMeta.get(rId) || { membersOnly: false };
            if (meta.membersOnly) continue;
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

    socket.on('joinRoom', ({ roomId, player, membersOnly }) => {
        // A brand-new room gets its privacy locked in from the creator's toggle; an
        // already-existing room keeps whatever it was created with regardless of what a
        // later joiner's client happens to send.
        const isNewRoom = !rooms.has(roomId);
        if (isNewRoom) roomMeta.set(roomId, { membersOnly: !!membersOnly });
        const meta = roomMeta.get(roomId) || { membersOnly: false };

        if (meta.membersOnly && !(player && player.isMember)) {
            socket.emit('roomJoinDenied', "🔒 That room is VIP Members-Only - grab a Casino Membership to join.");
            return;
        }

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

        io.to(roomId).emit('roomUpdate', { roomId, players: roomList, membersOnly: meta.membersOnly });
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