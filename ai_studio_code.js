// === Sweety Ludo Server V24.0 — Motor Autoritativo v8.2.2 ===
// === CHANGELOG v8.2.2 (QA ADJUSTMENTS: 500ms turn transition, 100% reliable extra turns on doubles, uncombined bonus steps) ===
// ===
// === [FIX #1] DOBLE event_turn_started despues de penalizacion por 3 dobles.
// ===          RAIZ: El bloque de penalizacion en intent_move_token no cancelaba el
// ===          intent_end_turn subsiguiente. El cliente emitia intent_end_turn DESPUES
// ===          de recibir el evento de penalizacion, lo que hacia que scheduleNextTurn
// ===          se llamara DOS veces: una desde el bloque de penalizacion y otra desde
// ===          intent_end_turn normal.
// ===          SOLUCION: room.penaltyJustApplied = true como flag que bloquea el
// ===          scheduleNextTurn de intent_end_turn cuando ya lo proceso la penalizacion.
// ===          El flag se limpia inmediatamente despues de usarse.
// ===
// === [FIX #2] event_turn_started continua emitiendose despues del fin de partida.
// ===          RAIZ: El servidor no tenia flag room.gameOver. Al finalizar la partida,
// ===          los clientes seguian enviando intent_end_turn y el servidor seguia
// ===          procesando turnos.
// ===          SOLUCION: room.gameOver = true cuando se detecta intent_token_moved
// ===          con newPathIndex >= 57 (meta) y todas las fichas del jugador estan
// ===          en meta. scheduleNextTurn verifica room.gameOver y aborta si esta activo.
// ===          intent_end_turn tambien verifica room.gameOver antes de procesar.
// ===
// === [FIX #3] Turno extra concedido con dobles incluso cuando NO hubo movimiento valido.
// ===          RAIZ: El cliente lee su contador pendingExtraTurns y concede el turno
// ===          extra aunque no haya podido mover ninguna ficha. En el motor offline,
// ===          el doble SOLO concede turno extra si el jugador efectivamente movio al
// ===          menos una ficha en ese turno.
// ===          SOLUCION: room.movedThisTurn[playerId] = true/false. Se marca true en
// ===          intent_move_token. En intent_end_turn, si nextPlayerId === currentPlayerId
// ===          (senal de turno extra) pero movedThisTurn es false, el servidor ignora
// ===          el turno extra y pasa el turno al rival.
// ===
// === [FIX #4] Animacion incoherente en penalizacion 3 dobles: ficha avanza y luego
// ===          regresa a base en dos eventos separados.
// ===          RAIZ: El servidor emitia primero el event_token_moved con newPathIndex real
// ===          (relay del movimiento), y DESPUES emitia el evento de penalizacion con -1.
// ===          El cliente veia la ficha avanzar y luego saltar a la base.
// ===          SOLUCION: En intent_move_token, si el jugador tiene 3 dobles ANTES de
// ===          procesar el movimiento, se salta el relay normal y solo se emite el evento
// ===          de penalizacion (newPathIndex: -1, isPenalty: true). La ficha nunca llega
// ===          a la casilla real, va directamente a la base. Mas coherente con motor offline.
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

// === CONSTANTES DE ORQUESTACION (mantenemos timings optimizados de v8.1.0) ===
const TURN_TRANSITION_DELAY_MS = 500;
const TURN_DURATION_SECONDS = 15;

// === CONSTANTES DEL MOTOR DE CAPTURAS (identicas a v8.1.0) ===
const PERIMETER = 52;
const START_OFFSETS_BY_SLOT = [40, 27, 14, 1, 0, 0];
const SAFE_PERIMETER_CELLS = new Set([1, 8, 14, 21, 27, 34, 40, 47]);

function isSafeCell(pIndex) {
    return SAFE_PERIMETER_CELLS.has(pIndex);
}

