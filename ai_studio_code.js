// === Sweety Ludo Server V24.0 — Motor Autoritativo con Orquestación de Tiempos ===
// === CHANGELOG v8.0.10:
// ===   [FIX #1] TURN_TRANSITION_DELAY_MS: El servidor espera antes de emitir event_turn_started,
// ===            dando tiempo a que las animaciones del turno anterior terminen en todos los clientes.
// ===   [FIX #2] startTurnTimer(): Timer de turno autoritativo en el servidor. El servidor emite
// ===            event_turn_timeout al jugador activo cuando su tiempo expira.
// ===   [FIX #3] room.isTransitioning: Bloqueo de intent_roll_dice durante la transición de turno.
// ===   [FIX #4] room.currentTurnPlayerId: Validación de turno en intent_roll_dice.
// ===   [FIX #5] Limpieza de activeTurnTimeout en disconnect.
// ===
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);

// === V24.0: MOTOR AAA AUTORITATIVO CON ORQUESTACIÓN DE TIEMPOS ===
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 4000,
    pingTimeout: 5000
});

// === [v8.0.10] CONSTANTES DE ORQUESTACIÓN AUTORITATIVA ===
// Tiempo que el servidor espera ANTES de emitir event_turn_started.
// Este delay absorbe la duración máxima esperada de las animaciones de movimiento/captura en el cliente.
// Basado en los logs de QA: la animación de un movimiento largo (10 casillas) tarda ~2.5 segundos.
// Se establece en 2000ms como margen seguro para la mayoría de movimientos.
const TURN_TRANSITION_DELAY_MS = 2000;

// Duración del turno en segundos. El servidor es el árbitro del tiempo.
// El cliente puede mostrar un contador visual basado en el campo turnDurationSeconds
// que ahora se envía en el payload de event_turn_started, pero NO debe actuar por sí solo.
const TURN_DURATION_SECONDS = 30;

const rooms = {};

function generateUniqueRoomId() {
    let roomId;
    do {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[roomId]);
    return roomId;
}

// === [v8.0.10] FUNCIÓN AUTORITATIVA: TIMER DE TURNO ===
// Inicia (o reinicia) el timer del turno actual en el servidor.
// Cuando expira, emite event_turn_timeout SOLO al jugador activo para que ejecute una jugada automática.
// Esto elimina la dependencia del cliente de un setInterval local propenso a race conditions.
function startTurnTimer(roomId, activePlayerId) {
    const room = rooms[roomId];
    if (!room) return;

    // Cancelar cualquier timer previo activo (evita timers solapados entre turnos)
    if (room.activeTurnTimeout) {
        clearTimeout(room.activeTurnTimeout);
        room.activeTurnTimeout = null;
    }

    console.log(`[TIMER V24.0] Turno iniciado para ${activePlayerId} en sala ${roomId}. Tiempo: ${TURN_DURATION_SECONDS}s`);

    room.activeTurnTimeout = setTimeout(() => {
        room.activeTurnTimeout = null;

        // Verificar que el jugador siga siendo el activo (podría haber cambiado si actuó justo al límite)
        if (room.currentTurnPlayerId !== activePlayerId) {
            console.log(`[TIMER V24.0] Timeout ignorado: el turno ya cambió de ${activePlayerId}.`);
            return;
        }

        const player = room.players ? room.players.find(p => p.playerId === activePlayerId) : null;
        if (player && player.isConnected && player.socketId) {
            console.log(`[TIMER V24.0] ¡Tiempo agotado! Notificando a ${activePlayerId} para jugada automática.`);
            io.to(player.socketId).emit('event_turn_timeout', {
                playerId: activePlayerId,
                reason: 'turn_timer_expired'
            });
        } else {
            // El jugador está desconectado: el bot ya se encarga vía gracia de turnos
            console.log(`[TIMER V24.0] Timeout de ${activePlayerId} ignorado: jugador desconectado o sin socket.`);
        }
    }, TURN_DURATION_SECONDS * 1000);
}

