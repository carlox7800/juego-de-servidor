// === Sweety Ludo Server V24.0 — Motor Autoritativo v8.1.0 ===
// === CHANGELOG v8.1.0:
// ===   [OPT #1] TURN_DURATION_SECONDS: Reducido de 30s a 15s para ritmo más dinámico.
// ===   [OPT #2] TURN_TRANSITION_DELAY_MS: Reducido de 2000ms a 900ms.
// ===            La animación de paso tarda ~250ms cada una. Un movimiento largo de 12 pasos
// ===            tarda máx ~3s, pero el cliente ya anima mientras el servidor espera.
// ===            900ms protege las animaciones de movimientos cortos/medianos sin freezar el juego.
// ===   [FIX #3] Motor de Capturas Autoritativo: El servidor mantiene room.tokenState para
// ===            rastrear la posición de cada ficha. Al procesar intent_move_token, detecta si
// ===            la casilla destino contiene una ficha enemiga (fuera de casilla segura) y emite
// ===            event_token_moved con newPathIndex: -1 para la ficha capturada.
// ===   [FIX #4] Penalización por 3 dobles: Al tercer doble consecutivo, la ficha activa
// ===            regresa a base (newPathIndex: -1) antes de finalizar el turno.
// ===

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

// === [v8.1.0] CONSTANTES DE ORQUESTACIÓN AUTORITATIVA ===
// Reducido de 2000ms a 900ms: punto dulce para absorber animaciones cortas/medianas
// sin que la partida se sienta congelada entre turnos.
const TURN_TRANSITION_DELAY_MS = 900;

// Reducido de 30s a 15s: ritmo más dinámico. El timer del servidor es el árbitro.
const TURN_DURATION_SECONDS = 15;

// === [v8.1.0] CONSTANTES DEL MOTOR DE CAPTURAS ===
// Réplica exacta de la lógica del cliente (GameBoard.tsx / online-game-engine.tsx)
// para que el servidor evalúe capturas con la misma matemática.

// Perímetro del tablero Parchís estándar (52 casillas, 0-indexed internamente, 1-indexed al comparar)
const PERIMETER = 52;

// Offset de inicio de cada color en el perímetro (1-indexed, como en GameBoard.tsx START_OFFSETS)
// Slot 0 → yellow (offset 40), Slot 1 → red (offset 27), Slot 2 → green (offset 14), Slot 3 → blue (offset 1)
const START_OFFSETS_BY_SLOT = [40, 27, 14, 1, 0, 0]; // hasta 6 jugadores

// Casillas seguras en el perímetro (1-indexed). Incluye salidas y estrellas doradas.
// Ref: isSafeCell en GameBoard.tsx: [1, 8, 14, 21, 27, 34, 40, 47]
const SAFE_PERIMETER_CELLS = new Set([1, 8, 14, 21, 27, 34, 40, 47]);

// Función: ¿es segura la casilla perimetral pIndex (1-indexed)?
function isSafeCell(pIndex) {
    return SAFE_PERIMETER_CELLS.has(pIndex);
}

// Función: Obtiene el índice perimetral (1-indexed, 1..52) de un token dado su slot y step.
// step 1..51 = casilla en el perímetro, step 0 = base, step 57 = meta (fuera del perímetro).
function getPerimeterIndex(slotIndex, step) {
    if (step <= 0 || step > 51) return -1; // fuera del perímetro
    return ((START_OFFSETS_BY_SLOT[slotIndex] + step - 1) % PERIMETER) + 1; // 1-indexed
}

// === FIN CONSTANTES MOTOR CAPTURAS ===

const rooms = {};

function generateUniqueRoomId() {
    let roomId;
    do {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[roomId]);
    return roomId;
}