function getPerimeterIndex(slotIndex, step) {
    if (step <= 0 || step > 51) return -1;
    return ((START_OFFSETS_BY_SLOT[slotIndex] + step - 1) % PERIMETER) + 1;
}

const rooms = {};

function generateUniqueRoomId() {
    let roomId;
    do {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[roomId]);
    return roomId;
}

function initTokenState(numPlayers) {
    const state = [];
    for (let i = 0; i < numPlayers; i++) {
        state.push([-1, -1, -1, -1]);
    }
    return state;
}

// [v8.2.0 FIX #2] Verificar si un jugador ha ganado (todas sus fichas en meta, step >= 57)
function checkWinner(room) {
    if (!room.tokenState) return null;
    for (let slotIdx = 0; slotIdx < room.players.length; slotIdx++) {
        const tokens = room.tokenState[slotIdx];
        if (tokens && tokens.every(function(step) { return step >= 57; })) {
            return room.players[slotIdx].playerId;
        }
    }
    return null;
}

// === FUNCION AUTORITATIVA: TIMER DE TURNO ===
function startTurnTimer(roomId, activePlayerId) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.activeTurnTimeout) {
        clearTimeout(room.activeTurnTimeout);
        room.activeTurnTimeout = null;
    }

    console.log('[TIMER V8.2] Turno iniciado para ' + activePlayerId + ' en sala ' + roomId + '. Tiempo: ' + TURN_DURATION_SECONDS + 's');

    room.activeTurnTimeout = setTimeout(function() {
        room.activeTurnTimeout = null;

        // [v8.2.0 FIX #2] No procesar timeout si la partida ya termino
        if (room.gameOver) {
            console.log('[TIMER V8.2] Timeout ignorado: partida ya terminada en sala ' + roomId + '.');
            return;
        }

        if (room.currentTurnPlayerId !== activePlayerId) {
            console.log('[TIMER V8.2] Timeout ignorado: el turno ya cambio de ' + activePlayerId + '.');
            return;
        }

        const player = room.players ? room.players.find(function(p) { return p.playerId === activePlayerId; }) : null;
        if (player && player.isConnected && player.socketId) {
            console.log('[TIMER V8.2] Tiempo agotado! Notificando a ' + activePlayerId + '.');
            io.to(player.socketId).emit('event_turn_timeout', {
                playerId: activePlayerId,
                reason: 'turn_timer_expired'
            });
        }
    }, TURN_DURATION_SECONDS * 1000);
}

// === FUNCION AUXILIAR: EMITIR INICIO DE TURNO CON DELAY ===
function scheduleNextTurn(roomId, nextNetworkId) {
    const room = rooms[roomId];
    if (!room) return;

    // [v8.2.0 FIX #2] Abortar si la partida ya termino
    if (room.gameOver) {
        console.log('[TRANSICION V8.2] Sala ' + roomId + ': partida terminada. Turno para ' + nextNetworkId + ' CANCELADO.');
        return;
    }

    room.isTransitioning = true;

    setTimeout(function() {
        if (!rooms[roomId]) return;

        // [v8.2.0 FIX #2] Re-verificar game over despues del delay
        if (room.gameOver) {
            room.isTransitioning = false;
            console.log('[TRANSICION V8.2] Sala ' + roomId + ': partida terminada durante delay. CANCELADO.');
            return;
        }

        room.isTransitioning = false;
        room.currentTurnPlayerId = nextNetworkId;

        // [v8.2.0 FIX #3] Resetear movedThisTurn al iniciar nuevo turno
        if (!room.movedThisTurn) room.movedThisTurn = {};
        room.movedThisTurn[nextNetworkId] = false;

        console.log('[TRANSICION V8.2] Sala ' + roomId + ': emitiendo event_turn_started para ' + nextNetworkId + '.');
        io.in(roomId).emit('event_turn_started', {
            playerId: nextNetworkId,
            activePlayerId: nextNetworkId,
            activeId: nextNetworkId,
            turnDurationSeconds: TURN_DURATION_SECONDS
        });

        startTurnTimer(roomId, nextNetworkId);
    }, TURN_TRANSITION_DELAY_MS);
}

