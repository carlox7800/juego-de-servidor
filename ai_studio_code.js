// === Sweety Ludo Server V23.0 Base + Fases 6 y 7 (Reglas Autoritativas v8.0.5) ===
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

// === REGISTRO Y REGLAMENTO AUTORITATIVO EN BACKEND (FASE 1 - 7: MOTOR V8.0.5) ===

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
const STAR_CELLS_SQUARE = [1, 8, 14, 21, 27, 34, 40, 47]; // Casillas Seguras (4 Salidas: 1,14,27,40 + 4 Estrellas: 8,21,34,47)

function getTrackSteps(isHex) { return isHex ? 77 : 51; }
function getGoalStep(isHex) { return isHex ? 82 : 57; }
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
    if (step >= 1 && step <= trackSteps) {
      return (getStartOffset(color, false) + step - 1) % perimeter;
    }
    if (step > trackSteps && step <= 56) return `H${step - trackSteps}`;
    return 'GOAL';
  }
}

/**
 * FASE 6 & 7: Validador Físico de Trayecto y Barreras
 * (R1: Dado 5 de salida, R2: Bloqueo por barrera, R4: Overshoot meta)
 */
function isPathBlockedAuthoritative(tokens, movingPlayerIdx, movingTokenId, oldStep, newStep, totalPlayers) {
  const isHex = totalPlayers > 4;
  const currentColorsOrder = isHex ? HEX_COLORS_ORDER : SQUARE_COLORS_ORDER;
  const token = tokens.find(t => t.playerId === movingPlayerIdx && t.id === movingTokenId);
  if (!token) return true;

  const color = currentColorsOrder[movingPlayerIdx] || 'yellow';
  const goalStep = getGoalStep(isHex);

  // R4: Límite de Meta (Overshoot check)
  if (newStep > goalStep) {
    console.log(`[AUTORITATIVO FASE 6] 🚫 Movimiento rechazado por rebote/overshoot (Meta: ${goalStep}, Intento: ${newStep}).`);
    return true;
  }

  // R1: Salida de la Base (paso <= 0 a paso 1)
  if (oldStep <= 0) {
    if (newStep !== 1) return true;
    const perimeter = isHex ? 78 : 52;
    const startPIndex = (getStartOffset(color, isHex) + 1 - 1) % perimeter;
    
    // Contar fichas en la casilla de salida
    const cellTokens = tokens.filter(t => {
      if (t.step < 1 || t.step > (isHex ? 76 : 51)) return false;
      const tColor = currentColorsOrder[t.playerId];
      const tPIndex = (getStartOffset(tColor, isHex) + t.step - 1) % perimeter;
      return tPIndex === startPIndex;
    });

    const myTokens = cellTokens.filter(t => t.playerId === movingPlayerIdx);
    const enemyTokens = cellTokens.filter(t => t.playerId !== movingPlayerIdx);

    // Si hay 2+ fichas en salida y no es un caso 1v1 de expulsión de salida, está bloqueada
    if (cellTokens.length >= 2) {
      const isExpellable = (myTokens.length === 1 && enemyTokens.length === 1);
      if (!isExpellable) {
        console.log(`[AUTORITATIVO FASE 7] 🚫 Casilla de salida bloqueada por barrera de ${cellTokens.length} fichas.`);
        return true;
      }
    }
    return false;
  }

  // R2: Verificación de Barreras en Trayecto Intermedio
  const perimeterLimit = isHex ? 76 : 51;
  const perimeter = isHex ? 78 : 52;
  const stepsToCheck = Math.min(newStep, perimeterLimit);
  
  for (let s = oldStep + 1; s <= stepsToCheck; s++) {
    const pIndex = (getStartOffset(color, isHex) + s - 1) % perimeter;
    let cellTokensCount = 0;
    tokens.forEach(t => {
      if (t.step >= 1 && t.step <= perimeterLimit) {
        const tColor = currentColorsOrder[t.playerId];
        const tPIndex = (getStartOffset(tColor, isHex) + t.step - 1) % perimeter;
        if (tPIndex === pIndex) cellTokensCount++;
      }
    });
    if (cellTokensCount >= 2) {
      console.log(`[AUTORITATIVO FASE 7] 🚫 Barrera física detectada en paso ${s} (Índice casilla ${pIndex}). Movimiento bloqueado.`);
      return true;
    }
  }

  return false;
}