// === [v8.1.0] INICIALIZAR ESTADO DE FICHAS DE LA SALA ===
// Crea la estructura room.tokenState: un array de fichas para todos los jugadores.
// tokenState[slotIdx][tokenId] = step (-1=base, 0=en_base_lista, 1-51=perimetro, 57=meta)
// NOTA: Todos comienzan en step -1 (dentro de la casa, no desplegados).
// El cliente envía step=0 cuando saca la ficha de la base, step=1..N para movimientos.
function initTokenState(numPlayers) {
    const state = [];
    for (let i = 0; i < numPlayers; i++) {
        state.push([-1, -1, -1, -1]); // 4 fichas por jugador, todas en casa
    }
    return state;
}

// === [v8.0.10] FUNCIÓN AUTORITATIVA: TIMER DE TURNO ===
function startTurnTimer(roomId, activePlayerId) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.activeTurnTimeout) {
        clearTimeout(room.activeTurnTimeout);
        room.activeTurnTimeout = null;
    }

    console.log(`[TIMER V8.1] Turno iniciado para ${activePlayerId} en sala ${roomId}. Tiempo: ${TURN_DURATION_SECONDS}s`);

    room.activeTurnTimeout = setTimeout(() => {
        room.activeTurnTimeout = null;

        if (room.currentTurnPlayerId !== activePlayerId) {
            console.log(`[TIMER V8.1] Timeout ignorado: el turno ya cambió de ${activePlayerId}.`);
            return;
        }

        const player = room.players ? room.players.find(p => p.playerId === activePlayerId) : null;
        if (player && player.isConnected && player.socketId) {
            console.log(`[TIMER V8.1] ¡Tiempo agotado! Notificando a ${activePlayerId} para jugada automática.`);
            io.to(player.socketId).emit('event_turn_timeout', {
                playerId: activePlayerId,
                reason: 'turn_timer_expired'
            });
        } else {
            console.log(`[TIMER V8.1] Timeout de ${activePlayerId} ignorado: jugador desconectado o sin socket.`);
        }
    }, TURN_DURATION_SECONDS * 1000);
}

// === [v8.0.10] FUNCIÓN AUXILIAR: EMITIR INICIO DE TURNO CON DELAY ===
function scheduleNextTurn(roomId, nextNetworkId) {
    const room = rooms[roomId];
    if (!room) return;

    room.isTransitioning = true;
    console.log(`[TRANSICIÓN V8.1] Sala ${roomId}: transición activa. Próximo jugador: ${nextNetworkId}. Delay: ${TURN_TRANSITION_DELAY_MS}ms`);

    setTimeout(() => {
        if (!rooms[roomId]) {
            console.log(`[TRANSICIÓN V8.1] Sala ${roomId} ya no existe al completar el delay. Abortando.`);
            return;
        }

        room.isTransitioning = false;
        room.currentTurnPlayerId = nextNetworkId;

        console.log(`[TRANSICIÓN V8.1] Sala ${roomId}: emitiendo event_turn_started para ${nextNetworkId}.`);
        io.in(roomId).emit('event_turn_started', {
            playerId: nextNetworkId,
            activePlayerId: nextNetworkId,
            activeId: nextNetworkId,
            turnDurationSeconds: TURN_DURATION_SECONDS
        });

        startTurnTimer(roomId, nextNetworkId);
    }, TURN_TRANSITION_DELAY_MS);
}