// === [v8.0.10] FUNCIÓN AUXILIAR: EMITIR INICIO DE TURNO CON DELAY ===
// Centraliza la lógica de transición de turno con el delay autoritativo.
// Recibe la sala, el id del próximo jugador, y emite event_turn_started tras el delay.
function scheduleNextTurn(roomId, nextNetworkId) {
    const room = rooms[roomId];
    if (!room) return;

    // Activar estado de transición: el servidor bloqueará intent_roll_dice durante este período
    room.isTransitioning = true;
    console.log(`[TRANSICIÓN V24.0] Sala ${roomId}: transición activa. Próximo jugador: ${nextNetworkId}. Delay: ${TURN_TRANSITION_DELAY_MS}ms`);

    setTimeout(() => {
        // Verificar que la sala siga existiendo (podría haberse eliminado si todos se desconectaron)
        if (!rooms[roomId]) {
            console.log(`[TRANSICIÓN V24.0] Sala ${roomId} ya no existe al completar el delay. Abortando.`);
            return;
        }

        // Levantar el bloqueo de transición
        room.isTransitioning = false;

        // Registrar quién es el jugador activo en la sala (habilita validación en intent_roll_dice)
        room.currentTurnPlayerId = nextNetworkId;

        console.log(`[TRANSICIÓN V24.0] Sala ${roomId}: emitiendo event_turn_started para ${nextNetworkId}.`);
        io.in(roomId).emit('event_turn_started', {
            playerId: nextNetworkId,
            activePlayerId: nextNetworkId,
            turnDurationSeconds: TURN_DURATION_SECONDS  // El cliente puede usar esto para el countdown visual
        });

        // Iniciar el timer autoritativo del turno
        startTurnTimer(roomId, nextNetworkId);
    }, TURN_TRANSITION_DELAY_MS);
}

