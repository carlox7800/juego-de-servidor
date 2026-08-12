// === Sweety Ludo Server v8.3.3 (Alineación Autoritativa de Slots en Salas Privadas) ===
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);

// === V21.5: MOTOR AAA AUTORITATIVO CON TIEMPO DE GRACIA Y BOT TAKEOVER ===
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 4000,
    pingTimeout: 5000
});

const rooms = {};

// === REGISTRO Y REGLAMENTO AUTORITATIVO EN BACKEND (FASE 1: MOTOR DE LÓGICA V8.0.2) ===

const SQUARE_COLORS_ORDER = ['yellow', 'red', 'green', 'blue', 'purple', 'orange'];
const HEX_COLORS_ORDER = ['purple', 'red', 'yellow', 'orange', 'blue', 'green'];

const HEX_COLOR_INFO = {
  purple: { color: 'purple', name: 'Morado', startCell: 8, homeEntryCell: 6, starCell: 8, sectorIndex: 0 },
  green:  { color: 'green',  name: 'Verde',  startCell: 73, homeEntryCell: 71, starCell: 73, sectorIndex: 1 },
  blue:   { color: 'blue',   name: 'Azul',   startCell: 60, homeEntryCell: 58, starCell: 60, sectorIndex: 2 },
  orange: { color: 'orange', name: 'Naranja',startCell: 47, homeEntryCell: 45, starCell: 47, sectorIndex: 3 },
  yellow: { color: 'yellow', name: 'Amarillo',startCell: 34, homeEntryCell: 32, starCell: 34, sectorIndex: 4 },
  red:    { color: 'red',    name: 'Rojo',   startCell: 21, homeEntryCell: 19, starCell: 21, sectorIndex: 5 }
};

const STAR_CELLS_HEX = [2, 8, 15, 21, 28, 34, 41, 47, 54, 60, 67, 73];
const STAR_CELLS_SQUARE = [8, 21, 34, 47, 60, 73];

function getTrackSteps(isHex) { return isHex ? 77 : 51; }
function getGoalStep(isHex) { return isHex ? 82 : 56; }
function getTotalPerimeter(isHex) { return isHex ? 78 : 52; }

function getStartOffset(color, isHex) {
  if (isHex) {
    const offsets6 = { blue: 1, green: 14, red: 27, yellow: 40, purple: 53, orange: 66 };
    return offsets6[color] || 0;
  }
  const offsets4 = { blue: 1, green: 14, red: 27, yellow: 40, purple: 0, orange: 0 };
  return offsets4[color] || 0;
}

function getCellIndexForToken(color, step, isHex) {
  if (step === -1) return 'BASE';
  if (isHex) {
    const info = HEX_COLOR_INFO[color];
    if (!info) return 'BASE';
    if (step >= 1 && step <= 77) {
      const idx = (info.startCell + (step - 1)) % 78;
      return idx === 0 ? 78 : idx;
    }
    if (step >= 78 && step <= 81) return `H${step - 77}`;
    return 'GOAL';
  } else {
    const trackSteps = 51;
    const perimeter = 52;
    if (step >= 1 && step < trackSteps) {
      return (getStartOffset(color, false) + step) % perimeter;
    }
    if (step >= trackSteps && step <= 56) return `H${step - trackSteps + 1}`;
    return 'GOAL';
  }
}

/**
 * Mando de Evaluación Autoritativa de Reglas
 * Aplica: Expulsión de salida obligatoria, Capturas normales y Bonificaciones (+10/+20/+25).
 */
