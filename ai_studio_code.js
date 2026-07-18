const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);

// === V21.7: MOTOR AAA AUTORITATIVO (RESYNC & BOT TAKEOVER) ===
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 4000,
    pingTimeout: 5000
});

const rooms = {};

function generateUniqueRoomId() {
    let roomId;
    do {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[roomId]);
    return roomId;
}

app.get('/', (req, res) => {
    res.send("Sweety Ludo V21.7 Motor AAA Autoritativo is running.");
});

io.on('connection', (socket) => {
    console.log(`[WS] Nuevo socket conectado: ${socket.id}`);

    socket.on('register_identity', (payload) => {
        socket.playerId = payload.playerId;
        console.log(`[AUTH] Socket ${socket.id} registrado como PlayerID: ${socket.playerId}`);
    });

    socket.on('join_matchmaking', (payload) => {
        const { playerId, playerName, targetPlayers, mode } = payload;
        
        let foundRoomId = null;
        for (const [roomId, room] of Object.entries(rooms)) {
            if (!room.isPrivate && room.targetPlayers === targetPlayers && room.players.length < targetPlayers) {
                foundRoomId = roomId;
                break;
            }
        }

        if (!foundRoomId) {
            foundRoomId = generateUniqueRoomId();
            rooms[foundRoomId] = {
                id: foundRoomId,
                isPrivate: false,
                players: [],
                targetPlayers: targetPlayers || 2,
                gameStarted: false
            };
        }

        const room = rooms[foundRoomId];
        if (!room.players.find(p => p.playerId === playerId)) {
            room.players.push({ 
                playerId, 
                playerName, 
                socketId: socket.id,
                isConnected: true,
                isBot: false
            });
        }
        
        socket.join(foundRoomId);
        socket.roomId = foundRoomId;
        socket.playerId = playerId;

        io.in(foundRoomId).emit('room_updated', {
            id: foundRoomId,
            players: room.players,
            targetPlayers: room.targetPlayers
        });

        if (room.players.length === room.targetPlayers) {
            room.gameStarted = true;
            room.currentTurnSlot = 0; 
            
            io.in(foundRoomId).emit('match_found', {
                id: foundRoomId,
                roomId: foundRoomId,
                players: room.players
            });

            const firstPlayer = room.players[0].playerId;
            io.in(foundRoomId).emit('event_turn_started', {
                playerId: firstPlayer,
                activePlayerId: firstPlayer
            });
        }
    });

    socket.on('create_private_room', (payload) => {
        const { playerId, playerName, targetPlayers } = payload;
        const roomId = generateUniqueRoomId();
        rooms[roomId] = {
            id: roomId,
            isPrivate: true,
            players: [{ 
                playerId, 
                playerName, 
                socketId: socket.id,
                isConnected: true,
                isBot: false
            }],
            targetPlayers: targetPlayers || 2,
            gameStarted: false
        };
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerId = playerId;
        
        socket.emit('private_room_created', { roomCode: roomId, id: roomId });
        
        socket.emit('room_updated', {
            id: roomId,
            players: rooms[roomId].players,
            targetPlayers: rooms[roomId].targetPlayers
        });
    });

    socket.on('join_private_room', (payload) => {
        let rawCode = payload.roomCode || payload.code || "";
        const cleanRoomCode = String(rawCode).trim();
        const { playerId, playerName } = payload;
        
        const room = rooms[cleanRoomCode];

        if (!room || !room.isPrivate) {
            socket.emit('room_error', { message: "Sala privada no encontrada" });
            return;
        }
        if (room.players.length >= room.targetPlayers) {
            socket.emit('room_error', { message: "La sala está llena" });
            return;
        }

        if (!room.players.find(p => p.playerId === playerId)) {
            room.players.push({ 
                playerId, 
                playerName, 
                socketId: socket.id,
                isConnected: true,
                isBot: false
            });
        }
        socket.join(cleanRoomCode);
        socket.roomId = cleanRoomCode;
        socket.playerId = playerId;

        io.in(cleanRoomCode).emit('room_updated', {
            id: cleanRoomCode,
            players: room.players,
            targetPlayers: room.targetPlayers
        });

        if (room.players.length === room.targetPlayers) {
            room.gameStarted = true;
            room.currentTurnSlot = 0; 
            
            io.in(cleanRoomCode).emit('match_found', {
                id: cleanRoomCode,
                roomId: cleanRoomCode,
                players: room.players
            });

            const firstPlayer = room.players[0].playerId;
            io.in(cleanRoomCode).emit('event_turn_started', {
                playerId: firstPlayer,
                activePlayerId: firstPlayer
            });
        }
    });

    // ── RECONEXIÓN V21.7 ──
    socket.on('join_room', (payload) => {
        const roomId = typeof payload === 'string' ? payload : payload.roomId;
        const playerId = typeof payload === 'string' ? null : payload.playerId;

        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerId = playerId;

        const room = rooms[roomId];
        if (room && room.players) {
            const player = room.players.find(p => p.playerId === playerId);
            if (player) {
                const wasOffline = !player.isConnected || player.isBot;
                player.socketId = socket.id;
                player.isConnected = true;
                player.isBot = false;
                delete player._graceTurnsLeft;
                console.log(`[RECONEXIÓN] Jugador ${playerId} volvió a sala ${roomId}`);
                
                io.in(roomId).emit('room_updated', {
                    id: roomId,
                    players: room.players,
                    targetPlayers: room.targetPlayers
                });
                
                if (wasOffline && room.gameStarted) {
                    // Informar que volvió, esto disparará host_sync_state en el cliente Host Suplente
                    io.in(roomId).emit('event_player_reconnected', {
                        playerId: playerId
                    });
                }
            }
        }
    });

    socket.on('intent_roll_dice', (payload) => {
        const { roomId, playerId } = payload;
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        
        io.in(roomId).emit('event_dice_result', {
            playerId: playerId,
            diceRoll1: d1,
            diceRoll2: d2,
            diceValues: [d1, d2]
        });
    });

    socket.on('intent_move_token', (payload) => {
        const { roomId, playerId, tokenId, newPathIndex, isBotMove } = payload;
        io.in(roomId).emit('event_token_moved', {
            playerId,
            tokenId,
            newPathIndex,
            isBotMove
        });
    });

    socket.on('intent_end_turn', (payload) => {
        const { roomId, nextPlayerId, nextTurnId } = payload;
        
        const colorIdToSlotIndex = {
            0: 0, 3: 1, 2: 2, 1: 3, 4: 4, 5: 5
        };

        const parsedColorId = parseInt(nextPlayerId !== undefined ? nextPlayerId : nextTurnId, 10);
        let targetSlot = colorIdToSlotIndex[parsedColorId];
        
        if (targetSlot === undefined) targetSlot = 0;

        const room = rooms[roomId];
        let nextNetworkId = String(parsedColorId); 

        if (room && room.players && room.players[targetSlot]) {
            nextNetworkId = room.players[targetSlot].playerId;
        }

        if (room && room.players && room.currentTurnSlot !== undefined) {
            const prevPlayer = room.players[room.currentTurnSlot];
            if (prevPlayer && prevPlayer.isConnected === false && prevPlayer._graceTurnsLeft !== undefined) {
                prevPlayer._graceTurnsLeft -= 1;
                console.log(`[GRACIA V21.7] Jugador ${prevPlayer.playerId} consumió 1 turno bot. Restantes: ${prevPlayer._graceTurnsLeft}`);
                
                if (prevPlayer._graceTurnsLeft <= 0) {
                    console.log(`[VERDUGO V21.7] Jugador ${prevPlayer.playerId} agotó su gracia. EXPULSADO.`);
                    io.in(roomId).emit('event_player_expelled', { playerId: prevPlayer.playerId });
                    prevPlayer.isExpelled = true;
                    prevPlayer.isBot = false;
                    
                    const activeHumans = room.players.filter(p => !p.isBot && p.isConnected && !p.isExpelled);
                    if (activeHumans.length <= 1) {
                        const winner = activeHumans[0];
                        io.in(roomId).emit('event_game_over_by_abandonment', {
                            winnerId: winner ? winner.playerId : ""
                        });
                    }
                }
            }
        }

        if (room) {
            room.currentTurnSlot = targetSlot;
        }

        io.in(roomId).emit('event_turn_started', {
            playerId: nextNetworkId,
            activePlayerId: nextNetworkId
        });
    });

    socket.on('intent_chat', (payload) => {
        const { roomId, playerId, playerName, message } = payload;
        io.in(roomId).emit('event_chat', {
            playerId,
            playerName,
            message
        });
    });

    // ── V21.7 REPARTO DEL ESTADO DEL JUEGO ──
    socket.on('host_sync_state', (payload) => {
        const { roomId, targetPlayerId, gameState } = payload;
        const room = rooms[roomId];
        if (room && room.players) {
            const targetPlayer = room.players.find(p => p.playerId === targetPlayerId);
            if (targetPlayer && targetPlayer.socketId) {
                // Enviar estado de reconexión únicamente al socket del jugador que volvió
                io.to(targetPlayer.socketId).emit('event_state_resynced', gameState);
                console.log(`[SYNC] Estado reenviado del Host Suplente al jugador reconectado: ${targetPlayerId}`);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`[WS] Socket desconectado: ${socket.id}`);
        if (socket.roomId && socket.playerId) {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const room = rooms[roomId];
            
            if (room && room.players) {
                const player = room.players.find(p => p.playerId === playerId);
                if (player) {
                    player.isConnected = false;
                    
                    if (room.gameStarted) {
                        player.isBot = true;
                        player._graceTurnsLeft = 2; // Otorga 2 turnos de gracia antes de expulsión
                        console.log(`[GRACIA] Jugador ${playerId} desconectado. Asignando Bot Suplente y 2 turnos de gracia.`);
                    }
                    
                    io.in(roomId).emit('room_updated', {
                        id: roomId,
                        players: room.players,
                        targetPlayers: room.targetPlayers
                    });
                    
                    io.in(roomId).emit('event_player_disconnected', {
                        playerId: playerId
                    });

                    const allDisconnected = room.players.every(p => p.isConnected === false);
                    if (allDisconnected) {
                        delete rooms[roomId];
                        console.log(`[LIMPIEZA] Sala ${roomId} eliminada por inactividad total.`);
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[SERVER] Sweety Ludo WebSocket Server V21.7 (Acting Host & Sync) corriendo en puerto ${PORT}`);
});
