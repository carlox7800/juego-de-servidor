const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 4000,
    pingTimeout: 5000
});

// ==========================================
// ESTADO EN MEMORIA (AAA AUTORITATIVO)
// ==========================================
const matchmakingQueues = {}; // key: mode_targetPlayers -> value: [{socketId, playerId, playerName}]
const activeRooms = {}; // key: roomId -> value: roomData
const playerToRoom = {}; // key: socketId -> value: roomId
const playerIdentities = {}; // key: socketId -> value: playerId

// ==========================================
// UTILIDADES
// ==========================================
function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function assignColors(players) {
    const colors = ["ROJO", "AZUL", "AMARILLO", "VERDE", "NARANJA", "MORADO"];
    players.forEach((p, index) => {
        p.color = colors[index % colors.length];
        p.slotIndex = index;
    });
}

function startGame(roomId) {
    const room = activeRooms[roomId];
    if (!room) return;
    
    room.status = "PLAYING";
    room.currentTurnIndex = 0; // Empieza el host o el primero

    console.log(`[AAA] Sala ${roomId} lista. Iniciando partida con ${room.players.length} jugadores.`);
    
    io.to(roomId).emit("match_found", room);
    
    // Iniciar el primer turno
    // Se aumentó a 3000ms para dar tiempo a la UI de mostrar los jugadores antes de saltar
    setTimeout(() => {
        const activePlayer = room.players[room.currentTurnIndex];
        io.to(roomId).emit("event_turn_started", { playerId: activePlayer.playerId, slotIndex: activePlayer.slotIndex });
        
        if (activePlayer.isBot || !activePlayer.isConnected) {
            processServerBotTurn(roomId, activePlayer);
        }
    }, 3000);
}

// ==========================================
// LÓGICA DE BOTS (ORÁCULO)
// ==========================================
function processServerBotTurn(roomId, botPlayer) {
    const room = activeRooms[roomId];
    if (!room) return;

    console.log(`[AAA] El Servidor asume el turno del bot/desconectado: ${botPlayer.playerName} en sala ${roomId}`);

    setTimeout(() => {
        // MODIFICACIÓN: El servidor tira DOS dados mágicamente
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        
        io.to(roomId).emit("event_dice_result", { 
            playerId: botPlayer.playerId, 
            diceValue: d1, // Retrocompatibilidad
            diceValues: [d1, d2] // Nuevo formato de 2 dados
        });

        const aliveOracle = room.players.find(p => p.isConnected && !p.isBot);
        
        if (aliveOracle) {
            const oracleSocketId = Object.keys(playerIdentities).find(key => playerIdentities[key] === aliveOracle.playerId);
            if (oracleSocketId) {
                console.log(`[AAA] Consultando Oráculo (${aliveOracle.playerName}) para mover al bot ${botPlayer.playerName}`);
                io.to(oracleSocketId).emit("rpc_request_bot_move", {
                    botPlayerId: botPlayer.playerId,
                    diceValue: d1,
                    diceValues: [d1, d2]
                });
            } else {
                endTurn(roomId, botPlayer.playerId, false);
            }
        } else {
            console.log(`[AAA] Sala ${roomId} es un pueblo fantasma. Destruyendo sala.`);
            delete activeRooms[roomId];
        }
    }, 2000);
}

function endTurn(roomId, playerId, hasExtraTurn) {
    const room = activeRooms[roomId];
    if (!room) return;

    if (hasExtraTurn) {
        // Repite turno
        const activePlayer = room.players[room.currentTurnIndex];
        io.to(roomId).emit("event_turn_started", { playerId: activePlayer.playerId, slotIndex: activePlayer.slotIndex });
        if (activePlayer.isBot || !activePlayer.isConnected) {
            processServerBotTurn(roomId, activePlayer);
        }
    } else {
        // Pasa turno
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        const nextPlayer = room.players[room.currentTurnIndex];
        io.to(roomId).emit("event_turn_started", { playerId: nextPlayer.playerId, slotIndex: nextPlayer.slotIndex });
        
        if (nextPlayer.isBot || !nextPlayer.isConnected) {
            processServerBotTurn(roomId, nextPlayer);
        }
    }
}

