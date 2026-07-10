const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

// CORS Config for mobile app
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Port for Render or Local
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Express Health Check Route (For Render)
app.get("/", (req, res) => {
    res.send("Sweety Ludo Server V20.4 is running. Ready for real-time multiplayer connections.");
});

// ==========================================
// STATE MANAGEMENT (IN-MEMORY)
// ==========================================
// activeRooms contains the game state for each active room
const activeRooms = {}; 

// matchmakingQueue: { mode: { maxPlayers: [ { socketId, playerId, playerName } ] } }
const matchmakingQueue = {};

// Maps a socketId to a roomId to handle disconnections efficiently
const playerToRoom = {};

// -----------------------------------------------------
// HELPER: Generate 6-Digit Numeric Code (Fix for V20.2/V20.4)
// -----------------------------------------------------
function generateNumericRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString(); 
}

// ==========================================
// SOCKET.IO EVENT HANDLERS
// ==========================================
io.on("connection", (socket) => {
    console.log(`[+] New connection: ${socket.id}`);

    // =========================================================
    // 1. MATCHMAKING & ROOM CREATION
    // =========================================================

    // Create a Private Room (Friend Mode)
    socket.on("create_private_room", (data) => {
        const { playerId, playerName, mode, maxPlayers } = data;
        const code = generateNumericRoomCode();
        
        activeRooms[code] = {
            id: code,
            mode: mode || "FRIEND",
            maxPlayers: maxPlayers || 4,
            players: [],
            currentTurnIndex: 0
        };
        
        const newPlayer = {
            socketId: socket.id,
            playerId: playerId || "HOST_ERROR_ID",
            playerName: playerName || "Jugador",
            isReady: false,
            isConnected: true
        };
        
        activeRooms[code].players.push(newPlayer);
        socket.join(code);
        playerToRoom[socket.id] = code;

        console.log(`[HOST] Room Created: ${code} by ${playerName}`);
        socket.emit("private_room_created", { roomCode: code });
        io.to(code).emit("room_updated", activeRooms[code]);
    });

    // Join a Private Room
    socket.on("join_private_room", (data) => {
        const { code, playerId, playerName } = data;
        const room = activeRooms[code];
        
        if (room) {
            if (room.players.length >= room.maxPlayers) {
                // V20.4 FIX: Send error as object to prevent ClassCastException on client
                socket.emit("room_error", { message: "La sala está llena." });
                return;
            }

            const newPlayer = {
                socketId: socket.id,
                playerId: playerId || "GUEST_ERROR_ID",
                playerName: playerName || "Invitado",
                isReady: true,
                isConnected: true
            };
            
            room.players.push(newPlayer);
            socket.join(code);
            playerToRoom[socket.id] = code;
            
            console.log(`[JOIN] ${playerName} joined ${code}`);
            
            io.to(code).emit("room_updated", room);
            
            if (room.players.length === room.maxPlayers) {
                console.log(`[START] Room ${code} is full. Emitting match_found...`);
                io.to(code).emit("match_found", room); 
                setTimeout(() => {
                    startGame(code);
                }, 3000);
            }
        } else {
            // V20.4 FIX: Send error as object
            socket.emit("room_error", { message: "Sala no encontrada o código inválido." });
        }
    });

    // Join Quick Match (Random Matchmaking)
    socket.on("join_matchmaking", (data) => {
        const { playerId, playerName, mode, targetPlayers } = data;
        
        if (!matchmakingQueue[mode]) matchmakingQueue[mode] = {};
        if (!matchmakingQueue[mode][targetPlayers]) matchmakingQueue[mode][targetPlayers] = [];
        
        const queue = matchmakingQueue[mode][targetPlayers];
        
        const existing = queue.find(p => p.playerId === playerId);
        if (!existing) {
            queue.push({
                socketId: socket.id,
                playerId: playerId || "P_ERROR",
                playerName: playerName || "Jugador",
                isReady: true,
                isConnected: true
            });
        }
        
        if (queue.length >= targetPlayers) {
            const matchedGroup = queue.splice(0, targetPlayers);
            const roomId = generateNumericRoomCode();
            
            activeRooms[roomId] = {
                id: roomId,
                mode: "CASUAL",
                maxPlayers: targetPlayers,
                players: matchedGroup,
                currentTurnIndex: 0
            };
            
            matchedGroup.forEach(p => {
                const s = io.sockets.sockets.get(p.socketId);
                if (s) {
                    s.join(roomId);
                    playerToRoom[s.id] = roomId;
                }
            });
            
            io.to(roomId).emit("match_found", activeRooms[roomId]);
            setTimeout(() => {
                startGame(roomId);
            }, 3000);
        }
    });

    // Cancel Matchmaking
    socket.on("cancel_matchmaking", (data) => {
        const { playerId, mode, targetPlayers } = data;
        if (matchmakingQueue[mode] && matchmakingQueue[mode][targetPlayers]) {
            const q = matchmakingQueue[mode][targetPlayers];
            const idx = q.findIndex(p => p.playerId === playerId);
            if (idx !== -1) q.splice(idx, 1);
        }
    });

    // Check Lobby Exists
    socket.on("check_lobby", (data) => {
        const { code } = data;
        const room = activeRooms[code];
        if (room) {
            socket.emit("check_lobby_result", { exists: true });
        } else {
            socket.emit("check_lobby_result", { exists: false });
        }
    });

    // Set Ready status manually (Host starts the game)
    socket.on("set_ready", (data) => {
        const { roomId, playerId, isReady } = data;
        const room = activeRooms[roomId];
        if (room) {
            const p = room.players.find(pl => pl.playerId === playerId);
            if (p) p.isReady = isReady;
            io.to(roomId).emit("room_updated", room);
        }
    });

    // Intent to start game manually
    socket.on("intent_start_game", (data) => {
        const { roomId } = data;
        const room = activeRooms[roomId];
        if (room) {
            room.players.forEach(p => p.isReady = true);
            io.to(roomId).emit("match_found", room); 
            setTimeout(() => {
                startGame(roomId);
            }, 3000);
        }
    });

    // =========================================================
    // 2. GAMEPLAY MECHANICS (DICE & TOKENS)
    // =========================================================

    // Roll Dice Intent
    socket.on("intent_roll_dice", (data) => {
        const { roomId, playerId } = data;
        const room = activeRooms[roomId];
        if (!room) return;
        
        // Random 1 to 6
        const dice1 = Math.floor(Math.random() * 6) + 1;
        const dice2 = Math.floor(Math.random() * 6) + 1;
        
        io.to(roomId).emit("event_dice_result", {
            playerId: playerId,
            diceRoll1: dice1,
            diceRoll2: dice2,
            isDouble: dice1 === dice2
        });
    });

    // Move Token Intent (Token Landing and Safe Zones handled by Android)
    socket.on("intent_move_token", (data) => {
        const { roomId, playerId, tokenId, newPathIndex } = data;
        const room = activeRooms[roomId];
        if (!room) return;
        
        io.to(roomId).emit("event_token_moved", {
            playerId,
            tokenId,
            newPathIndex
        });
    });

    // =========================================================
    // 3. TURN MANAGEMENT
    // =========================================================
    
    function startGame(roomId) {
        const room = activeRooms[roomId];
        if (!room) return;
        room.currentTurnIndex = 0;
        const firstPlayer = room.players[0].playerId;
        io.to(roomId).emit("event_turn_started", {
            activePlayerId: firstPlayer
        });
    }

    socket.on("intent_end_turn", (data) => {
        const { roomId, nextPlayerId } = data;
        const room = activeRooms[roomId];
        if (!room) return;

        // Trust client logic for next player calculation (including double rolls)
        io.to(roomId).emit("event_turn_started", {
            activePlayerId: nextPlayerId
        });
    });

    // =========================================================
    // 4. CHAT MODULE
    // =========================================================
    socket.on("intent_chat", (data) => {
        const { roomId, playerId, message } = data;
        const room = activeRooms[roomId];
        if (!room) return;

        const sender = room.players.find(p => p.playerId === playerId);
        const playerName = sender ? sender.playerName : "Jugador";

        io.to(roomId).emit("event_chat", {
            playerId,
            playerName,
            message
        });
    });

    // =========================================================
    // 5. DISCONNECTION & CLEANUP
    // =========================================================
    socket.on("disconnect", () => {
        console.log(`[-] Disconnected: ${socket.id}`);
        const roomId = playerToRoom[socket.id];
        if (roomId && activeRooms[roomId]) {
            const room = activeRooms[roomId];
            const pIndex = room.players.findIndex(p => p.socketId === socket.id);
            if (pIndex !== -1) {
                const disconnectedPlayer = room.players[pIndex];
                disconnectedPlayer.isConnected = false;
                
                io.to(roomId).emit("event_player_disconnected", {
                    playerId: disconnectedPlayer.playerId
                });
                
                const allDisconnected = room.players.every(p => !p.isConnected);
                if (allDisconnected) {
                    delete activeRooms[roomId];
                }
            }
        }
        delete playerToRoom[socket.id];
    });
});

server.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`🚀 Sweety Ludo Server V20.4 Started`);
    console.log(`📡 Listening on port ${PORT}`);
    console.log(`=================================`);
});