/**
 * Mando de Evaluación Autoritativa de Reglas (FASE 3 & FASE 7)
 * Aplica: Expulsión de salida obligatoria, Capturas en casillas normales y Bonificaciones (+10/+20/+25).
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

  // 1. Regla de Meta (R5)
  if (targetStep === goalStep) {
    bonusSteps += isHex ? 15 : 10;
  }

  // 2. Evaluador de Casilla Final (Salida vs Perímetro No Seguro - R6 & R7)
  if (isHex) {
    const targetCellIndex = getCellIndexForToken(color, targetStep, true);
    if (typeof targetCellIndex === 'number') {
      if (targetStep === 1) {
        const cellTokens = tokens.filter(t => t.step > 0 && t.step <= 76 && getCellIndexForToken(currentColorsOrder[t.playerId], t.step, true) === targetCellIndex);
        const myTokens = cellTokens.filter(t => t.playerId === movingPlayerIdx);
        const enemyTokens = cellTokens.filter(t => t.playerId !== movingPlayerIdx);

        if (enemyTokens.length > 0 && (myTokens.length >= 1 || cellTokens.length >= 2)) {
          isExpulsion = true;
          capturedTokens = enemyTokens;
        }
      } else if (!STAR_CELLS_HEX.includes(targetCellIndex)) {
        const enemyTokens = tokens.filter(t => t.playerId !== movingPlayerIdx && t.step > 0 && t.step <= 76 && getCellIndexForToken(currentColorsOrder[t.playerId], t.step, true) === targetCellIndex);
        if (enemyTokens.length === 1) {
          capturedTokens = enemyTokens;
          bonusSteps += 25;
        }
      }
    }
  } else {
    // Tablero Estándar (Cuadrado 2, 3, 4 jugadores)
    if (targetStep >= 1 && targetStep <= trackSteps) {
      const pIndex = (getStartOffset(color, false) + targetStep - 1) % perimeter;
      const isSafeCell = STAR_CELLS_SQUARE.includes(pIndex);

      if (targetStep === 1) {
        // Expulsión por Salida Obligatoria
        const cellTokens = tokens.filter(t => {
          if (t.step < 1 || t.step > trackSteps) return false;
          const oppColor = currentColorsOrder[t.playerId];
          const oppPIndex = (getStartOffset(oppColor, false) + t.step - 1) % perimeter;
          return oppPIndex === pIndex;
        });
        const enemyTokens = cellTokens.filter(t => t.playerId !== movingPlayerIdx);
        const myTokens = cellTokens.filter(t => t.playerId === movingPlayerIdx);
        if (enemyTokens.length === 1 && myTokens.length >= 1) {
          isExpulsion = true;
          capturedTokens = enemyTokens;
        }
      } else if (!isSafeCell) {
        // Captura Normal en casilla NO segura
        const enemyTokens = tokens.filter(t => {
          if (t.playerId === movingPlayerIdx || t.step < 1 || t.step > trackSteps) return false;
          const oppColor = currentColorsOrder[t.playerId];
          const oppPIndex = (getStartOffset(oppColor, false) + t.step - 1) % perimeter;
          return oppPIndex === pIndex;
        });
        if (enemyTokens.length === 1) {
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
    res.send("Sweety Ludo V21.5 Motor AAA Autoritativo is running.");
});

/**
 * Inicialización Autoritativa de Fichas y Contadores por Sala (Fase 2)
 */