app.get('/', (req, res) => {
    res.send("Sweety Ludo V8.1.0 Motor AAA Autoritativo — Capturas + Timing Optimizado.");
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
                isTransitioning: false,
                currentTurnPlayerId: null,
                activeTurnTimeout: null,
                tokenState: null,       // [v8.1.0] Estado de fichas
                consecutiveDoubles: {}, // [v8.1.0] Contador de dobles consecutivos por jugador
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
            
            // [v8.1.0] Inicializar estado de fichas al comenzar la partida
            room.tokenState = initTokenState(room.players.length);
            room.consecutiveDoubles = {};
            room.players.forEach(p => { room.consecutiveDoubles[p.playerId] = 0; });
            
            io.in(foundRoomId).emit('match_found', {
                id: foundRoomId,
                roomId: foundRoomId,
                players: room.players
            });

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
            isTransitioning: false,
            currentTurnPlayerId: null,
            activeTurnTimeout: null,
            tokenState: null,       // [v8.1.0]
            consecutiveDoubles: {}, // [v8.1.0]
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
            const wasOffline = !existingPlayer.isConnected || existingPlayer.isBot;
            existingPlayer.socketId = socket.id;
            existingPlayer.isConnected = true;
            existingPlayer.isBot = false;
            delete existingPlayer._graceTurnsLeft;
            console.log(`[RECONEXIÓN] Jugador ${playerId} volvió a sala privada ${cleanRoomCode} vía JOIN_PRIVATE`);
            
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
            
            // [v8.1.0] Inicializar estado de fichas
            room.tokenState = initTokenState(room.players.length);
            room.consecutiveDoubles = {};
            room.players.forEach(p => { room.consecutiveDoubles[p.playerId] = 0; });
            
            io.in(cleanRoomCode).emit('match_found', {
                id: cleanRoomCode,
                roomId: cleanRoomCode,
                players: room.players
            });

            const firstPlayer = room.players[0].playerId;
            scheduleNextTurn(cleanRoomCode, firstPlayer);
        }
    });

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
            socket.emit('event_room_expired', { roomId: roomId, reason: "Sala ya no existe" });
        }
    });

    // === [v8.0.10] INTENT_ROLL_DICE — CON GUARDS AUTORITATIVOS ===
    socket.on('intent_roll_dice', (payload) => {
        const { roomId, playerId } = payload;
        const room = rooms[roomId];

        if (room && room.isTransitioning) {
            console.log(`[GUARD V8.1] intent_roll_dice de ${playerId} RECHAZADO: sala ${roomId} en transición de turno.`);
            return;
        }

        if (room && room.currentTurnPlayerId && room.currentTurnPlayerId !== playerId) {
            console.log(`[GUARD V8.1] intent_roll_dice de ${playerId} RECHAZADO: turno actual es de ${room.currentTurnPlayerId}.`);
            return;
        }

        if (room && room.activeTurnTimeout) {
            clearTimeout(room.activeTurnTimeout);
            room.activeTurnTimeout = null;
            console.log(`[TIMER V8.1] Timer cancelado para ${playerId}: el jugador lanzó los dados.`);
        }

        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;

        // [v8.1.0] Rastrear dobles consecutivos por jugador
        if (room) {
            if (!room.consecutiveDoubles) room.consecutiveDoubles = {};
            if (d1 === d2) {
                room.consecutiveDoubles[playerId] = (room.consecutiveDoubles[playerId] || 0) + 1;
                console.log(`[DOBLES V8.1] ${playerId} lleva ${room.consecutiveDoubles[playerId]} dobles consecutivos.`);
            } else {
                room.consecutiveDoubles[playerId] = 0;
            }
        }
        
        io.in(roomId).emit('event_dice_result', {
            playerId: playerId,
            diceRoll1: d1,
            diceRoll2: d2,
            diceValues: [d1, d2],
            vals: [d1, d2]
        });
    });

    // === [v8.1.0] INTENT_MOVE_TOKEN — MOTOR AUTORITATIVO DE CAPTURAS ===
    socket.on('intent_move_token', (payload) => {
        const { roomId, playerId, tokenId, newPathIndex, isBotMove } = payload;
        const room = rooms[roomId];

        // Emitir el movimiento de la ficha activa a todos los clientes
        io.in(roomId).emit('event_token_moved', {
            playerId,
            tokenId,
            newPathIndex,
            isBotMove: isBotMove || false
        });

        // [v8.1.0] Actualizar el estado de fichas del servidor
        if (room && room.tokenState) {
            const movingSlot = room.players.findIndex(p => p.playerId === playerId);
            
            if (movingSlot >= 0 && movingSlot < room.tokenState.length) {
                // Actualizar posición de la ficha que se movió
                room.tokenState[movingSlot][tokenId] = newPathIndex;
                console.log(`[CAPTURAS V8.1] Ficha ${tokenId} de slot ${movingSlot} movida a step ${newPathIndex}.`);

                // === EVALUACIÓN DE CAPTURA ===
                // Solo evaluar si el step es una casilla de perímetro normal (step 1..51)
                if (newPathIndex >= 1 && newPathIndex <= 51) {
                    const landingPIndex = getPerimeterIndex(movingSlot, newPathIndex);
                    
                    // Verificar si la casilla de destino es segura
                    if (!isSafeCell(landingPIndex)) {
                        // Buscar fichas enemigas en la misma casilla
                        for (let enemySlot = 0; enemySlot < room.tokenState.length; enemySlot++) {
                            if (enemySlot === movingSlot) continue; // saltar al propio jugador
                            
                            const enemyTokens = room.tokenState[enemySlot];
                            for (let enemyTokenId = 0; enemyTokenId < enemyTokens.length; enemyTokenId++) {
                                const enemyStep = enemyTokens[enemyTokenId];
                                
                                // La ficha enemiga debe estar en el perímetro (1..51)
                                if (enemyStep < 1 || enemyStep > 51) continue;
                                
                                const enemyPIndex = getPerimeterIndex(enemySlot, enemyStep);
                                
                                if (enemyPIndex === landingPIndex) {
                                    // ¡CAPTURA! La ficha enemiga regresa a su base
                                    const enemyPlayerId = room.players[enemySlot].playerId;
                                    console.log(`[CAPTURAS V8.1] ¡CAPTURA! Slot ${movingSlot} captura a slot ${enemySlot}, ficha ${enemyTokenId} (step ${enemyStep}, pIndex ${enemyPIndex}).`);
                                    
                                    // Actualizar el estado del servidor: la ficha enemiga regresa a base (-1)
                                    room.tokenState[enemySlot][enemyTokenId] = -1;
                                    
                                    // Emitir el evento de captura a todos los clientes
                                    // newPathIndex: -1 es la señal de "regresa a la base"
                                    io.in(roomId).emit('event_token_moved', {
                                        playerId: enemyPlayerId,
                                        tokenId: enemyTokenId,
                                        newPathIndex: -1,
                                        isBotMove: false,
                                        isCapture: true // campo informativo
                                    });
                                }
                            }
                        }
                    } else {
                        console.log(`[CAPTURAS V8.1] Casilla pIndex ${landingPIndex} es SEGURA — no hay captura.`);
                    }
                }
                // === FIN EVALUACIÓN DE CAPTURA ===

                // === PENALIZACIÓN POR 3 DOBLES CONSECUTIVOS ===
                // Si el jugador tiene 3 dobles, la ficha que acaba de mover regresa a la base.
                // El cliente también lo detecta, pero el servidor es la autoridad.
                if (room.consecutiveDoubles && room.consecutiveDoubles[playerId] >= 3) {
                    console.log(`[PENALIZACIÓN V8.1] ${playerId} obtuvo 3 dobles consecutivos. Ficha ${tokenId} regresa a base.`);
                    room.tokenState[movingSlot][tokenId] = -1;
                    room.consecutiveDoubles[playerId] = 0;
                    
                    // Emitir penalización: la ficha del propio jugador regresa a casa
                    io.in(roomId).emit('event_token_moved', {
                        playerId: playerId,
                        tokenId: tokenId,
                        newPathIndex: -1,
                        isBotMove: false,
                        isPenalty: true
                    });
                }
            }
        } else {
            // Sala sin tokenState inicializado (reconexión tardía o sala antigua).
            // No hacer nada adicional, el relay ya se emitió.
            console.log(`[CAPTURAS V8.1] Sala ${roomId} sin tokenState. Captura omitida (modo relay).`);
        }
    });

    // === [v8.0.10] INTENT_END_TURN — ORQUESTACIÓN CON DELAY AUTORITATIVO ===
    socket.on('intent_end_turn', (payload) => {
        const { roomId, nextPlayerId, nextTurnId } = payload;
        
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
        
        if (targetSlot === undefined) targetSlot = 0;

        const room = rooms[roomId];
        let nextNetworkId = String(parsedColorId);

        if (room && room.players && room.players[targetSlot]) {
            nextNetworkId = room.players[targetSlot].playerId;
        }

        // [v8.1.0] Reiniciar dobles consecutivos al cambiar de turno (a otro jugador)
        if (room && room.currentTurnPlayerId && room.currentTurnPlayerId !== nextNetworkId) {
            if (room.consecutiveDoubles) {
                room.consecutiveDoubles[room.currentTurnPlayerId] = 0;
            }
        }

        // V21.5 Autoritativo: Decrementar gracia al jugador que acaba de terminar su turno
        if (room && room.players && room.currentTurnSlot !== undefined) {
            const prevPlayer = room.players[room.currentTurnSlot];
            if (prevPlayer && prevPlayer.isConnected === false && prevPlayer._graceTurnsLeft !== undefined) {
                prevPlayer._graceTurnsLeft -= 1;
                console.log(`[GRACIA V21.5] Jugador ${prevPlayer.playerId} consumió 1 turno bot. Restantes: ${prevPlayer._graceTurnsLeft}`);
                
                if (prevPlayer._graceTurnsLeft <= 0) {
                    console.log(`[VERDUGO V21.5] Jugador ${prevPlayer.playerId} agotó su gracia. EXPULSADO.`);
                    
                    io.in(roomId).emit('event_player_expelled', { playerId: prevPlayer.playerId });
                    
                    prevPlayer.isExpelled = true;
                    prevPlayer.isBot = false;
                    
                    const activeHumans = room.players.filter(p => !p.isBot && p.isConnected && !p.isExpelled);
                    if (activeHumans.length <= 1) {
                        const winner = activeHumans[0];
                        room.lastWinnerId = winner ? winner.playerId : '';
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

    // === [v8.1.0] RESINCRONIZACIÓN DE ESTADO DE FICHAS ===
    // El cliente HOST puede sincronizar el tokenState del servidor tras una reconexión.
    socket.on('sync_token_state', (payload) => {
        const { roomId, tokenStates } = payload;
        const room = rooms[roomId];
        if (!room) return;
        
        // tokenStates es un array de { playerId, tokenId, step }
        if (Array.isArray(tokenStates)) {
            if (!room.tokenState) {
                room.tokenState = initTokenState(room.players.length);
            }
            tokenStates.forEach(({ playerId, tokenId, step }) => {
                const slotIdx = room.players.findIndex(p => p.playerId === playerId);
                if (slotIdx >= 0 && room.tokenState[slotIdx]) {
                    room.tokenState[slotIdx][tokenId] = step;
                }
            });
            console.log(`[SYNC V8.1] tokenState resincronizado para sala ${roomId}.`);
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
                    
                    if (room.currentTurnPlayerId === playerId && room.activeTurnTimeout) {
                        clearTimeout(room.activeTurnTimeout);
                        room.activeTurnTimeout = null;
                        console.log(`[TIMER V8.1] Timer de turno cancelado: jugador activo ${playerId} se desconectó.`);
                    }
                    
                    if (room.gameStarted) {
                        player.isBot = true;
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

                    const allDisconnected = room.players.every(p => p.isConnected === false);
                    if (allDisconnected) {
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
    console.log(`[SERVER] Sweety Ludo WebSocket Server V8.1.0 — Motor Autoritativo Capturas + Timing Optimizado en puerto ${PORT}`);
});
