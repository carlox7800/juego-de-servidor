const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// AAA Server Settings: Heartbeat rápido para cortes en máx 9 segundos
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 4000,
    pingTimeout: 5000
});

// ============================================================================
// ESTADO AUTORITATIVO (MEMORY DB)
// ============================================================================
const matchmakingQueue = [];
const activeRooms = {};
const playerToRoomMap = {};

function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getNextTurn(room) {
    let nextIndex = (room.currentTurnIndex + 1) % room.players.length;
    room.currentTurnIndex = nextIndex;
    room.turnState = 'AWAITING_ROLL';
    return room.players[nextIndex].playerId;
}

// ============================================================================
// MOTOR DE BOTS DEL SERVIDOR (LA SOLUCIÓN A LOS BLOQUEOS DE HILOS)
// ============================================================================
function processServerBotTurn(roomId) {
    const room = activeRooms[roomId];
    if (!room || room.status !== 'PLAYING') return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.isConnected) return; // Si hay humano, cancela el bot

    console.log(`[BOT ENGINE] Turno automático para ${currentPlayer.playerId} (Sala ${roomId})`);
    
    // 1. El Servidor lanza el dado después de 2 segundos (Simula pensamiento)
    setTimeout(() => {
        const roomContext = activeRooms[roomId];
        if (!roomContext || roomContext.turnState !== 'AWAITING_ROLL') return;

        const diceValue = Math.floor(Math.random() * 6) + 1;
        roomContext.turnState = 'AWAITING_MOVE';
        
        io.in(roomId).emit('event_dice_result', {
            playerId: currentPlayer.playerId,
            diceValue: diceValue,
            isBotRoll: true
        });

        // 2. Patrón Oráculo: Pedimos a un cliente vivo que valide el movimiento en el tablero
        const connectedOracle = roomContext.players.find(p => p.isConnected);
        if (connectedOracle) {
            io.to(connectedOracle.socketId).emit('rpc_request_bot_move', {
                botPlayerId: currentPlayer.playerId,
                diceValue: diceValue
            });
        } else {
            console.log(`[BOT ENGINE] Sala ${roomId} quedó vacía. Destruyendo...`);
            delete activeRooms[roomId];
        }
    }, 2000);
}