function initializeRoomStateAuthoritative(room) {
    const totalPlayers = room.targetPlayers || room.players.length || 4;
    const isHex = totalPlayers > 4;
    const tokensPerPlayer = isHex ? 3 : 4;
    
    room.tokens = [];
    room.consecutiveDoublesMap = {};
    room.lastMovedTokenMap = {};
    room.lastDiceRoll = {};
    room.extraTurnPending = {};
    room.barrierLifetimes = {};

    room.players.forEach((player, pIdx) => {
        room.consecutiveDoublesMap[player.playerId] = 0;
        room.lastMovedTokenMap[player.playerId] = null;
        room.lastDiceRoll[player.playerId] = null;
        room.extraTurnPending[player.playerId] = false;

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
            
            initializeRoomStateAuthoritative(room);

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
                    activePlayerId: firstPlayer
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
        let isThreeDoublesPenalty = false;

        if (room) {
            room.lastDiceRoll = room.lastDiceRoll || {};
            room.lastDiceRoll[playerId] = [d1, d2];
            room.consecutiveDoublesMap = room.consecutiveDoublesMap || {};
            room.extraTurnPending = room.extraTurnPending || {};

            if (d1 === d2) {
                room.consecutiveDoublesMap[playerId] = (room.consecutiveDoublesMap[playerId] || 0) + 1;
                console.log(`[AUTORITATIVO QA] 🎲 Jugador ${playerId} en Sala ${roomId} obtuvo DOBLES [${d1}, ${d2}]. Consecutivos: ${room.consecutiveDoublesMap[playerId]}`);
                
                if (room.consecutiveDoublesMap[playerId] >= 3) {
                    isThreeDoublesPenalty = true;
                    room.consecutiveDoublesMap[playerId] = 0;
                    room.extraTurnPending[playerId] = false;
                    console.log(`[AUTORITATIVO FASE 3] 🚫 ¡3er DOBLE ALCANZADO! Ejecutando castigo autoritativo para Jugador ${playerId}.`);
                    
                    const lastTokenId = room.lastMovedTokenMap ? room.lastMovedTokenMap[playerId] : null;
                    if (lastTokenId !== null && lastTokenId !== undefined && room.tokens) {
                        const pIdx = room.players.findIndex(p => p.playerId === playerId);
                        const targetPlayerIdx = pIdx !== -1 ? pIdx : 0;
                        
                        const tokenToPenalize = room.tokens.find(t => (t.networkPlayerId === playerId || t.playerId === targetPlayerIdx) && t.id === lastTokenId && t.step > 0);
                        if (tokenToPenalize) {
                            tokenToPenalize.step = -1;
                            console.log(`[AUTORITATIVO FASE 3] 🏠 Ficha ${lastTokenId} del Jugador ${playerId} castigada y enviada a la base (step = -1).`);
                            
                            io.in(roomId).emit('event_token_moved', {
                                playerId: playerId,
                                tokenId: lastTokenId,
                                newPathIndex: -1,
                                isBotMove: false
                            });
                        }
                    }
                } else {
                    // Turno Extra por Dobles (R9)
                    room.extraTurnPending[playerId] = true;
                    console.log(`[AUTORITATIVO FASE 6] 🎲 Jugador ${playerId} tiene un TURNO EXTRA concedido por dobles.`);
                }
            } else {
                room.consecutiveDoublesMap[playerId] = 0;
                room.extraTurnPending[playerId] = false;
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
        let capturedToEmit = [];
        let bonusStepsEarned = 0;

        if (room && room.tokens) {
            const pIdx = room.players.findIndex(p => p.playerId === playerId);
            const targetPlayerIdx = pIdx !== -1 ? pIdx : 0;
            const totalPlayers = room.targetPlayers || room.players.length;
            const isHex = totalPlayers > 4;

            const token = room.tokens.find(t => (t.networkPlayerId === playerId || t.playerId === targetPlayerIdx) && t.id === tokenId);
            if (token) {
                const oldStep = token.step;

                // --- FASE 6 (R1): Validación de Salida de Base (Dado 5 o Suma 5) ---
                if (oldStep <= 0 && newPathIndex === 1) {
                    const rolls = room.lastDiceRoll ? room.lastDiceRoll[playerId] : null;
                    const hasFive = rolls && (rolls[0] === 5 || rolls[1] === 5 || (rolls[0] + rolls[1] === 5));
                    if (!hasFive && !isBotMove) {
                        console.log(`[AUTORITATIVO RECHAZADO] 🚫 Jugador ${playerId} intentó salir de base sin dado 5 (Dados actuales: ${rolls}).`);
                        return;
                    }
                }

                // --- FASE 6 (R4) & FASE 7 (R2): Validación de Barreras Físicas y Límite de Meta ---
                const isBlocked = isPathBlockedAuthoritative(room.tokens, targetPlayerIdx, tokenId, oldStep, newPathIndex, totalPlayers);
                if (isBlocked && !isBotMove) {
                    console.log(`[AUTORITATIVO RECHAZADO] 🚫 Movimiento de Ficha ${tokenId} del Jugador ${playerId} bloq. por barrera u overshoot (${oldStep} -> ${newPathIndex}).`);
                    return;
                }

                token.step = newPathIndex;
                room.lastMovedTokenMap[playerId] = tokenId;

                const colorName = (isHex ? HEX_COLORS_ORDER : SQUARE_COLORS_ORDER)[targetPlayerIdx] || 'yellow';
                const cellDesc = getCellIndexForToken(colorName, newPathIndex, isHex);

                console.log(`[AUTORITATIVO QA] ♟️ Sala ${roomId} | Jugador ${playerId} (Slot ${targetPlayerIdx} - ${colorName}) movió Ficha ${tokenId} de paso ${oldStep} -> ${newPathIndex} (Casilla: ${cellDesc}).`);

                // Evaluación autoritativa de capturas y expulsiones (Fase 3, 6, 7)
                const { updatedTokens, capturedTokens, bonusSteps, isExpulsion } = evaluateMoveRulesAuthoritative(
                    room.tokens, tokenId, targetPlayerIdx, newPathIndex, totalPlayers
                );

                if (capturedTokens.length > 0 || bonusSteps > 0) {
                    console.log(`[AUTORITATIVO FASE 7] ⚔️ Captura/Expulsión/Bono en sala ${roomId} (Expulsión: ${isExpulsion}, Bonus: +${bonusSteps}).`);
                    room.tokens = updatedTokens;
                    capturedToEmit = capturedTokens;
                    bonusStepsEarned = bonusSteps;
                }
            }
        }

        // 1. Emitir movimiento original con bonus steps informados
        io.in(roomId).emit('event_token_moved', {
            playerId,
            tokenId,
            newPathIndex,
            isBotMove,
            bonusSteps: bonusStepsEarned
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
                console.log(`[AUTORITATIVO FASE 7] 💥 ORDEN MANDATORIA EMITIDA: Ficha ${cToken.id} del Jugador ${enemyNetworkId} expulsada a la base (step = -1).`);
            });
        }
    });

    socket.on('intent_end_turn', (payload) => {
        const { roomId, nextPlayerId, nextTurnId, explicitNetworkId } = payload;
        
        const room = rooms[roomId];
        let nextNetworkId;
        let targetSlot = 0;

        if (!room) return;

        // --- FASE 6 (R9): Concesión de Turno Extra por Dobles ---
        const currentSlotPlayer = room.players[room.currentTurnSlot || 0];
        const currentNetworkId = currentSlotPlayer ? currentSlotPlayer.playerId : null;

        if (currentNetworkId && room.extraTurnPending && room.extraTurnPending[currentNetworkId]) {
            room.extraTurnPending[currentNetworkId] = false;
            console.log(`[AUTORITATIVO FASE 6] 🔁 TURNO EXTRA CONCEDIDO para Jugador ${currentNetworkId}. El turno se mantiene.`);
            
            io.in(roomId).emit('event_turn_started', {
                playerId: currentNetworkId,
                activePlayerId: currentNetworkId,
                isExtraTurn: true
            });
            return;
        }

        if (explicitNetworkId) {
            nextNetworkId = explicitNetworkId;
            if (room && room.players) {
                targetSlot = room.players.findIndex(p => p.playerId === explicitNetworkId);
                if (targetSlot === -1) targetSlot = 0;
            }
        } else {
            const colorIdToSlotIndex = { 0: 0, 2: 1, 1: 2, 3: 3, 4: 4, 5: 5 };
            const parsedColorId = parseInt(nextPlayerId !== undefined ? nextPlayerId : nextTurnId, 10);
            targetSlot = colorIdToSlotIndex[parsedColorId];
            if (targetSlot === undefined) targetSlot = 0;
            nextNetworkId = String(parsedColorId); 
            if (room && room.players && room.players[targetSlot]) {
                nextNetworkId = room.players[targetSlot].playerId;
            }
        }

        // --- FASE 7 (R3): Trackeo de Barreras (Barrier Lifetimes) ---
        if (room.tokens) {
            room.barrierLifetimes = room.barrierLifetimes || {};
            const totalPlayers = room.targetPlayers || room.players.length;
            const isHex = totalPlayers > 4;
            const currentColorsOrder = isHex ? HEX_COLORS_ORDER : SQUARE_COLORS_ORDER;
            const perimeter = isHex ? 78 : 52;
            const perimeterLimit = isHex ? 76 : 51;

            room.tokens.forEach(t => {
                const globalId = `${t.playerId}_${t.id}`;
                if (t.step >= 1 && t.step <= perimeterLimit) {
                    const pIndex = (getStartOffset(currentColorsOrder[t.playerId], isHex) + t.step - 1) % perimeter;
                    const cellCount = room.tokens.filter(other => {
                        if (other.step < 1 || other.step > perimeterLimit) return false;
                        const oColor = currentColorsOrder[other.playerId];
                        const oPIndex = (getStartOffset(oColor, isHex) + other.step - 1) % perimeter;
                        return oPIndex === pIndex;
                    }).length;

                    if (cellCount >= 2) {
                        if (t.playerId === room.currentTurnSlot) {
                            room.barrierLifetimes[globalId] = (room.barrierLifetimes[globalId] || 0) + 1;
                        }
                    } else {
                        room.barrierLifetimes[globalId] = 0;
                    }
                } else {
                    room.barrierLifetimes[globalId] = 0;
                }
            });
        }

        // V21.5 Autoritativo: Decrementar gracia al jugador offline
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

        // Actualizar el turno actual en la sala
        room.currentTurnSlot = targetSlot;

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
    console.log(`[SERVER] Sweety Ludo WebSocket Server V23.0 Base + Fases 6 y 7 Autoritativas (v8.0.5) en puerto ${PORT}`);
});