function evaluateMoveRulesAuthoritative(tokens, movingTokenIndex, movingPlayerIdx, targetStep, totalPlayers) {
  const isHex = totalPlayers > 4;
  const currentColorsOrder = isHex ? HEX_COLORS_ORDER : SQUARE_COLORS_ORDER;
  const movingToken = tokens.find(t => t.playerId === movingPlayerIdx && t.id === movingTokenIndex);
  if (!movingToken) return { updatedTokens: tokens, capturedTokens: [], bonusSteps: 0, isExpulsion: false };

  const color = currentColorsOrder[movingPlayerIdx] || 'yellow';
  const trackSteps = getTrackSteps(isHex);
  const goalStep = getGoalStep(isHex);
  const perimeter = getTotalPerimeter(isHex);

  let bonusSteps = 0;
  let capturedTokens = [];
  let isExpulsion = false;

  // 1. Regla de Meta
  if (targetStep === goalStep) {
    bonusSteps += isHex ? 15 : 10;
  }

  // 2. Comprobar colisión en el camino seguro/público (0-50)
  if (targetStep >= 1 && targetStep < trackSteps) {
    const pIndex = (getStartOffset(color, isHex) + targetStep) % perimeter;
    const isSafeStar = isHex ? STAR_CELLS_HEX.includes(pIndex) : STAR_CELLS_SQUARE.includes(pIndex);

    if (!isSafeStar) {
      if (isHex) {
        // En Hexagonal, comprobamos barreras o capturas
        const enemyTokens = tokens.filter(t => {
          if (t.playerId === movingPlayerIdx || t.step < 1 || t.step >= trackSteps) return false;
          const oppColor = currentColorsOrder[t.playerId];
          const oppPIndex = (getStartOffset(oppColor, true) + t.step) % perimeter;
          return oppPIndex === pIndex;
        });

        // Expulsión por Salida Obligatoria
        if (targetStep === 1) {
          if (enemyTokens.length > 0) {
            capturedTokens = enemyTokens;
            isExpulsion = true;
            bonusSteps += 0;
          }
        } else {
          if (enemyTokens.length > 0) {
            capturedTokens = enemyTokens;
            bonusSteps += 20;
          }
        }
      } else {
        // En Cuadrado (4 Jugadores)
        const enemyTokens = tokens.filter(t => {
          if (t.playerId === movingPlayerIdx || t.step < 1 || t.step >= trackSteps) return false;
          const oppColor = currentColorsOrder[t.playerId];
          const oppPIndex = (getStartOffset(oppColor, false) + t.step) % perimeter;
          return oppPIndex === pIndex;
        });
        if (enemyTokens.length > 0) {
          capturedTokens = enemyTokens;
          bonusSteps += 20;
        }
      }
    }
  }

  // Aplicar movimiento y retornos a casa (step = -1)
  const updatedTokens = tokens.map(t => {
    if (t.playerId === movingPlayerIdx && t.id === movingTokenIndex) {
      return { ...t, step: targetStep };
    }
    if (capturedTokens.some(c => c.playerId === t.playerId && c.id === t.id)) {
      return { ...t, step: -1 };
    }
    return t;
  });

  return { updatedTokens, capturedTokens, bonusSteps, isExpulsion };
}

/**
 * Evaluación Autoritativa de Penalización por 3 Dobles Consecutivos
 */
function evaluateThreeDoublesPenaltyAuthoritative(tokens, playerId, lastMovedTokenId) {
  if (lastMovedTokenId === null || lastMovedTokenId === undefined) {
    return { updatedTokens: tokens, penalizedToken: null };
  }
  let penalizedToken = null;
  const updatedTokens = tokens.map(t => {
    if (t.playerId === playerId && t.id === lastMovedTokenId && t.step > 0) {
      penalizedToken = t;
      return { ...t, step: -1 };
    }
    return t;
  });
  return { updatedTokens, penalizedToken };
}

function generateUniqueRoomId() {
    let roomId;
    do {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[roomId]);
    return roomId;
}

app.get('/', (req, res) => {
    res.send("Sweety Ludo v8.3.3 Motor AAA Autoritativo is running.");
});

/**
 * Inicialización Autoritativa de Fichas y Contadores por Sala (Fase 2)
 * Tableros <= 4 jugadores: 4 fichas por jugador.
 * Tableros >= 5 jugadores: 3 fichas por jugador.
 */
function initializeRoomStateAuthoritative(room) {
    const totalPlayers = room.targetPlayers || room.players.length || 4;
    const isHex = totalPlayers > 4;
    const tokensPerPlayer = isHex ? 3 : 4;
    
    room.tokens = [];
    room.consecutiveDoublesMap = {};
    room.lastMovedTokenMap = {};

    room.players.forEach((player, pIdx) => {
        room.consecutiveDoublesMap[player.playerId] = 0;
        room.lastMovedTokenMap[player.playerId] = null;

        for (let tId = 0; tId < tokensPerPlayer; tId++) {
            room.tokens.push({
                id: tId,
                playerId: pIdx,
                networkPlayerId: player.playerId,
                step: -1
            });
        }
    });

    console.log(`[AUTORITATIVO QA] 🚀 Sala ${room.id} (${totalPlayers}J - ${isHex ? 'Hexagonal' : 'Cuadrado'}) inicializada con ${room.tokens.length} fichas autoritativas (${tokensPerPlayer} fichas/jugador a paso -1).`);
}