// ============================================================================
// WEBSOCKETS (EVENT-DRIVEN AAA)
// ============================================================================
io.on('connection', (socket) => {
    console.log(`[WS] Nuevo cliente conectado: ${socket.id}`);

    // ── 1. MATCHMAKING CENTRALIZADO ─────────────────────────────────────────
    socket.on('join_matchmaking', (payload) => {
        const { playerId, playerName, mode, targetPlayers } = payload;
        if (matchmakingQueue.find(p => p.playerId === playerId)) return;

        matchmakingQueue.push({ socketId: socket.id, playerId, playerName, mode, targetPlayers });
        console.log(`[MATCH] ${playerName} entró. Total cola: ${matchmakingQueue.length}`);

        const compatibles = matchmakingQueue.filter(p => p.mode === mode && p.targetPlayers === targetPlayers);
        
        if (compatibles.length >= targetPlayers) {
            const roomPlayers = compatibles.slice(0, targetPlayers);
            const roomId = generateRoomId();
            
            roomPlayers.forEach(p => {
                const idx = matchmakingQueue.findIndex(mq => mq.playerId === p.playerId);
                if (idx !== -1) matchmakingQueue.splice(idx, 1);
            });

            activeRooms[roomId] = {
                id: roomId, status: 'PLAYING', mode: mode,
                players: roomPlayers.map((p, i) => ({
                    socketId: p.socketId, playerId: p.playerId,
                    playerName: p.playerName, isConnected: true, slotIndex: i
                })),
                currentTurnIndex: 0, turnState: 'AWAITING_ROLL'
            };

            roomPlayers.forEach(p => {
                const s = io.sockets.sockets.get(p.socketId);
                if (s) s.join(roomId);
                playerToRoomMap[p.playerId] = roomId;
            });

            console.log(`[MATCH] Sala ${roomId} creada. Arrancando...`);
            io.in(roomId).emit('match_found', activeRooms[roomId]);

            setTimeout(() => {
                io.in(roomId).emit('event_turn_started', { playerId: activeRooms[roomId].players[0].playerId });
            }, 3000);
        }
    });

    // ── 2. MOTOR DE EVENTOS POR INTENCIÓN (CERO JSON MASIVOS) ───────────────
    socket.on('intent_roll_dice', (payload) => {
        const room = activeRooms[payload.roomId];
        if (room && room.status === 'PLAYING') {
            const currentPlayer = room.players[room.currentTurnIndex];
            if (currentPlayer.playerId === payload.playerId && room.turnState === 'AWAITING_ROLL') {
                const diceValue = Math.floor(Math.random() * 6) + 1;
                room.turnState = 'AWAITING_MOVE';
                io.in(room.id).emit('event_dice_result', {
                    playerId: payload.playerId, diceValue: diceValue, isBotRoll: false
                });
            }
        }
    });

    socket.on('intent_move_token', (payload) => {
        const room = activeRooms[payload.roomId];
        if (room && room.status === 'PLAYING') {
            const currentPlayer = room.players[room.currentTurnIndex];
            if (currentPlayer.playerId === payload.playerId && room.turnState === 'AWAITING_MOVE') {
                io.in(room.id).emit('event_token_moved', payload);
            }
        }
    });

    socket.on('intent_end_turn', (payload) => {
        const room = activeRooms[payload.roomId];
        if (room && room.status === 'PLAYING') {
            const currentPlayer = room.players[room.currentTurnIndex];
            if (currentPlayer.playerId === payload.playerId) {
                let nextPlayerId = payload.hasExtraTurn ? currentPlayer.playerId : getNextTurn(room);
                if (payload.hasExtraTurn) room.turnState = 'AWAITING_ROLL';

                io.in(room.id).emit('event_turn_started', { playerId: nextPlayerId });

                // V19.9 - Arrancar Bot Engine si el siguiente está desconectado
                const nextPlayer = room.players.find(p => p.playerId === nextPlayerId);
                if (nextPlayer && !nextPlayer.isConnected) {
                    processServerBotTurn(room.id);
                }
            }
        }
    });

    // ── 3. CICLO DE VIDA (EL SERVIDOR TIENE LA VERDAD) ──────────────────────
    socket.on('register_identity', (payload) => {
        socket.data.playerId = payload.playerId;
        const roomId = playerToRoomMap[payload.playerId];
        if (roomId && activeRooms[roomId]) {
            socket.join(roomId);
            const p = activeRooms[roomId].players.find(p => p.playerId === payload.playerId);
            if (p) {
                p.isConnected = true; p.socketId = socket.id;
                console.log(`[RECONEXIÓN] Jugador ${payload.playerId} regresó a sala ${roomId}`);
                io.in(roomId).emit('event_player_reconnected', { playerId: payload.playerId });
            }
        }
    });

    socket.on('disconnect', () => {
        const playerId = socket.data.playerId;
        if (playerId) {
            const mqIdx = matchmakingQueue.findIndex(p => p.playerId === playerId);
            if (mqIdx !== -1) matchmakingQueue.splice(mqIdx, 1);

            const roomId = playerToRoomMap[playerId];
            if (roomId && activeRooms[roomId]) {
                const room = activeRooms[roomId];
                const p = room.players.find(p => p.playerId === playerId);
                if (p) {
                    p.isConnected = false;
                    console.log(`[CAÍDA] Jugador ${playerId} OFFLINE en sala ${roomId}`);
                    io.in(roomId).emit('event_player_disconnected', { playerId: playerId });

                    // Si justo le tocaba el turno, el Servidor asume el control Inmediato
                    if (room.players[room.currentTurnIndex].playerId === playerId) {
                        processServerBotTurn(roomId);
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[AAA ENGINE] Ludo Authoritative Server V19.9 en puerto ${PORT}`);
});