app.get('/', (req, res) => {
    res.send("Sweety Ludo V24.0 Motor AAA Autoritativo con Orquestación de Tiempos.");
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
                gameStarted: false,
                // [v8.0.10] Nuevos campos de orquestación
                isTransitioning: false,
                currentTurnPlayerId: null,
                activeTurnTimeout: null
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

        // Broadcast room_updated to all so UI refreshes
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

            // [v8.0.10] Usar scheduleNextTurn con delay inicial para matchmaking.
            // El delay en matchmaking es igual a TURN_TRANSITION_DELAY_MS para ser consistente.
            // Nota: join_private_room ya usaba 3500ms; se unifica con scheduleNextTurn.
            const firstPlayer = room.players[0].playerId;
            scheduleNextTurn(foundRoomId, firstPlayer);
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
            gameStarted: false,
            // [v8.0.10] Nuevos campos de orquestación
            isTransitioning: false,
            currentTurnPlayerId: null,
            activeTurnTimeout: null
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
        // V21.1: Robust trimming to prevent "Sala privada no encontrada" by keyboard spaces
        let rawCode = payload.roomCode || payload.code || "";
        const cleanRoomCode = String(rawCode).trim();
        const { playerId, playerName } = payload;
        
        const room = rooms[cleanRoomCode];

        if (!room || !room.isPrivate) {
            // V23.0 Late Reconnection Guardian: Redirigir al podio si la sala ya fue eliminada (host abandonó o ganó)
            socket.emit('event_room_expired', { roomId: cleanRoomCode, reason: "Sala ya no existe" });
            socket.emit('room_error', { message: "Sala privada no encontrada" });
            return;
        }

        const existingPlayer = room.players.find(p => p.playerId === playerId);
        if (!existingPlayer) {
            if (room.players.length >= room.targetPlayers) {
                socket.emit('room_error', { message: "La sala está llena" });
                return;
            }
            room.players.push({ 
                playerId, 
                playerName, 
                socketId: socket.id,
                isConnected: true,
                isBot: false
            });
        } else {
            // V23.0 Base Fix para Modo Competitivo: Manejar la reconexión igual que en join_room
            const wasOffline = !existingPlayer.isConnected || existingPlayer.isBot;
            existingPlayer.socketId = socket.id;
            existingPlayer.isConnected = true;
            existingPlayer.isBot = false;
            delete existingPlayer._graceTurnsLeft;
            console.log(`[RECONEXIÓN] Jugador ${playerId} volvió a sala privada ${cleanRoomCode} vía JOIN_PRIVATE`);
            
            // Emitir la orden de resincronización al Host SÓLO si el jugador realmente estaba desconectado
            if (wasOffline && room.gameStarted) {
                io.in(cleanRoomCode).emit('event_player_reconnected', {
                    playerId: playerId
                });
            }
        }
        
        socket.join(cleanRoomCode);
        socket.roomId = cleanRoomCode;
        socket.playerId = playerId;

        io.in(cleanRoomCode).emit('room_updated', {
            id: cleanRoomCode,
            players: room.players,
            targetPlayers: room.targetPlayers
        });

        if (room.players.length === room.targetPlayers && !room.gameStarted) {
            room.gameStarted = true;
            room.currentTurnSlot = 0;
            
            io.in(cleanRoomCode).emit('match_found', {
                id: cleanRoomCode,
                roomId: cleanRoomCode,
                players: room.players
            });

            // [v8.0.10] Usar scheduleNextTurn (reemplaza el setTimeout de 3500ms inline anterior)
            const firstPlayer = room.players[0].playerId;
            scheduleNextTurn(cleanRoomCode, firstPlayer);
        }
    });

    // 🚪🔥 Unirse / Reconectarse a una sala (V21.5 Reconnection handler) 🚪🔥
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
                console.log(`[RECONEXIÓN] Jugador ${playerId} volvió a sala ${roomId} (socket: ${socket.id})`);
                
                io.in(roomId).emit('room_updated', {
                    id: roomId,
                    players: room.players,
                    targetPlayers: room.targetPlayers
                });
                
                if (wasOffline && room.gameStarted) {
                    io.in(roomId).emit('event_player_reconnected', {
                        playerId: playerId
                    });
                }
            }
        } else {
            // V23.0 Late Reconnection Guardian
            socket.emit('event_room_expired', { roomId: roomId, reason: "Sala ya no existe" });
        }
    });

    // === [v8.0.10] INTENT_ROLL_DICE — CON GUARDS AUTORITATIVOS ===
    socket.on('intent_roll_dice', (payload) => {
        const { roomId, playerId } = payload;
        const room = rooms[roomId];

        // [GUARD #1] Rechazar si la sala está en período de transición de turno.
        // Esto previene el auto-roll involuntario causado por race conditions en el cliente.
        if (room && room.isTransitioning) {
            console.log(`[GUARD V24.0] intent_roll_dice de ${playerId} RECHAZADO: sala ${roomId} en transición de turno.`);
            return;
        }

        // [GUARD #2] Rechazar si el jugador que solicita el roll no es el jugador activo del turno.
        // Previene rolls fuera de turno (p.ej. si un cliente desincronizado envía un intent tardío).
        if (room && room.currentTurnPlayerId && room.currentTurnPlayerId !== playerId) {
            console.log(`[GUARD V24.0] intent_roll_dice de ${playerId} RECHAZADO: turno actual es de ${room.currentTurnPlayerId}.`);
            return;
        }

        // [v8.0.10] El jugador actuó: cancelar el timer autoritativo de turno.
        // Esto previene que event_turn_timeout se dispare después de que el jugador ya lanzó.
        if (room && room.activeTurnTimeout) {
            clearTimeout(room.activeTurnTimeout);
            room.activeTurnTimeout = null;
            console.log(`[TIMER V24.0] Timer cancelado para ${playerId}: el jugador lanzó los dados.`);
        }

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

    // === [v8.0.10] INTENT_END_TURN — ORQUESTACIÓN CON DELAY AUTORITATIVO ===
    socket.on('intent_end_turn', (payload) => {
        const { roomId, nextPlayerId, nextTurnId } = payload;
        
        // V23.0: Map Android's Color ID (nextPlayerId) to the actual Network UUID.
        // Android assigns colors deterministically based on connection order (slotIndex):
        // Slot 0 (Creator) -> "ROJO"    -> Color ID 0
        // Slot 1 (Player 2) -> "AZUL"   -> Color ID 2
        // Slot 2 -> "AMARILLO"           -> Color ID 1
        // Slot 3 -> "VERDE"              -> Color ID 3
        // Slot 4 -> "NARANJA"            -> Color ID 4
        // Slot 5 -> "MORADO"             -> Color ID 5
        const colorIdToSlotIndex = {
            0: 0,
            2: 1,
            1: 2,
            3: 3,
            4: 4,
            5: 5
        };

        const parsedColorId = parseInt(nextPlayerId !== undefined ? nextPlayerId : nextTurnId, 10);
        let targetSlot = colorIdToSlotIndex[parsedColorId];
        
        if (targetSlot === undefined) targetSlot = 0; // Fallback

        const room = rooms[roomId];
        let nextNetworkId = String(parsedColorId); // Fallback to raw ID si la sala no existe

        if (room && room.players && room.players[targetSlot]) {
            nextNetworkId = room.players[targetSlot].playerId;
        }

        // V21.5 Autoritativo:
        // Decrementar gracia al jugador que acaba de terminar su turno
        if (room && room.players && room.currentTurnSlot !== undefined) {
            const prevPlayer = room.players[room.currentTurnSlot];
            if (prevPlayer && prevPlayer.isConnected === false && prevPlayer._graceTurnsLeft !== undefined) {
                prevPlayer._graceTurnsLeft -= 1;
                console.log(`[GRACIA V21.5] Jugador ${prevPlayer.playerId} consumió 1 turno bot. Restantes: ${prevPlayer._graceTurnsLeft}`);
                
                if (prevPlayer._graceTurnsLeft <= 0) {
                    console.log(`[VERDUGO V21.5] Jugador ${prevPlayer.playerId} agotó su gracia. EXPULSADO.`);
                    
                    // Emitir evento mandatorio de expulsión
                    io.in(roomId).emit('event_player_expelled', { playerId: prevPlayer.playerId });
                    
                    // Marcar al jugador como expulsado
                    prevPlayer.isExpelled = true;
                    prevPlayer.isBot = false;
                    
                    // ¿Cuántos humanos quedan activos en la sala?
                    const activeHumans = room.players.filter(p => !p.isBot && p.isConnected && !p.isExpelled);
                    if (activeHumans.length <= 1) {
                        // El juego termina por abandono. El ganador es el humano restante.
                        const winner = activeHumans[0];
                        room.lastWinnerId = winner ? winner.playerId : '';
                        io.in(roomId).emit('event_game_over_by_abandonment', {
                            winnerId: winner ? winner.playerId : ""
                        });
                    }
                }
            }
        }

        // Actualizar el slot del turno actual en la sala
        if (room) {
            room.currentTurnSlot = targetSlot;
        }

        // [v8.0.10] Reemplaza el emit directo de event_turn_started.
        // scheduleNextTurn gestiona: isTransitioning, el delay, currentTurnPlayerId y el timer autoritativo.
        scheduleNextTurn(roomId, nextNetworkId);
    });

    socket.on('intent_chat', (payload) => {
        const { roomId, playerId, playerName, message } = payload;
        io.in(roomId).emit('event_chat', {
            playerId,
            playerName,
            message
        });
    });

    socket.on('host_sync_state', (payload) => {
        const { roomId, targetPlayerId, gameState } = payload;
        const room = rooms[roomId];
        if (room && room.players) {
            const targetPlayer = room.players.find(p => p.playerId === targetPlayerId);
            if (targetPlayer && targetPlayer.socketId) {
                io.to(targetPlayer.socketId).emit('event_state_resynced', gameState);
                console.log(`[SYNC] Estado de juego enviado del Host al jugador reconectado: ${targetPlayerId}`);
            }
        }
    });

    // === [v8.0.10] DISCONNECT — CON LIMPIEZA DE TIMER AUTORITATIVO ===
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
                    
                    // [v8.0.10] Si el jugador que se desconectó era el activo, cancelar su timer
                    // para evitar que event_turn_timeout se emita a un socket inexistente.
                    if (room.currentTurnPlayerId === playerId && room.activeTurnTimeout) {
                        clearTimeout(room.activeTurnTimeout);
                        room.activeTurnTimeout = null;
                        console.log(`[TIMER V24.0] Timer de turno cancelado: jugador activo ${playerId} se desconectó.`);
                    }
                    
                    if (room.gameStarted) {
                        player.isBot = true;
                        // V21.9: Grace turns depend on room size:
                        // 2-player duel = 5 grace turns (give more time for reconnect)
                        // 4+ players    = 2 grace turns (keep game flowing fast)
                        const graceTurns = room.targetPlayers === 2 ? 5 : 2;
                        player._graceTurnsLeft = graceTurns;
                        console.log(`[GRACIA V21.9] Jugador ${playerId} desconectado. Sala ${room.targetPlayers}p = Bot con ${graceTurns} turnos de gracia.`);
                    }
                    
                    io.in(roomId).emit('room_updated', {
                        id: roomId,
                        players: room.players,
                        targetPlayers: room.targetPlayers
                    });
                    
                    io.in(roomId).emit('event_player_disconnected', {
                        playerId: playerId
                    });

                    // Si todos los jugadores se desconectaron, destruimos la sala
                    const allDisconnected = room.players.every(p => p.isConnected === false);
                    if (allDisconnected) {
                        // [v8.0.10] Limpiar el timer de la sala antes de eliminarla
                        if (room.activeTurnTimeout) {
                            clearTimeout(room.activeTurnTimeout);
                        }
                        delete rooms[roomId];
                        console.log(`[LIMPIEZA] Sala ${roomId} eliminada. Todos los jugadores están offline.`);
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[SERVER] Sweety Ludo WebSocket Server V24.0 Motor Autoritativo con Orquestación de Tiempos en puerto ${PORT}`);
});