// ==========================================
// SOCKET.IO EVENTS
// ==========================================
io.on("connection", (socket) => {
    console.log(`[AAA] Nuevo cliente conectado: ${socket.id}`);

    // Registro de Identidad
    socket.on("register_identity", (data) => {
        playerIdentities[socket.id] = data.playerId;
    });

    // ----------------------------------------------------
    // MATCHMAKING PÚBLICO (Partida Rápida)
    // ----------------------------------------------------
    socket.on("join_matchmaking", (data) => {
        const { playerId, playerName, mode, targetPlayers } = data;
        const queueKey = `${mode}_${targetPlayers}`;
        
        if (!matchmakingQueues[queueKey]) {
            matchmakingQueues[queueKey] = [];
        }

        // Evitar duplicados
        if (!matchmakingQueues[queueKey].find(p => p.playerId === playerId)) {
            matchmakingQueues[queueKey].push({ socketId: socket.id, playerId, playerName });
        }

        console.log(`[AAA] ${playerName} buscando partida ${queueKey}. Cola actual: ${matchmakingQueues[queueKey].length}/${targetPlayers}`);

        // Emparejar si hay suficientes
        if (matchmakingQueues[queueKey].length >= targetPlayers) {
            const matchedGroup = matchmakingQueues[queueKey].splice(0, targetPlayers);
            const roomId = `room_${Date.now()}_${Math.floor(Math.random()*1000)}`;
            
            const players = matchedGroup.map(p => ({
                playerId: p.playerId,
                playerName: p.playerName,
                isConnected: true,
                isBot: false,
                isReady: true
            }));

            assignColors(players);

            activeRooms[roomId] = {
                id: roomId,
                mode: mode,
                targetPlayers: targetPlayers,
                status: "LOBBY",
                players: players,
                currentTurnIndex: 0
            };

            // Unir a todos a la sala de socket
            matchedGroup.forEach(p => {
                const s = io.sockets.sockets.get(p.socketId);
                if (s) {
                    s.join(roomId);
                    playerToRoom[s.id] = roomId;
                }
            });

            startGame(roomId);
        }
    });

    // ----------------------------------------------------
    // SALAS PRIVADAS (Jugar con Amigos)
    // ----------------------------------------------------
    socket.on("create_private_room", (data) => {
        const { playerId, playerName, targetPlayers } = data;
        const code = generateRoomCode();
        
        const player = {
            playerId: playerId,
            playerName: playerName,
            isConnected: true,
            isBot: false,
            isReady: true
        };

        assignColors([player]);

        activeRooms[code] = {
            id: code,
            mode: "FRIEND",
            targetPlayers: targetPlayers || 2,
            status: "LOBBY",
            players: [player],
            currentTurnIndex: 0
        };

        socket.join(code);
        playerToRoom[socket.id] = code;
        
        console.log(`[AAA] Sala Privada Creada: ${code} por ${playerName}`);
        socket.emit("private_room_created", { roomCode: code, roomData: activeRooms[code] });
    });

    socket.on("join_private_room", (data) => {
        const { playerId, playerName, roomCode } = data;
        const room = activeRooms[roomCode];

        if (!room) {
            socket.emit("room_error", { message: "La sala no existe o el código es incorrecto." });
            return;
        }

        if (room.status !== "LOBBY") {
            socket.emit("room_error", { message: "La partida ya ha comenzado." });
            return;
        }

        if (room.players.length >= room.targetPlayers) {
            socket.emit("room_error", { message: "La sala está llena." });
            return;
        }

        const player = {
            playerId: playerId,
            playerName: playerName,
            isConnected: true,
            isBot: false,
            isReady: true
        };

        room.players.push(player);
        assignColors(room.players);

        socket.join(roomCode);
        playerToRoom[socket.id] = roomCode;
        
        console.log(`[AAA] ${playerName} se unió a la sala privada ${roomCode}`);

        // Notificar al host que alguien entró (para la UI del lobby)
        io.to(roomCode).emit("room_updated", room);

        if (room.players.length === room.targetPlayers) {
            startGame(roomCode);
        }
    });

    // ----------------------------------------------------
    // JUGABILIDAD AAA (Intents)
    // ----------------------------------------------------
    socket.on("intent_roll_dice", (data) => {
        const { roomId, playerId } = data;
        
        // MODIFICACIÓN: TIRA 2 DADOS
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        
        console.log(`[AAA] ${playerId} tiró un ${d1} y un ${d2} en ${roomId}`);
        io.to(roomId).emit("event_dice_result", { 
            playerId, 
            diceValue: d1, // Retrocompatibilidad
            diceValues: [d1, d2] // Nuevo formato de 2 dados
        });
    });

    socket.on("intent_move_token", (data) => {
        const { roomId, playerId, tokenId, newPathIndex, isBotMove } = data;
        console.log(`[AAA] ${playerId} movió ficha ${tokenId} a ${newPathIndex} en ${roomId}`);
        
        io.to(roomId).emit("event_token_moved", {
            playerId,
            tokenId,
            newPathIndex
        });

        // Simulamos que el movimiento tarda 1.5s en pantalla antes de terminar el turno
        setTimeout(() => {
            endTurn(roomId, playerId, false); // Simplificado: no evaluamos turnos extra por matar fichas aún
        }, 1500);
    });

    socket.on("intent_end_turn", (data) => {
        const { roomId, playerId, hasExtraTurn } = data;
        console.log(`[AAA] ${playerId} finaliza turno en ${roomId}. Extra: ${hasExtraTurn}`);
        endTurn(roomId, playerId, hasExtraTurn);
    });

    // ----------------------------------------------------
    // DESCONEXIÓN Y MOTOR DE IA
    // ----------------------------------------------------
    socket.on("disconnect", () => {
        console.log(`[AAA] Cliente desconectado: ${socket.id}`);
        const pId = playerIdentities[socket.id];
        const roomId = playerToRoom[socket.id];
        
        // Limpiar colas de matchmaking
        Object.keys(matchmakingQueues).forEach(key => {
            matchmakingQueues[key] = matchmakingQueues[key].filter(p => p.socketId !== socket.id);
        });

        if (roomId && activeRooms[roomId]) {
            const room = activeRooms[roomId];
            const p = room.players.find(x => x.playerId === pId);
            if (p) {
                p.isConnected = false;
                io.to(roomId).emit("event_player_disconnected", { playerId: p.playerId });
                
                // Si le tocaba a él, el servidor debe tomar el control de su turno ahora
                const activePlayer = room.players[room.currentTurnIndex];
                if (activePlayer.playerId === pId) {
                    processServerBotTurn(roomId, p);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[AAA] Sweety Ludo Servidor Autoritativo V20.0 corriendo en puerto ${PORT}`);
});