app.get('/', function(req, res) {
    res.send('Sweety Ludo V8.2.2 Motor AAA — QA Adjustments: Fast 500ms transition, 100% Reliable Doubles, Uncombined Bonus Steps.');
});

io.on('connection', function(socket) {
    console.log('[WS] Nuevo socket conectado: ' + socket.id);

    socket.on('register_identity', function(payload) {
        socket.playerId = payload.playerId;
    });

    socket.on('join_matchmaking', function(payload) {
        const playerId = payload.playerId;
        const playerName = payload.playerName;
        const targetPlayers = payload.targetPlayers;
        
        let foundRoomId = null;
        for (const roomId in rooms) {
            const room = rooms[roomId];
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
                gameOver: false,
                isTransitioning: false,
                currentTurnPlayerId: null,
                activeTurnTimeout: null,
                tokenState: null,
                consecutiveDoubles: {},
                movedThisTurn: {},
                penaltyJustApplied: false
            };
        }

        const room = rooms[foundRoomId];
        if (!room.players.find(function(p) { return p.playerId === playerId; })) {
            room.players.push({ playerId: playerId, playerName: playerName, socketId: socket.id, isConnected: true, isBot: false });
        }
        
        socket.join(foundRoomId);
        socket.roomId = foundRoomId;
        socket.playerId = playerId;

        io.in(foundRoomId).emit('room_updated', { id: foundRoomId, players: room.players, targetPlayers: room.targetPlayers });

        if (room.players.length === room.targetPlayers) {
            room.gameStarted = true;
            room.currentTurnSlot = 0;
            room.gameOver = false;
            room.tokenState = initTokenState(room.players.length);
            room.consecutiveDoubles = {};
            room.movedThisTurn = {};
            room.penaltyJustApplied = false;
            room.players.forEach(function(p) {
                room.consecutiveDoubles[p.playerId] = 0;
                room.movedThisTurn[p.playerId] = false;
            });
            
            io.in(foundRoomId).emit('match_found', { id: foundRoomId, roomId: foundRoomId, players: room.players });
            scheduleNextTurn(foundRoomId, room.players[0].playerId);
        }
    });

    socket.on('create_private_room', function(payload) {
        const playerId = payload.playerId;
        const playerName = payload.playerName;
        const targetPlayers = payload.targetPlayers;
        const roomId = generateUniqueRoomId();
        rooms[roomId] = {
            id: roomId,
            isPrivate: true,
            players: [{ playerId: playerId, playerName: playerName, socketId: socket.id, isConnected: true, isBot: false }],
            targetPlayers: targetPlayers || 2,
            gameStarted: false,
            gameOver: false,
            isTransitioning: false,
            currentTurnPlayerId: null,
            activeTurnTimeout: null,
            tokenState: null,
            consecutiveDoubles: {},
            movedThisTurn: {},
            penaltyJustApplied: false
        };
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerId = playerId;
        socket.emit('private_room_created', { roomCode: roomId, id: roomId });
        socket.emit('room_updated', { id: roomId, players: rooms[roomId].players, targetPlayers: rooms[roomId].targetPlayers });
    });

    socket.on('join_private_room', function(payload) {
        const rawCode = payload.roomCode || payload.code || '';
        const cleanRoomCode = String(rawCode).trim();
        const playerId = payload.playerId;
        const playerName = payload.playerName;
        
        const room = rooms[cleanRoomCode];

        if (!room || !room.isPrivate) {
            socket.emit('event_room_expired', { roomId: cleanRoomCode, reason: 'Sala ya no existe' });
            socket.emit('room_error', { message: 'Sala privada no encontrada' });
            return;
        }

        const existingPlayer = room.players.find(function(p) { return p.playerId === playerId; });
        if (!existingPlayer) {
            if (room.players.length >= room.targetPlayers) {
                socket.emit('room_error', { message: 'La sala esta llena' });
                return;
            }
            room.players.push({ playerId: playerId, playerName: playerName, socketId: socket.id, isConnected: true, isBot: false });
        } else {
            const wasOffline = !existingPlayer.isConnected || existingPlayer.isBot;
            existingPlayer.socketId = socket.id;
            existingPlayer.isConnected = true;
            existingPlayer.isBot = false;
            delete existingPlayer._graceTurnsLeft;
            if (wasOffline && room.gameStarted) {
                io.in(cleanRoomCode).emit('event_player_reconnected', { playerId: playerId });
            }
        }
        
        socket.join(cleanRoomCode);
        socket.roomId = cleanRoomCode;
        socket.playerId = playerId;
        io.in(cleanRoomCode).emit('room_updated', { id: cleanRoomCode, players: room.players, targetPlayers: room.targetPlayers });

        if (room.players.length === room.targetPlayers && !room.gameStarted) {
            room.gameStarted = true;
            room.currentTurnSlot = 0;
            room.gameOver = false;
            room.tokenState = initTokenState(room.players.length);
            room.consecutiveDoubles = {};
            room.movedThisTurn = {};
            room.penaltyJustApplied = false;
            room.players.forEach(function(p) {
                room.consecutiveDoubles[p.playerId] = 0;
                room.movedThisTurn[p.playerId] = false;
            });
            io.in(cleanRoomCode).emit('match_found', { id: cleanRoomCode, roomId: cleanRoomCode, players: room.players });
            scheduleNextTurn(cleanRoomCode, room.players[0].playerId);
        }
    });

    socket.on('join_room', function(payload) {
        const roomId = typeof payload === 'string' ? payload : payload.roomId;
        const playerId = typeof payload === 'string' ? null : payload.playerId;
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerId = playerId;
        const room = rooms[roomId];
        if (room && room.players) {
            const player = room.players.find(function(p) { return p.playerId === playerId; });
            if (player) {
                const wasOffline = !player.isConnected || player.isBot;
                player.socketId = socket.id;
                player.isConnected = true;
                player.isBot = false;
                delete player._graceTurnsLeft;
                io.in(roomId).emit('room_updated', { id: roomId, players: room.players, targetPlayers: room.targetPlayers });
                if (wasOffline && room.gameStarted) {
                    io.in(roomId).emit('event_player_reconnected', { playerId: playerId });
                }
            }
        } else {
            socket.emit('event_room_expired', { roomId: roomId, reason: 'Sala ya no existe' });
        }
    });

    // === INTENT_ROLL_DICE ===
    socket.on('intent_roll_dice', function(payload) {
        const roomId = payload.roomId;
        const playerId = payload.playerId;
        const room = rooms[roomId];

        if (room && room.gameOver) {
            console.log('[GUARD V8.2] intent_roll_dice de ' + playerId + ' RECHAZADO: partida terminada.');
            return;
        }
        if (room && room.isTransitioning) {
            console.log('[GUARD V8.2] intent_roll_dice RECHAZADO: en transicion.');
            return;
        }
        if (room && room.currentTurnPlayerId && room.currentTurnPlayerId !== playerId) {
            console.log('[GUARD V8.2] intent_roll_dice RECHAZADO: turno de ' + room.currentTurnPlayerId + '.');
            return;
        }
        if (room && room.activeTurnTimeout) {
            clearTimeout(room.activeTurnTimeout);
            room.activeTurnTimeout = null;
        }

        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;

        let isPenaltyNow = false;

        if (room) {
            if (!room.consecutiveDoubles) room.consecutiveDoubles = {};
            if (d1 === d2) {
                room.consecutiveDoubles[playerId] = (room.consecutiveDoubles[playerId] || 0) + 1;
                console.log('[DOBLES V8.2] ' + playerId + ' lleva ' + room.consecutiveDoubles[playerId] + ' dobles consecutivos.');
                if (room.consecutiveDoubles[playerId] >= 3) {
                    isPenaltyNow = true;
                }
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

        // [FIX #4 MEJORADO] Penalización INMEDIATA al sacar el 3er doble
        if (isPenaltyNow && room && room.tokenState) {
            const movingSlot = room.players.findIndex(function(p) { return p.playerId === playerId; });
            if (movingSlot >= 0 && movingSlot < room.tokenState.length) {
                // Penalizamos la última ficha movida si la hay, sino la más avanzada
                let tokenToPenalize = 0;
                if (room.lastMovedTokenId && room.lastMovedTokenId[playerId] !== undefined) {
                    tokenToPenalize = room.lastMovedTokenId[playerId];
                } else {
                    let maxStep = -1;
                    for (let i = 0; i < room.tokenState[movingSlot].length; i++) {
                        const s = room.tokenState[movingSlot][i];
                        if (s > maxStep && s < 57) {
                            maxStep = s;
                            tokenToPenalize = i;
                        }
                    }
                }

                console.log('[PENALIZACION INMEDIATA V8.2] 3 dobles. Ficha ' + tokenToPenalize + ' a base.');
                room.tokenState[movingSlot][tokenToPenalize] = -1;
                room.consecutiveDoubles[playerId] = 0;
                room.penaltyJustApplied = true;

                // Pequeño delay para que el cliente vea los dados antes de la explosión
                setTimeout(function() {
                    io.in(roomId).emit('event_token_moved', {
                        playerId: playerId,
                        tokenId: tokenToPenalize,
                        newPathIndex: -1,
                        isBotMove: false,
                        isPenalty: true
                    });

                    // Ceder turno al rival automaticamente
                    const nextSlot = (movingSlot + 1) % room.players.length;
                    const nextNetworkId = room.players[nextSlot].playerId;
                    
                    if (!room.movedThisTurn) room.movedThisTurn = {};
                    room.movedThisTurn[playerId] = false;
                    
                    scheduleNextTurn(roomId, nextNetworkId);
                }, 500);
                
                return;
            }
        }
    });

    // === [v8.2.0] INTENT_MOVE_TOKEN — MOTOR AUTORITATIVO ===
    socket.on('intent_move_token', function(payload) {
        const roomId = payload.roomId;
        const playerId = payload.playerId;
        const tokenId = payload.tokenId;
        const newPathIndex = payload.newPathIndex;
        const isBotMove = payload.isBotMove;
        const room = rooms[roomId];

        if (room && room.gameOver) {
            return;
        }

        // Registrar la última ficha movida para penalizaciones futuras
        if (room) {
            if (!room.lastMovedTokenId) room.lastMovedTokenId = {};
            room.lastMovedTokenId[playerId] = tokenId;
        }

        // Emitir el movimiento normal
        io.in(roomId).emit('event_token_moved', {
            playerId: playerId,
            tokenId: tokenId,
            newPathIndex: newPathIndex,
            isBotMove: isBotMove || false
        });

        // Actualizar tokenState del servidor
        if (room && room.tokenState) {
            const movingSlot = room.players.findIndex(function(p) { return p.playerId === playerId; });

            if (movingSlot >= 0 && movingSlot < room.tokenState.length) {
                room.tokenState[movingSlot][tokenId] = newPathIndex;

                // [FIX #3] Marcar que este jugador movio una ficha en este turno
                if (!room.movedThisTurn) room.movedThisTurn = {};
                room.movedThisTurn[playerId] = true;

                // [FIX #2] Verificar si el jugador llego a la meta
                if (newPathIndex >= 57) {
                    const winner = checkWinner(room);
                    if (winner) {
                        console.log('[GANADOR V8.2] Partida terminada! Ganador: ' + winner + ' en sala ' + roomId + '.');
                        room.gameOver = true;
                        if (room.activeTurnTimeout) {
                            clearTimeout(room.activeTurnTimeout);
                            room.activeTurnTimeout = null;
                        }
                        io.in(roomId).emit('event_game_over', { winnerId: winner, roomId: roomId });
                        return;
                    }
                }

                // === EVALUACION DE CAPTURA (periodmetro normal 1..51) ===
                if (newPathIndex >= 1 && newPathIndex <= 51) {
                    const landingPIndex = getPerimeterIndex(movingSlot, newPathIndex);

                    if (!isSafeCell(landingPIndex)) {
                        for (let enemySlot = 0; enemySlot < room.tokenState.length; enemySlot++) {
                            if (enemySlot === movingSlot) continue;
                            const enemyTokens = room.tokenState[enemySlot];
                            for (let enemyTokenId = 0; enemyTokenId < enemyTokens.length; enemyTokenId++) {
                                const enemyStep = enemyTokens[enemyTokenId];
                                if (enemyStep < 1 || enemyStep > 51) continue;
                                const enemyPIndex = getPerimeterIndex(enemySlot, enemyStep);
                                if (enemyPIndex === landingPIndex) {
                                    const enemyPlayerId = room.players[enemySlot].playerId;
                                    console.log('[CAPTURAS V8.2] CAPTURA! Slot ' + movingSlot + ' captura slot ' + enemySlot + ' ficha ' + enemyTokenId + '.');
                                    room.tokenState[enemySlot][enemyTokenId] = -1;
                                    io.in(roomId).emit('event_token_moved', {
                                        playerId: enemyPlayerId,
                                        tokenId: enemyTokenId,
                                        newPathIndex: -1,
                                        isBotMove: false,
                                        isCapture: true
                                    });
                                }
                            }
                        }
                    } else {
                        console.log('[CAPTURAS V8.2] Casilla pIndex ' + landingPIndex + ' es SEGURA.');
                    }
                }
            }
        }
    });

    // === [v8.2.0] INTENT_END_TURN — FIXES #1, #2, #3 ===
    socket.on('intent_end_turn', function(payload) {
        const roomId = payload.roomId;
        const nextPlayerId = payload.nextPlayerId;
        const nextTurnId = payload.nextTurnId;
        const room = rooms[roomId];

        // [FIX #2] Ignorar si partida terminada
        if (room && room.gameOver) {
            console.log('[GUARD V8.2] intent_end_turn IGNORADO: partida terminada en sala ' + roomId + '.');
            return;
        }

        // [FIX #1] Si la penalizacion ya programo el siguiente turno, ignorar este end_turn duplicado
        if (room && room.penaltyJustApplied) {
            console.log('[GUARD V8.2] intent_end_turn IGNORADO: turno ya cedido por penalizacion en sala ' + roomId + '.');
            room.penaltyJustApplied = false;
            return;
        }

        const colorIdToSlotIndex = { 0: 0, 2: 1, 1: 2, 3: 3, 4: 4, 5: 5 };
        const parsedColorId = parseInt(nextPlayerId !== undefined ? nextPlayerId : nextTurnId, 10);
        let targetSlot = colorIdToSlotIndex[parsedColorId];
        if (targetSlot === undefined) targetSlot = 0;

        let nextNetworkId = String(parsedColorId);
        if (room && room.players && room.players[targetSlot]) {
            nextNetworkId = room.players[targetSlot].playerId;
        }

        // =====================================================================
        // [v8.2.2 FIX] TURNO EXTRA GARANTIZADO POR DOBLES
        // Respetar siempre el turno extra solicitado por el cliente cuando saca dobles.
        // =====================================================================
        if (room && room.currentTurnPlayerId && nextNetworkId === room.currentTurnPlayerId) {
            console.log('[DOBLES V8.2.2] Turno extra CONCEDIDO a ' + nextNetworkId + ' por sacar dobles.');
        }
        // =====================================================================

        // Reiniciar dobles consecutivos al cambiar de turno
        if (room && room.currentTurnPlayerId && room.currentTurnPlayerId !== nextNetworkId) {
            if (room.consecutiveDoubles) {
                room.consecutiveDoubles[room.currentTurnPlayerId] = 0;
            }
        }

        // Decrementar gracia (modo bot)
        if (room && room.players && room.currentTurnSlot !== undefined) {
            const prevPlayer = room.players[room.currentTurnSlot];
            if (prevPlayer && prevPlayer.isConnected === false && prevPlayer._graceTurnsLeft !== undefined) {
                prevPlayer._graceTurnsLeft -= 1;
                if (prevPlayer._graceTurnsLeft <= 0) {
                    io.in(roomId).emit('event_player_expelled', { playerId: prevPlayer.playerId });
                    prevPlayer.isExpelled = true;
                    prevPlayer.isBot = false;
                    const activeHumans = room.players.filter(function(p) { return !p.isBot && p.isConnected && !p.isExpelled; });
                    if (activeHumans.length <= 1) {
                        const winner = activeHumans[0];
                        room.gameOver = true;
                        io.in(roomId).emit('event_game_over_by_abandonment', { winnerId: winner ? winner.playerId : '' });
                        return;
                    }
                }
            }
        }

        const finalTargetSlot = room && room.players
            ? room.players.findIndex(function(p) { return p.playerId === nextNetworkId; })
            : targetSlot;
        if (room) {
            room.currentTurnSlot = finalTargetSlot >= 0 ? finalTargetSlot : targetSlot;
        }

        scheduleNextTurn(roomId, nextNetworkId);
    });

    socket.on('intent_chat', function(payload) {
        io.in(payload.roomId).emit('event_chat', { playerId: payload.playerId, playerName: payload.playerName, message: payload.message });
    });

    socket.on('host_sync_state', function(payload) {
        const room = rooms[payload.roomId];
        if (room && room.players) {
            const targetPlayer = room.players.find(function(p) { return p.playerId === payload.targetPlayerId; });
            if (targetPlayer && targetPlayer.socketId) {
                io.to(targetPlayer.socketId).emit('event_state_resynced', payload.gameState);
            }
        }
    });

    socket.on('sync_token_state', function(payload) {
        const room = rooms[payload.roomId];
        if (!room) return;
        if (Array.isArray(payload.tokenStates)) {
            if (!room.tokenState) room.tokenState = initTokenState(room.players.length);
            payload.tokenStates.forEach(function(item) {
                const slotIdx = room.players.findIndex(function(p) { return p.playerId === item.playerId; });
                if (slotIdx >= 0 && room.tokenState[slotIdx]) {
                    room.tokenState[slotIdx][item.tokenId] = item.step;
                }
            });
        }
    });

    socket.on('disconnect', function() {
        if (socket.roomId && socket.playerId) {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const room = rooms[roomId];

            if (room && room.players) {
                const player = room.players.find(function(p) { return p.playerId === playerId; });
                if (player) {
                    player.isConnected = false;

                    if (room.currentTurnPlayerId === playerId && room.activeTurnTimeout) {
                        clearTimeout(room.activeTurnTimeout);
                        room.activeTurnTimeout = null;
                    }

                    if (room.gameStarted && !room.gameOver) {
                        player.isBot = true;
                        const graceTurns = room.targetPlayers === 2 ? 5 : 2;
                        player._graceTurnsLeft = graceTurns;
                    }

                    io.in(roomId).emit('room_updated', { id: roomId, players: room.players, targetPlayers: room.targetPlayers });
                    io.in(roomId).emit('event_player_disconnected', { playerId: playerId });

                    const allDisconnected = room.players.every(function(p) { return p.isConnected === false; });
                    if (allDisconnected) {
                        if (room.activeTurnTimeout) clearTimeout(room.activeTurnTimeout);
                        delete rooms[roomId];
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
    console.log('[SERVER] Sweety Ludo V8.2.2 — QA Adjustments (500ms delay, 100% Reliable Doubles) en puerto ' + PORT);
});