io.on('connection', (socket) => {
    console.log(`[WS] Nuevo socket conectado: ${socket.id}`);

    socket.on('register_identity', (payload) => {
        socket.playerId = payload.playerId;
        console.log(`[AUTH] Socket ${socket.id} registrado como PlayerID: ${socket.playerId}`);
    });

    socket.on('join_matchmaking', (payload) => {
        const { playerId, playerName, targetPlayers } = payload;
        
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
                isBot: false,
                slotIndex: room.players.length
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
            room.currentTurnSlot = 0; // Initialize turn slot
            
            // Inicializar memoria de fichas autoritativas (Fase 2)
            initializeRoomStateAuthoritative(room);

            io.in(foundRoomId).emit('match_found', {
                id: foundRoomId,
                roomId: foundRoomId,
                players: room.players
            });

            // V21.1: Emit event_turn_started directly to unfreeze UI
            const firstPlayer = room.players[0].playerId;
            io.in(foundRoomId).emit('event_turn_started', {
                playerId: firstPlayer,
                activePlayerId: firstPlayer,
                turnDurationSeconds: 15
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
                isBot: false,
                slotIndex: 0
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
                isBot: false,
                slotIndex: room.players.length
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
            
            initializeRoomStateAuthoritative(room);

            io.in(cleanRoomCode).emit('match_found', {
                id: cleanRoomCode,
                roomId: cleanRoomCode,
                players: room.players
            });
            setTimeout(() => {
                const firstPlayer = room.players[0].playerId;
                io.in(cleanRoomCode).emit('event_turn_started', {
                    playerId: firstPlayer,
                    activePlayerId: firstPlayer,
                    turnDurationSeconds: 15
                });
            }, 3500);
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

    socket.on('intent_roll_dice', (payload) => {
        const { roomId, playerId } = payload;
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        
        const room = rooms[roomId];

        if (room && room.consecutiveDoublesMap) {
            if (d1 === d2) {
                room.consecutiveDoublesMap[playerId] = (room.consecutiveDoublesMap[playerId] || 0) + 1;
                console.log(`[AUTORITATIVO QA] 🎲 Jugador ${playerId} en Sala ${roomId} obtuvo DOBLES [${d1}, ${d2}]. Consecutivos: ${room.consecutiveDoublesMap[playerId]}`);

                // v8.3.0 Pausa dramática en 3er Doble
                if (room.consecutiveDoublesMap[playerId] >= 3) {
                    console.log(`[AUTORITATIVO QA v8.3.0] 🚨 Jugador ${playerId} en Sala ${roomId} SACÓ EL 3er DOBLE! Emitiendo dados primero...`);
                    
                    io.in(roomId).emit('event_dice_result', {
                        playerId,
                        vals: [d1, d2]
                    });

                    setTimeout(() => {
                        console.log(`[AUTORITATIVO QA v8.3.0] 💥 1200ms cumplidos. Aplicando castigo de 3er doble a la última ficha movida de ${playerId}...`);
                        const lastMovedTokenId = room.lastMovedTokenMap ? room.lastMovedTokenMap[playerId] : null;
                        
                        const { updatedTokens, penalizedToken } = evaluateThreeDoublesPenaltyAuthoritative(
                            room.tokens, playerId, lastMovedTokenId
                        );

                        if (penalizedToken) {
                            room.tokens = updatedTokens;
                            io.in(roomId).emit('event_token_moved', {
                                playerId: playerId,
                                tokenId: penalizedToken.id,
                                newPathIndex: -1,
                                isBotMove: false,
                                isPenalty: true
                            });
                            console.log(`[AUTORITATIVO QA v8.3.0] 🚫 Ficha ${penalizedToken.id} del Jugador ${playerId} expulsada por 3er doble.`);
                        }

                        room.consecutiveDoublesMap[playerId] = 0;

                        // Pasar turno obligatoriamente
                        let nextSlot = (room.currentTurnSlot + 1) % room.players.length;
                        room.currentTurnSlot = nextSlot;
                        const nextPlayerId = room.players[nextSlot] ? room.players[nextSlot].playerId : String(nextSlot);

                        io.in(roomId).emit('event_turn_started', {
                            playerId: nextPlayerId,
                            activePlayerId: nextPlayerId,
                            turnDurationSeconds: 15
                        });
                    }, 1200);

                    return;
                }
            } else {
                room.consecutiveDoublesMap[playerId] = 0;
            }
        }

        io.in(roomId).emit('event_dice_result', {
            playerId,
            vals: [d1, d2]
        });
    });

    socket.on('intent_move_token', (payload) => {
        const { tokenId, newPathIndex, isBotMove } = payload;
        const roomId = socket.roomId;
        const room = rooms[roomId];

        let playerId = socket.playerId;
        let capturedToEmit = [];

        if (room && room.tokens) {
            const targetPlayerIdx = room.currentTurnSlot;
            const isHex = (room.targetPlayers || room.players.length) > 4;

            if (room.players && room.players[targetPlayerIdx]) {
                playerId = room.players[targetPlayerIdx].playerId;
            }

            if (room.lastMovedTokenMap) {
                room.lastMovedTokenMap[playerId] = tokenId;
            }

            const token = room.tokens.find(t => t.playerId === targetPlayerIdx && t.id === tokenId);
            if (token) {
                const oldStep = token.step;
                const distanceMoved = (oldStep > 0 && newPathIndex > oldStep) ? (newPathIndex - oldStep) : newPathIndex;

                if (room.pendingBonusMap && room.pendingBonusMap[playerId] > 0) {
                    const currentBonus = room.pendingBonusMap[playerId];
                    
                    if (distanceMoved > 12) {
                        console.log(`[AUTORITATIVO V8.2.9] ⚡ Salto combinado detectado (Movimiento: ${distanceMoved} pasos). Limpiando bono pendiente (+${currentBonus}) de ${playerId}.`);
                        room.pendingBonusMap[playerId] = 0;
                    } else {
                        let bonusToDeduct = 0;
                        if (distanceMoved === 20 || distanceMoved === 10 || distanceMoved === 25 || distanceMoved === 15) {
                            bonusToDeduct = distanceMoved;
                        } else if (currentBonus >= distanceMoved) {
                            bonusToDeduct = distanceMoved;
                        } else {
                            bonusToDeduct = currentBonus;
                        }
                        
                        if (bonusToDeduct > 0) {
                            room.pendingBonusMap[playerId] -= bonusToDeduct;
                            console.log(`[AUTORITATIVO V8.2.9] 🎯 Jugador ${playerId} consumió ${bonusToDeduct} pasos de bono (Movimiento total: ${distanceMoved}). Restantes: ${room.pendingBonusMap[playerId]}`);
                        }
                    }
                }

                const colorName = (isHex ? HEX_COLORS_ORDER : SQUARE_COLORS_ORDER)[targetPlayerIdx] || 'yellow';
                const cellDesc = getCellIndexForToken(colorName, newPathIndex, isHex);

                console.log(`[AUTORITATIVO QA] ♟️ Sala ${roomId} | Jugador ${playerId} (Slot ${targetPlayerIdx} - ${colorName}) movió Ficha ${tokenId} de paso ${oldStep} -> ${newPathIndex} (Casilla: ${cellDesc}).`);

                const { updatedTokens, capturedTokens, bonusSteps, isExpulsion } = evaluateMoveRulesAuthoritative(
                    room.tokens, tokenId, targetPlayerIdx, newPathIndex, room.targetPlayers || room.players.length
                );

                if (capturedTokens.length > 0) {
                    console.log(`[AUTORITATIVO FASE 3] ⚔️ Captura/Expulsión detectada para ${capturedTokens.length} ficha(s) enemiga(s) (Expulsión salida: ${isExpulsion}, Bonus pasos: +${bonusSteps}). Emitiendo órdenes a clientes...`);
                    room.tokens = updatedTokens;
                    capturedToEmit = capturedTokens;

                    if (bonusSteps > 0) {
                        if (!room.pendingBonusMap) room.pendingBonusMap = {};
                        room.pendingBonusMap[playerId] = (room.pendingBonusMap[playerId] || 0) + bonusSteps;
                        console.log(`[AUTORITATIVO QA v8.2.7] 🎁 Bonificación de +${bonusSteps} pasos registrada en backend para Jugador ${playerId}. Total acumulado: ${room.pendingBonusMap[playerId]}`);
                    }
                }
            }
        }

        // 1. Emitir movimiento original
        io.in(roomId).emit('event_token_moved', {
            playerId,
            tokenId,
            newPathIndex,
            isBotMove
        });

        // 2. Emitir capturas/expulsiones autoritativas para las fichas enemigas enviadas a casa
        if (capturedToEmit.length > 0 && room) {
            capturedToEmit.forEach(cToken => {
                const enemyPlayer = room.players[cToken.playerId];
                const enemyNetworkId = enemyPlayer ? enemyPlayer.playerId : String(cToken.playerId);
                
                io.in(roomId).emit('event_token_moved', {
                    playerId: enemyNetworkId,
                    tokenId: cToken.id,
                    newPathIndex: -1,
                    isBotMove: false
                });
                console.log(`[AUTORITATIVO FASE 3] 💥 ORDEN MANDATORIA EMITIDA: Ficha ${cToken.id} del Jugador ${enemyNetworkId} expulsada a la base (step = -1).`);
            });
        }
    });

    socket.on('intent_end_turn', (payload) => {
        const { roomId, nextPlayerId, nextTurnId, explicitNetworkId } = payload;
        
        const room = rooms[roomId];

        let activePlayerId = null;
        if (room && room.players && room.currentTurnSlot !== undefined) {
            const activePlayer = room.players[room.currentTurnSlot];
            activePlayerId = activePlayer ? activePlayer.playerId : null;
        }

        // V24.0 / QA v8.2.7: Retención autoritativa de turno por bonificación de captura pendiente
        if (activePlayerId && room.pendingBonusMap && room.pendingBonusMap[activePlayerId] > 0) {
            const bonusToAward = room.pendingBonusMap[activePlayerId];
            console.log(`[AUTORITATIVO QA v8.2.7] 🛑 VETO DE FIN DE TURNO: Jugador ${activePlayerId} (Slot ${room.currentTurnSlot}) intentó pasar el turno, pero tiene +${bonusToAward} pasos de captura pendientes. Reemitiendo evento de dados...`);

            io.in(roomId).emit('event_dice_result', {
                playerId: activePlayerId,
                vals: [bonusToAward, 0],
                isBonusDice: true
            });
            return;
        }

        if (activePlayerId && room.consecutiveDoublesMap) {
            room.consecutiveDoublesMap[activePlayerId] = 0;
        }

        let targetSlot = 0;
        let nextNetworkId = null;

        if (nextPlayerId !== undefined && typeof nextPlayerId === 'number' && nextPlayerId >= 0 && nextPlayerId <= 5) {
            targetSlot = nextPlayerId;
            nextNetworkId = room.players[targetSlot] ? room.players[targetSlot].playerId : String(targetSlot);
        } else if (explicitNetworkId) {
            nextNetworkId = explicitNetworkId;
            if (room && room.players) {
                targetSlot = room.players.findIndex(p => p.playerId === explicitNetworkId);
                if (targetSlot === -1) targetSlot = 0;
            }
        } else {
            const colorIdToSlotIndex = {
                0: 0, 2: 1, 1: 2, 3: 3, 4: 4, 5: 5
            };

            const parsedColorId = parseInt(nextPlayerId !== undefined ? nextPlayerId : nextTurnId, 10);
            targetSlot = colorIdToSlotIndex[parsedColorId];
            
            if (targetSlot === undefined) targetSlot = 0;

            nextNetworkId = String(parsedColorId); 
            if (room && room.players && room.players[targetSlot]) {
                nextNetworkId = room.players[targetSlot].playerId;
            }
        }

        if (room) {
            room.currentTurnSlot = targetSlot;
        }

        io.in(roomId).emit('event_turn_started', {
            playerId: nextNetworkId,
            activePlayerId: nextNetworkId,
            turnDurationSeconds: 15
        });
    });

    socket.on('disconnect', () => {
        console.log(`[WS] Socket desconectado: ${socket.id}`);
        for (const [roomId, room] of Object.entries(rooms)) {
            const player = room.players.find(p => p.socketId === socket.id);
            if (player) {
                player.isConnected = false;
                console.log(`[STATE] Jugador ${player.playerId} marcado como desconectado en sala ${roomId}`);
                
                io.in(roomId).emit('room_updated', {
                    id: roomId,
                    players: room.players,
                    targetPlayers: room.targetPlayers
                });
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`[SERVER] Sweety Ludo Backend v8.3.3 escuchando en puerto ${PORT}`);
});
