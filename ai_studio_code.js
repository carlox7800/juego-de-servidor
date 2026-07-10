const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Estructuras de datos principales
const matchmakingQueues = { 2: [], 4: [] };
const activeRooms = {}; // roomId -> { id, mode, maxPlayers, players, currentTurnIndex }
const playerToRoom = {}; // socketId -> roomId

app.get('/', (req, res) => {
    res.send("<h1>Ludo Backend V20.2 AAA Server is running</h1>");
});

function assignColors(players) {
    const colors = ["ROJO", "VERDE", "AMARILLO", "AZUL", "NARANJA", "MORADO"];
    const baseColors2P = ["ROJO", "AZUL"];
    const baseColors4P = ["ROJO", "VERDE", "AMARILLO", "AZUL"];
    
    const count = players.length;
    const selectedColors = count === 2 ? baseColors2P : baseColors4P;
    
    players.forEach((p, index) => {
        p.color = selectedColors[index % selectedColors.length];
        p.slotIndex = colors.indexOf(p.color);
    });
}

function startGame(roomId) {
    const room = activeRooms[roomId];
    if (!room) return;
    
    room.currentTurnIndex = 0; // Empieza el host o el primero
    const firstPlayer = room.players[0];
    
    io.to(roomId).emit("event_turn_started", { playerId: firstPlayer.playerId, slotIndex: firstPlayer.slotIndex });
}

function endTurn(roomId, playerId, hasExtraTurn) {
    const room = activeRooms[roomId];
    if (!room) return;
    
    const activePlayer = room.players[room.currentTurnIndex];
    if (activePlayer.playerId !== playerId) return; 
    
    if (hasExtraTurn) {
        io.to(roomId).emit("event_turn_started", { playerId: activePlayer.playerId, slotIndex: activePlayer.slotIndex });
    } else {
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        const nextPlayer = room.players[room.currentTurnIndex];
        io.to(roomId).emit("event_turn_started", { playerId: nextPlayer.playerId, slotIndex: nextPlayer.slotIndex });
    }
}

io.on('connection', (socket) => {
    console.log(`[AAA] Socket conectado: ${socket.id}`);

    socket.on("register_identity", (data) => {
        console.log(`[AAA] Identidad registrada: ${data.playerId} -> ${socket.id}`);
    });

    // =========================================================
    // 1. PARTIDA RÁPIDA (CASUAL)
    // =========================================================
    socket.on("join_matchmaking", (data) => {
        const { playerId, playerName, targetPlayers } = data;
        
        let queue = matchmakingQueues[targetPlayers] || [];
        matchmakingQueues[targetPlayers] = queue;
        
        const existing = queue.find(p => p.playerId === playerId);
        if (!existing) {
            queue.push({ socketId: socket.id, playerId, playerName, isReady: false, isConnected: true });
        }

        if (queue.length >= targetPlayers) {
            const matchedGroup = queue.splice(0, targetPlayers);
            const roomId = `room_${Math.floor(Math.random() * 1000000)}_${Date.now()}`;
            
            assignColors(matchedGroup);
            
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
            console.log(`[AAA] Emparejamiento exitoso: ${roomId} con ${targetPlayers} jugadores.`);
            
            setTimeout(() => {
                activeRooms[roomId].players.forEach(p => p.isReady = true);
                startGame(roomId);
            }, 3000);
        }
    });

    // =========================================================
    // 2. SALAS PRIVADAS (JUGAR CON AMIGOS)
    // =========================================================
    socket.on("create_private_room", (data) => {
        const { playerId, playerName, mode, maxPlayers } = data;
        
        // V20.2 FIX: Generador de código estrictamente numérico de 6 dígitos
        const code = Math.floor(100000 + Math.random() * 900000).toString(); 
        
        socket.join(code);
        playerToRoom[socket.id] = code;
        
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
            playerName: playerName,
            isReady: false,
            isConnected: true
        };
        activeRooms[code].players.push(newPlayer);
        
        assignColors(activeRooms[code].players);
        
        socket.emit("private_room_created", { roomCode: code, room: activeRooms[code] });
        console.log(`[AAA] Sala Privada Creada: ${code} por ${playerName} (${playerId})`);
    });

    socket.on("join_private_room", (data) => {
        const { code, playerId, playerName } = data;
        const room = activeRooms[code];
        
        if (room) {
            if (room.players.length >= room.maxPlayers) {
                socket.emit("room_error", "La sala está llena.");
                return;
            }
            
            socket.join(code);
            playerToRoom[socket.id] = code;
            
            const newPlayer = {
                socketId: socket.id,
                playerId: playerId || "GUEST_ERROR_ID",
                playerName: playerName,
                isReady: true,
                isConnected: true
            };
            room.players.push(newPlayer);
            
            assignColors(room.players);
            
            io.to(code).emit("room_updated", room);
            console.log(`[AAA] ${playerName} (${playerId}) se unió a la sala ${code}`);
        } else {
            socket.emit("room_error", "Sala no encontrada o código inválido.");
        }
    });

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
    // 3. JUGABILIDAD Y TURNOS (MOTOR V20.2)
    // =========================================================
    socket.on("intent_roll_dice", (data) => {
        const { roomId, playerId } = data;
        const room = activeRooms[roomId];
        if (!room) return;
        
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        
        io.to(roomId).emit("event_dice_result", {
            playerId,
            diceRoll1: d1,
            diceRoll2: d2
        });
    });

    socket.on("intent_move_token", (data) => {
        const { roomId, playerId, tokenId, newPathIndex, isBotMove } = data;
        io.to(roomId).emit("event_token_moved", {
            playerId,
            tokenId,
            newPathIndex,
            isBotMove
        });
    });

    socket.on("intent_end_turn", (data) => {
        const { roomId, playerId, hasExtraTurn } = data;
        endTurn(roomId, playerId, hasExtraTurn);
    });

    // =========================================================
    // 4. MÓDULO DE CHAT Y EMOJIS (V20.2)
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
    // 5. BOTS Y DESCONEXIÓN
    // =========================================================
    socket.on("request_bot_move", (data) => {
        const { roomId, botPlayerId, diceValue } = data;
        const room = activeRooms[roomId];
        if (!room) return;
        
        const host = room.players.find(p => p.isConnected && !p.isBot);
        if (host) {
            io.to(host.socketId).emit("rpc_request_bot_move", {
                botPlayerId,
                diceValue
            });
        }
    });

    socket.on('disconnect', () => {
        console.log(`[AAA] Socket desconectado: ${socket.id}`);
        const roomId = playerToRoom[socket.id];
        if (roomId) {
            const room = activeRooms[roomId];
            if (room) {
                const player = room.players.find(p => p.socketId === socket.id);
                if (player) {
                    player.isConnected = false;
                    io.to(roomId).emit("event_player_disconnected", {
                        playerId: player.playerId,
                        playerName: player.playerName
                    });
                }
            }
            delete playerToRoom[socket.id];
        }
        
        for (let target in matchmakingQueues) {
            matchmakingQueues[target] = matchmakingQueues[target].filter(p => p.socketId !== socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[AAA] Ludo Backend V20.2 escuchando en el puerto ${PORT}`);
});
