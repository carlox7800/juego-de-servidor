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
  if (step <= 0) return 'BASE';
  if (isHex) {
    const startCell = HEX_COLOR_INFO[color] ? HEX_COLOR_INFO[color].startCell : 8;
    if (step >= 1 && step <= 77) return (startCell + (step - 1)) % 78;
    if (step >= 78 && step <= 82) return `H${step - 77}`;
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

  // 2. Evaluador de Casilla Final (Salida vs Perímetro vs Pasillo)
  if (isHex) {
    const targetCellIndex = getCellIndexForToken(color, targetStep, true);
    if (typeof targetCellIndex === 'number') {
      if (targetStep === 1) {
        // Expulsión por Salida Obligatoria (Ficha que sale a la casilla donde hay 1 propia y 1 enemiga)
        const cellTokens = tokens.filter(t => t.step > 0 && t.step <= 76 && getCellIndexForToken(currentColorsOrder[t.playerId], t.step, true) === targetCellIndex);
        const myTokens = cellTokens.filter(t => t.playerId === movingPlayerIdx);
        const enemyTokens = cellTokens.filter(t => t.playerId !== movingPlayerIdx);

        if (enemyTokens.length > 0 && (myTokens.length >= 1 || cellTokens.length >= 2)) {
          isExpulsion = true;
          capturedTokens = enemyTokens;
          bonusSteps += 0; // Expulsión directa de salida no otorga bonus de captura
        }
      } else if (!STAR_CELLS_HEX.includes(targetCellIndex)) {
        // Captura Normal
        const enemyTokens = tokens.filter(t => t.playerId !== movingPlayerIdx && t.step > 0 && t.step <= 76 && getCellIndexForToken(currentColorsOrder[t.playerId], t.step, true) === targetCellIndex);
        if (enemyTokens.length > 0) {
          capturedTokens = enemyTokens;
          bonusSteps += 25;
        }
      }
    }
  } else {
    // Tablero Estándar (Cuadrado 2, 3, 4 jugadores)
    if (targetStep >= 1 && targetStep < trackSteps) {
      const pIndex = (getStartOffset(color, false) + targetStep) % perimeter;
      const isStartCell = [1, 14, 27, 40, 53, 66].includes(pIndex);
      const isGoldStar = STAR_CELLS_SQUARE.includes(pIndex);

      if (targetStep === 1) {
        // Expulsión por Salida Obligatoria
        const cellTokens = tokens.filter(t => {
          if (t.step < 1 || t.step >= trackSteps) return false;
          const oppColor = currentColorsOrder[t.playerId];
          const oppPIndex = (getStartOffset(oppColor, false) + t.step) % perimeter;
          return oppPIndex === pIndex;
        });
        const enemyTokens = cellTokens.filter(t => t.playerId !== movingPlayerIdx);
        if (enemyTokens.length > 0) {
          isExpulsion = true;
          capturedTokens = enemyTokens;
          bonusSteps += 0;
        }
      } else if (!isStartCell && !isGoldStar) {
        // Captura Normal
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
        const { playerId, playerName, targetPlayers, mode } = payload;
        
        let foundRoomId = null;
        for (const [roomId, room] of Object.entries(rooms)) {
            // Aislamiento: Validar que el modo de la sala sea exactamente el mismo modo que solicita el jugador
            if (!room.isPrivate && room.targetPlayers === targetPlayers && room.players.length < targetPlayers && room.mode === mode) {
                foundRoomId = roomId;
                break;
            }
        }

        if (!foundRoomId) {
            foundRoomId = generateUniqueRoomId();
            rooms[foundRoomId] = {
                id: foundRoomId,
                isPrivate: false,
                mode: mode || 'online_training', // Guardar claramente qué tipo de modo es
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
        const { playerId, playerName, targetPlayers, mode } = payload;
        const roomId = generateUniqueRoomId();
        rooms[roomId] = {
            id: roomId,
            isPrivate: true,
            mode: mode || 'online_training', // Guardar claramente qué tipo de modo es
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
                isBot: false,
                slotIndex: room.players.length
            });
        } else {
            // V23.0 Base Fix para Modo Competitivo: Manejar la reconexión igual que en join_room
            const wasOffline = !existingPlayer.isConnected || existingPlayer.isBot;
            existingPlayer.socketId = socket.id;
            existingPlayer.isConnected = true;
            existingPlayer.isBot = false;
            delete existingPlayer._graceTurnsLeft;
            console.log(`[RECONEXIÓN] Jugador ${playerId} volvió a sala privada ${cleanRoomCode} vía JOIN_PRIVATE`);
            
            // Emitir la orden de resincronización al Host SÓLO si el jugador realmente estaba desconectado (Evita fantasmas por websocket upgrades)
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
            
            // Inicializar memoria de fichas autoritativas (Fase 2)
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

    socket.on('intent_roll_dice', (payload) => {
        const { roomId, playerId } = payload;
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        
        const room = rooms[roomId];

        if (room && room.consecutiveDoublesMap) {
            if (d1 === d2) {
                room.consecutiveDoublesMap[playerId] = (room.consecutiveDoublesMap[playerId] || 0) + 1;
                console.log(`[AUTORITATIVO QA] 🎲 Jugador ${playerId} en Sala ${roomId} obtuvo DOBLES [${d1}, ${d2}]. Consecutivos: ${room.consecutiveDoublesMap[playerId]}`);
                
                if (room.consecutiveDoublesMap[playerId] >= 3) {
                    room.consecutiveDoublesMap[playerId] = 0;
                    console.log(`[AUTORITATIVO FASE 3] 🚫 ¡3er DOBLE ALCANZADO! Programando castigo autoritativo con pausa dramática para Jugador ${playerId}.`);
                    
                    const lastTokenId = room.lastMovedTokenMap ? room.lastMovedTokenMap[playerId] : null;
                    if (lastTokenId !== null && lastTokenId !== undefined && room.tokens) {
                        const pIdx = room.players.findIndex(p => p.playerId === playerId);
                        const targetPlayerIdx = pIdx !== -1 ? pIdx : 0;
                        
                        const tokenToPenalize = room.tokens.find(t => (t.networkPlayerId === playerId || t.playerId === targetPlayerIdx) && t.id === lastTokenId && t.step > 0);
                        if (tokenToPenalize) {
                            tokenToPenalize.step = -1;
                            
                            if (!room.forceNextTurnAfterPenaltyMap) room.forceNextTurnAfterPenaltyMap = {};
                            room.forceNextTurnAfterPenaltyMap[playerId] = true;

                            // V8.3.0: Retrasar el envío de la penalización visual para permitir que la animación de dados (500ms) finalice en el cliente
                            setTimeout(() => {
                                console.log(`[AUTORITATIVO FASE 3] 🏠 Ficha ${lastTokenId} del Jugador ${playerId} castigada y enviada a la base (step = -1). Emitiendo event_token_moved.`);
                                io.in(roomId).emit('event_token_moved', {
                                    playerId: playerId,
                                    tokenId: lastTokenId,
                                    newPathIndex: -1,
                                    isBotMove: false,
                                    isPenalty: true
                                });
                            }, 1200);
                        }
                    }
                }
            } else {
                room.consecutiveDoublesMap[playerId] = 0;
                console.log(`[AUTORITATIVO QA] 🎲 Jugador ${playerId} en Sala ${roomId} obtuvo [${d1}, ${d2}]. Contador de dobles reiniciado a 0.`);
            }
        }


        io.in(roomId).emit('event_dice_result', {
            playerId: playerId,
            diceRoll1: d1,
            diceRoll2: d2,
            diceValues: [d1, d2]
        });
    });

    socket.on('intent_move_token', (payload) => {
        const { roomId, playerId, tokenId, newPathIndex, isBotMove } = payload;

        const room = rooms[roomId];

        // V8.3.0: Veto de movimientos si el jugador acaba de sufrir penalización por 3 dobles
        if (room && room.forceNextTurnAfterPenaltyMap && room.forceNextTurnAfterPenaltyMap[playerId]) {
            console.log(`[AUTORITATIVO v8.3.0] 🚫 Veto de movimiento: Jugador ${playerId} intentó mover durante la secuencia de penalización por 3 dobles.`);
            return;
        }

        let capturedToEmit = [];

        if (room && room.tokens) {
            const pIdx = room.players.findIndex(p => p.playerId === playerId);
            const targetPlayerIdx = pIdx !== -1 ? pIdx : 0;
            const isHex = (room.targetPlayers || room.players.length) > 4;

            const token = room.tokens.find(t => (t.networkPlayerId === playerId || t.playerId === targetPlayerIdx) && t.id === tokenId);
            if (token) {
                const oldStep = token.step;
                token.step = newPathIndex;
                room.lastMovedTokenMap[playerId] = tokenId;

                // V8.2.9: Deducción inteligente de bonos combinados
                if (typeof newPathIndex === 'number' && typeof oldStep === 'number') {
                    const distanceMoved = newPathIndex - oldStep;
                    if (distanceMoved > 0 && room.pendingBonusMap && room.pendingBonusMap[playerId] > 0) {
                        let bonusToDeduct = 0;
                        
                        if (distanceMoved >= room.pendingBonusMap[playerId] && distanceMoved > 12) {
                            // El movimiento es mayor o igual al bono pendiente y excede un tiro de dados doble (6+6=12).
                            // Esto significa inequívocamente que consumió todo el bono pendiente (ej. tenía 20, movió 25).
                            bonusToDeduct = room.pendingBonusMap[playerId];
                        } else if (distanceMoved > 12) {
                            // Casos donde el bono acumulado es mayor al que usó (ej. capturó 2 fichas y tiene +40, pero consumió 25)
                            if (distanceMoved >= 25 && room.pendingBonusMap[playerId] >= 25 && isHex) bonusToDeduct = 25;
                            else if (distanceMoved >= 20 && room.pendingBonusMap[playerId] >= 20) bonusToDeduct = 20;
                            else if (distanceMoved >= 15 && room.pendingBonusMap[playerId] >= 15 && isHex) bonusToDeduct = 15;
                            else if (distanceMoved >= 10 && room.pendingBonusMap[playerId] >= 10) bonusToDeduct = 10;
                        } else if (distanceMoved === 10 || distanceMoved === 15 || distanceMoved === 20 || distanceMoved === 25) {
                            if (room.pendingBonusMap[playerId] >= distanceMoved) bonusToDeduct = distanceMoved;
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

                // Evaluación autoritativa en segundo plano (Fase 3)
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
            room.pendingBonusMap[activePlayerId] = 0; // Consumir y limpiar el bono completamente

            console.log(`[AUTORITATIVO QA v8.2.7] 🛑 VETO DE FIN DE TURNO: Jugador ${activePlayerId} (Slot ${room.currentTurnSlot}) intentó pasar el turno, pero tiene +${bonusToAward} pasos de captura pendientes. Reemitiendo evento de dados...`);

            io.in(roomId).emit('event_dice_result', {
                playerId: activePlayerId,
                diceRoll1: 0,
                diceRoll2: 0,
                diceValues: [bonusToAward]
            });

            return; // ABORTAR EL CAMBIO DE TURNO: No se actualiza currentTurnSlot ni se emite event_turn_started
        }

        let nextNetworkId = explicitNetworkId;
        let targetSlot = 0;

        // V8.3.0: Override for 3rd double penalty turn end
        if (activePlayerId && room.forceNextTurnAfterPenaltyMap && room.forceNextTurnAfterPenaltyMap[activePlayerId]) {
            room.forceNextTurnAfterPenaltyMap[activePlayerId] = false;
            console.log(`[AUTORITATIVO v8.3.0] 🚫 Veto de Turno Extra: Jugador ${activePlayerId} intentó retener turno tras 3er doble. Forzando avance.`);

            const isHex = (room.targetPlayers || room.players.length) > 4;
            const goalStep = getGoalStep(isHex);
            const totalSlots = room.players.length;

            let currentIdx = room.currentTurnSlot !== undefined ? room.currentTurnSlot : 0;
            let nextIdx = (currentIdx + 1) % totalSlots;
            let loops = 0;

            while (loops < totalSlots) {
                const playerTokens = room.tokens ? room.tokens.filter(t => t.playerId === nextIdx) : [];
                const isFinished = playerTokens.length > 0 && playerTokens.every(t => t.step === goalStep);
                if (!isFinished) break;
                nextIdx = (nextIdx + 1) % totalSlots;
                loops++;
            }

            targetSlot = nextIdx;
            nextNetworkId = room.players[targetSlot] ? room.players[targetSlot].playerId : String(targetSlot);
        } else if (explicitNetworkId) {
            // V24.0 (NUEVO LUDO WEB): By-pass directo por UUID. 
            // No hay traducciones cruzadas ni diccionarios rígidos.
            nextNetworkId = explicitNetworkId;
            if (room && room.players) {
                targetSlot = room.players.findIndex(p => p.playerId === explicitNetworkId);
                if (targetSlot === -1) targetSlot = 0;
            }
        } else {
            // V23.0 (SWEETY LUDO ANDROID LEGACY): Se mantiene intacto.
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

        // Actualizar el turno actual en la sala
        if (room) {
            room.currentTurnSlot = targetSlot;
        }

        io.in(roomId).emit('event_turn_started', {
            playerId: nextNetworkId,
            activePlayerId: nextNetworkId,
            turnDurationSeconds: 15
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
    console.log(`[SERVER] Sweety Ludo WebSocket Server V24.0 (v8.0.6 - Freeze Fix: isRollingRef + hasRolledRef + isProcessingTimeoutRef) en puerto ${PORT}`);
});
