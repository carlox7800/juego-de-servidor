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
const STAR_CELLS_SQUARE = [1, 8, 14, 21, 27, 34, 40, 47];

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

// --- CHEQUEO DE BARRERAS AUTORITATIVO ---
function hasBarrierAtSquare(perimeterIndex, tokens) {
  if (perimeterIndex < 0 || perimeterIndex >= 52) return false;
  let count = 0;
  tokens.forEach(tk => {
    if (tk.step >= 0 && tk.step < 51) {
      const color = SQUARE_COLORS_ORDER[tk.playerId] || 'yellow';
      const pIdx = (getStartOffset(color, false) + tk.step) % 52;
      if (pIdx === perimeterIndex) count++;
    }
  });
  return count >= 2;
}

function hasBarrierAtHex(perimeterIndex, tokens) {
  if (perimeterIndex < 0 || perimeterIndex >= 78) return false;
  let count = 0;
  tokens.forEach(tk => {
    if (tk.step > 0 && tk.step <= 77) {
      const color = HEX_COLORS_ORDER[tk.playerId] || 'purple';
      const pIdx = getCellIndexForToken(color, tk.step, true);
      if (typeof pIdx === 'number' && pIdx === perimeterIndex) count++;
    }
  });
  return count >= 2;
}

// --- VALIDACIÓN DE MOVIMIENTO LEGAL AUTORITATIVO ---
function checkMoveValidAuthoritative(token, moveVal, tokens, totalPlayers) {
  const isHex = totalPlayers > 4;
  const colorsOrder = isHex ? HEX_COLORS_ORDER : SQUARE_COLORS_ORDER;
  const color = colorsOrder[token.playerId] || (isHex ? 'purple' : 'yellow');
  const goalStep = getGoalStep(isHex);
  const trackSteps = getTrackSteps(isHex);
  const perimeter = getTotalPerimeter(isHex);

  if (token.step === -1) {
    if (moveVal === 5) {
      if (isHex) {
        const startIdx = getCellIndexForToken(color, 1, true);
        if (typeof startIdx === 'number') {
          let myCount = 0;
          let enemyCount = 0;
          tokens.forEach(tk => {
            const tkColor = colorsOrder[tk.playerId];
            const tkIdx = getCellIndexForToken(tkColor, tk.step, true);
            if (typeof tkIdx === 'number' && tkIdx === startIdx) {
              if (tk.playerId === token.playerId) myCount++;
              else enemyCount++;
            }
          });
          const isExpellable = myCount === 1 && enemyCount === 1;
          return !(myCount + enemyCount >= 2 && !isExpellable);
        }
        return true;
      } else {
        const startIdx = getStartOffset(color, false);
        let tokensOnStart = 0;
        tokens.forEach(tk => {
          if (tk.step >= 0 && tk.step < trackSteps) {
            const oppColor = colorsOrder[tk.playerId];
            const oppPIdx = (getStartOffset(oppColor, false) + tk.step) % perimeter;
            if (oppPIdx === startIdx) tokensOnStart++;
          }
        });
        // Si ya hay 2 fichas en la casilla de salida, no se puede salir (tope de 2 fichas por casilla)
        return tokensOnStart < 2;
      }
    }
    return false;
  } else if (token.step >= 0 && token.step < goalStep) {
    const distanceToGoal = goalStep - token.step;
    if (moveVal > distanceToGoal) return false;

    // Verificar que no haya barreras intermedias
    for (let stepOffset = 1; stepOffset < moveVal; stepOffset++) {
      const pathStep = token.step + stepOffset;
      if (isHex) {
        const pIndex = getCellIndexForToken(color, pathStep, true);
        if (typeof pIndex === 'number' && hasBarrierAtHex(pIndex, tokens)) {
          return false;
        }
      } else {
        if (pathStep < trackSteps) {
          const pIndex = (getStartOffset(color, false) + pathStep) % perimeter;
          if (hasBarrierAtSquare(pIndex, tokens)) {
            return false;
          }
        }
      }
    }

    // Verificar la casilla final de destino (máximo 2 fichas por casilla)
    const targetStep = token.step + moveVal;
    if (isHex) {
      if (targetStep <= 77) {
        const pIndex = getCellIndexForToken(color, targetStep, true);
        if (typeof pIndex === 'number') {
          let countOnTarget = 0;
          tokens.forEach(tk => {
            if (tk.step > 0 && tk.step <= 77) {
              const tkColor = colorsOrder[tk.playerId];
              const tkIdx = getCellIndexForToken(tkColor, tk.step, true);
              if (typeof tkIdx === 'number' && tkIdx === pIndex) countOnTarget++;
            }
          });
          if (countOnTarget >= 2) return false;
        }
      }
    } else {
      if (targetStep < trackSteps) {
        const pIndex = (getStartOffset(color, false) + targetStep) % perimeter;
        let countOnTarget = 0;
        tokens.forEach(tk => {
          if (tk.step >= 0 && tk.step < trackSteps) {
            const oppColor = colorsOrder[tk.playerId];
            const oppPIdx = (getStartOffset(oppColor, false) + tk.step) % perimeter;
            if (oppPIdx === pIndex) countOnTarget++;
          }
        });
        if (countOnTarget >= 2) return false;
      }
    }

    return true;
  }
  return false;
}

// --- CÁLCULO DE TODAS LAS JUGADAS POSIBLES ---
function getPlayableTokenMovesAuthoritative(tokens, playerIdx, diceMoves, totalPlayers) {
  if (!diceMoves || diceMoves.length === 0) return [];
  const playerTokens = tokens.filter(t => t.playerId === playerIdx);
  const validChoices = [];
  const isHex = totalPlayers > 4;
  const goalStep = getGoalStep(isHex);
  const baseTargetStep = isHex ? 1 : 0;

  playerTokens.forEach(token => {
    // 1. Movimientos individuales
    diceMoves.forEach(m => {
      if (token.step === -1) {
        if (m === 5 && checkMoveValidAuthoritative(token, 5, tokens, totalPlayers)) {
          validChoices.push({ token, moveVal: 5, targetStep: baseTargetStep, isSum: false });
        }
      } else if (token.step >= 0 && token.step < goalStep) {
        if (checkMoveValidAuthoritative(token, m, tokens, totalPlayers)) {
          validChoices.push({ token, moveVal: m, targetStep: token.step + m, isSum: false });
        }
      }
    });

    // 2. Movimiento combinado si hay 2 dados
    if (diceMoves.length === 2) {
      const sum = diceMoves[0] + diceMoves[1];
      if (token.step === -1) {
        if (sum === 5 && checkMoveValidAuthoritative(token, 5, tokens, totalPlayers)) {
          validChoices.push({ token, moveVal: sum, targetStep: baseTargetStep, isSum: true });
        }
      } else if (token.step >= 0 && token.step < goalStep) {
        if (checkMoveValidAuthoritative(token, sum, tokens, totalPlayers)) {
          validChoices.push({ token, moveVal: sum, targetStep: token.step + sum, isSum: true });
        }
      }
    }
  });

  return validChoices;
}

// --- SELECCIÓN INTELIGENTE DE JUGADA PARA EL BOT ---
function pickBestBotMove(validChoices, tokens, playerIdx, totalPlayers) {
  if (validChoices.length === 0) return null;
  const isHex = totalPlayers > 4;
  const goalStep = getGoalStep(isHex);

  // 1. Prioridad: Salir de base si hay un 5
  const baseExit = validChoices.find(c => c.token.step === -1);
  if (baseExit) return baseExit;

  // 2. Prioridad: Llegar a la meta
  const goalEntry = validChoices.find(c => c.targetStep === goalStep);
  if (goalEntry) return goalEntry;

  // 3. Prioridad: Capturar una ficha enemiga
  for (const choice of validChoices) {
    const { capturedTokens } = evaluateMoveRulesAuthoritative(
      tokens, choice.token.id, playerIdx, choice.targetStep, totalPlayers
    );
    if (capturedTokens.length > 0) return choice;
  }

  // 4. Prioridad: Avanzar la ficha más adelantada hacia la meta
  let furthest = validChoices[0];
  for (const choice of validChoices) {
    if (choice.targetStep > furthest.targetStep) {
      furthest = choice;
    }
  }
  return furthest;
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
        // Expulsión por Salida Obligatoria
        const cellTokens = tokens.filter(t => t.step > 0 && t.step <= 76 && getCellIndexForToken(currentColorsOrder[t.playerId], t.step, true) === targetCellIndex);
        const myTokens = cellTokens.filter(t => t.playerId === movingPlayerIdx);
        const enemyTokens = cellTokens.filter(t => t.playerId !== movingPlayerIdx);

        if (enemyTokens.length > 0 && (myTokens.length >= 1 || cellTokens.length >= 2)) {
          isExpulsion = true;
          capturedTokens = enemyTokens;
          bonusSteps += 0;
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
    if (targetStep >= 0 && targetStep < trackSteps) {
      const pIndex = (getStartOffset(color, false) + targetStep) % perimeter;
      const isGoldStar = STAR_CELLS_SQUARE.includes(pIndex);

      if (targetStep === 0) {
        // Salida a casilla propia
        const cellTokens = tokens.filter(t => {
          if (t.step < 0 || t.step >= trackSteps) return false;
          const oppColor = currentColorsOrder[t.playerId];
          const oppPIndex = (getStartOffset(oppColor, false) + t.step) % perimeter;
          return oppPIndex === pIndex;
        });
        const myTokens = cellTokens.filter(t => t.playerId === movingPlayerIdx);
        const enemyTokens = cellTokens.filter(t => t.playerId !== movingPlayerIdx);
        if (enemyTokens.length > 0 && (myTokens.length >= 1 || cellTokens.length >= 2)) {
          isExpulsion = true;
          capturedTokens = enemyTokens;
          bonusSteps += 0;
        }
      } else if (!isGoldStar) {
        // Captura Normal en cualquier casilla que no sea estrella de seguridad
        const enemyTokens = tokens.filter(t => {
          if (t.playerId === movingPlayerIdx || t.step < 0 || t.step >= trackSteps) return false;
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

function generateUniqueRoomId() {
    let roomId;
    do {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[roomId]);
    return roomId;
}

app.get('/', (req, res) => {
    res.send("Sweety Ludo v8.3.6 Motor AAA Autoritativo (100% Server Bot & Reconnection) is running.");
});

/**
 * Inicialización Autoritativa de Fichas y Contadores por Sala
 */
function initializeRoomStateAuthoritative(room) {
    const totalPlayers = room.targetPlayers || room.players.length || 4;
    const isHex = totalPlayers > 4;
    const tokensPerPlayer = isHex ? 3 : 4;
    
    room.tokens = [];
    room.consecutiveDoublesMap = {};
    room.lastMovedTokenMap = {};
    room.pendingBonusMap = {};
    room.forceNextTurnAfterPenaltyMap = {};

    const colorsOrder = isHex ? HEX_COLORS_ORDER : SQUARE_COLORS_ORDER;
    room.players.forEach((player, pIdx) => {
        room.consecutiveDoublesMap[player.playerId] = 0;
        room.lastMovedTokenMap[player.playerId] = null;
        room.pendingBonusMap[player.playerId] = 0;
        const playerColor = colorsOrder[pIdx] || 'yellow';

        for (let tId = 0; tId < tokensPerPlayer; tId++) {
            room.tokens.push({
                id: tId,
                playerId: pIdx,
                networkPlayerId: player.playerId,
                color: playerColor,
                step: -1
            });
        }
    });

    console.log(`[AUTORITATIVO] 🚀 Sala ${room.id} (${totalPlayers}J) inicializada con ${room.tokens.length} fichas.`);
}

// --- GESTIÓN DE TIMERS Y CICLO DE TURNOS EN EL SERVIDOR ---

function clearRoomTurnTimer(room) {
    if (room && room.turnTimeoutHandle) {
        clearTimeout(room.turnTimeoutHandle);
        room.turnTimeoutHandle = null;
    }
}

function checkAbandonmentCondition(room, reason = 'voluntary') {
    if (!room || !room.gameStarted) return false;
    // Un jugador sigue participando si no ha sido formalmente expulsado (!isExpelled)
    const activeOrGracePlayers = room.players.filter(p => !p.isExpelled);
    const connectedHumans = room.players.filter(p => !p.isBot && p.isConnected && !p.isExpelled);
    
    if (activeOrGracePlayers.length <= 1 && connectedHumans.length >= 1) {
        const winner = connectedHumans[0];
        room.lastWinnerId = winner ? winner.playerId : '';
        console.log(`[ABANDONO AUTORITATIVO] Sala ${room.id} terminada (Motivo: ${reason}). Ganador: ${winner ? winner.playerId : 'Nadie'}`);
        clearRoomTurnTimer(room);
        io.in(room.id).emit('event_game_over_by_abandonment', {
            winnerId: winner ? winner.playerId : "",
            reason: reason
        });
        return true;
    }
    return false;
}

function startRoomTurnAuthoritative(roomId, explicitSlotIndex) {
    const room = rooms[roomId];
    if (!room || !room.gameStarted) return;

    clearRoomTurnTimer(room);

    if (checkAbandonmentCondition(room, 'voluntary')) return;

    const totalSlots = room.players.length;
    const isHex = (room.targetPlayers || totalSlots) > 4;
    const goalStep = getGoalStep(isHex);

    let targetSlot = explicitSlotIndex !== undefined ? explicitSlotIndex : (room.currentTurnSlot || 0);
    if (targetSlot < 0 || targetSlot >= totalSlots) targetSlot = 0;

    // Saltar jugadores que ya terminaron todas sus fichas
    let loops = 0;
    while (loops < totalSlots) {
        const playerTokens = room.tokens ? room.tokens.filter(t => t.playerId === targetSlot) : [];
        const isFinished = playerTokens.length > 0 && playerTokens.every(t => t.step === goalStep);
        if (!isFinished) break;
        targetSlot = (targetSlot + 1) % totalSlots;
        loops++;
    }

    room.currentTurnSlot = targetSlot;
    const activePlayer = room.players[targetSlot];
    if (!activePlayer) return;

    if (room.forceNextTurnAfterPenaltyMap) {
        room.forceNextTurnAfterPenaltyMap[activePlayer.playerId] = false;
    }

    room.currentTurnDice = {
        playerId: activePlayer.playerId,
        diceValues: null,
        remainingMoves: [],
        hasRolled: false
    };

    console.log(`[TURNO AUTORITATIVO] Sala ${roomId} -> Slot ${targetSlot} (${activePlayer.playerId}) [Bot: ${!!activePlayer.isBot}, Connected: ${activePlayer.isConnected}]`);

    io.in(roomId).emit('event_turn_started', {
        playerId: activePlayer.playerId,
        activePlayerId: activePlayer.playerId,
        turnDurationSeconds: 15
    });

    const isBotOrDisconnected = activePlayer.isBot || activePlayer.isConnected === false || activePlayer.isExpelled;

    if (isBotOrDisconnected) {
        // Bot o Desconectado: Procesar tiro ágil y natural (1.2 segundos)
        room.turnTimeoutHandle = setTimeout(() => {
            executeBotTurnSequenceAuthoritative(roomId, activePlayer.playerId);
        }, 1200);
    } else {
        // Humano conectado: Temporizador de 15 segundos
        room.turnTimeoutHandle = setTimeout(() => {
            console.log(`[TIMEOUT AUTORITATIVO] Jugador humano ${activePlayer.playerId} agotó sus 15s.`);
            io.in(roomId).emit('event_turn_timeout', { playerId: activePlayer.playerId });
            room.turnTimeoutHandle = setTimeout(() => {
                executeBotTurnSequenceAuthoritative(roomId, activePlayer.playerId);
            }, 800);
        }, 15000);
    }
}

function executeBotTurnSequenceAuthoritative(roomId, playerId) {
    const room = rooms[roomId];
    if (!room || !room.gameStarted) return;

    clearRoomTurnTimer(room);

    const pIdx = room.players.findIndex(p => p.playerId === playerId);
    if (pIdx === -1) return;

    const totalPlayers = room.targetPlayers || room.players.length;
    const isHex = totalPlayers > 4;
    const goalStep = getGoalStep(isHex);

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;

    if (!room.consecutiveDoublesMap) room.consecutiveDoublesMap = {};

    if (d1 === d2) {
        room.consecutiveDoublesMap[playerId] = (room.consecutiveDoublesMap[playerId] || 0) + 1;
        console.log(`[BOT AUTORITATIVO] 🎲 Bot ${playerId} sacó DOBLES [${d1}, ${d2}]. Consecutivos: ${room.consecutiveDoublesMap[playerId]}`);

        if (room.consecutiveDoublesMap[playerId] >= 3) {
            room.consecutiveDoublesMap[playerId] = 0;
            console.log(`[BOT AUTORITATIVO] 🚫 Bot ${playerId} alcanzó 3 dobles. Penalizando ficha...`);

            const lastTokenId = room.lastMovedTokenMap ? room.lastMovedTokenMap[playerId] : null;
            if (lastTokenId !== null && lastTokenId !== undefined && room.tokens) {
                const tokenToPenalize = room.tokens.find(t => (t.networkPlayerId === playerId || t.playerId === pIdx) && t.id === lastTokenId && t.step > 0);
                if (tokenToPenalize) {
                    tokenToPenalize.step = -1;
                    setTimeout(() => {
                        io.in(roomId).emit('event_token_moved', {
                            playerId: playerId,
                            tokenId: lastTokenId,
                            newPathIndex: -1,
                            isBotMove: true,
                            isPenalty: true
                        });
                    }, 1000);
                }
            }

            room.currentTurnDice = {
                playerId: playerId,
                diceValues: [d1, d2],
                remainingMoves: [d1, d2],
                hasRolled: true
            };

            io.in(roomId).emit('event_dice_result', {
                playerId: playerId,
                diceRoll1: d1,
                diceRoll2: d2,
                diceValues: [d1, d2]
            });

            room.turnTimeoutHandle = setTimeout(() => {
                advanceTurnAuthoritative(roomId);
            }, 2000);
            return;
        }
    } else {
        room.consecutiveDoublesMap[playerId] = 0;
    }

    room.currentTurnDice = {
        playerId: playerId,
        diceValues: [d1, d2],
        remainingMoves: [d1, d2],
        hasRolled: true
    };

    io.in(roomId).emit('event_dice_result', {
        playerId: playerId,
        diceRoll1: d1,
        diceRoll2: d2,
        diceValues: [d1, d2]
    });

    let movesLeft = [d1, d2];

    function runBotMoveStep() {
        if (!rooms[roomId] || !rooms[roomId].gameStarted) return;
        const currentRoom = rooms[roomId];

        const validChoices = getPlayableTokenMovesAuthoritative(currentRoom.tokens, pIdx, movesLeft, totalPlayers);

        if (validChoices.length === 0) {
            console.log(`[BOT AUTORITATIVO] Sin jugadas legales para Bot ${playerId} con dados [${movesLeft.join(', ')}]`);
            if (d1 === d2) {
                console.log(`[BOT AUTORITATIVO] Doble sin movimientos. Repitiendo tiro tras 1.2s...`);
                currentRoom.turnTimeoutHandle = setTimeout(() => {
                    executeBotTurnSequenceAuthoritative(roomId, playerId);
                }, 1200);
            } else {
                currentRoom.turnTimeoutHandle = setTimeout(() => {
                    advanceTurnAuthoritative(roomId);
                }, 800);
            }
            return;
        }

        const choice = pickBestBotMove(validChoices, currentRoom.tokens, pIdx, totalPlayers);
        if (!choice) {
            advanceTurnAuthoritative(roomId);
            return;
        }

        const token = currentRoom.tokens.find(t => t.playerId === pIdx && t.id === choice.token.id);
        const oldStep = token ? token.step : -1;
        if (token) {
            token.step = choice.targetStep;
            currentRoom.lastMovedTokenMap[playerId] = choice.token.id;
        }

        const { updatedTokens, capturedTokens, bonusSteps } = evaluateMoveRulesAuthoritative(
            currentRoom.tokens, choice.token.id, pIdx, choice.targetStep, totalPlayers
        );
        currentRoom.tokens = updatedTokens;

        io.in(roomId).emit('event_token_moved', {
            playerId: playerId,
            tokenId: choice.token.id,
            newPathIndex: choice.targetStep,
            isBotMove: true
        });

        if (capturedTokens.length > 0) {
            capturedTokens.forEach(cToken => {
                const enemyPlayer = currentRoom.players[cToken.playerId];
                const enemyNetworkId = enemyPlayer ? enemyPlayer.playerId : String(cToken.playerId);
                io.in(roomId).emit('event_token_moved', {
                    playerId: enemyNetworkId,
                    tokenId: cToken.id,
                    newPathIndex: -1,
                    isBotMove: false
                });
            });
        }

        if (choice.isSum) {
            movesLeft = [];
            if (currentRoom.currentTurnDice) currentRoom.currentTurnDice.remainingMoves = [];
        } else {
            const idx = movesLeft.indexOf(choice.moveVal);
            if (idx !== -1) movesLeft.splice(idx, 1);
            else if (movesLeft.length > 0) movesLeft.shift();
            if (currentRoom.currentTurnDice) currentRoom.currentTurnDice.remainingMoves = [...movesLeft];
        }

        // Calcular la duración exacta de la caminata visual del cliente (250ms por paso + 800ms de pausa de aterrizaje)
        const animSteps = (oldStep < 0) ? 1 : Math.max(1, choice.targetStep - oldStep);
        const movePauseMs = (animSteps * 250) + 800;

        currentRoom.turnTimeoutHandle = setTimeout(() => {
            const nextPlayables = getPlayableTokenMovesAuthoritative(currentRoom.tokens, pIdx, movesLeft, totalPlayers);
            if (movesLeft.length > 0 && nextPlayables.length > 0) {
                runBotMoveStep();
            } else if (bonusSteps > 0) {
                console.log(`[BOT AUTORITATIVO] Bot ${playerId} ganó +${bonusSteps} pasos de bono.`);
                io.in(roomId).emit('event_dice_result', {
                    playerId: playerId,
                    diceRoll1: 0,
                    diceRoll2: 0,
                    diceValues: [bonusSteps]
                });
                movesLeft = [bonusSteps];
                if (currentRoom.currentTurnDice) currentRoom.currentTurnDice.remainingMoves = [bonusSteps];
                currentRoom.turnTimeoutHandle = setTimeout(() => {
                    runBotMoveStep();
                }, 1200);
            } else if (d1 === d2) {
                console.log(`[BOT AUTORITATIVO] Bot repite turno por dobles.`);
                currentRoom.turnTimeoutHandle = setTimeout(() => {
                    executeBotTurnSequenceAuthoritative(roomId, playerId);
                }, 1200);
            } else {
                currentRoom.turnTimeoutHandle = setTimeout(() => {
                    advanceTurnAuthoritative(roomId);
                }, 600);
            }
        }, movePauseMs);
    }

    room.turnTimeoutHandle = setTimeout(() => {
        runBotMoveStep();
    }, 1200);
}

function advanceTurnAuthoritative(roomId, explicitSlotIndex) {
    const room = rooms[roomId];
    if (!room || !room.gameStarted) return;

    clearRoomTurnTimer(room);

    // 1. Decrementar turno de gracia para el jugador desconectado si aplica
    if (room.currentTurnSlot !== undefined && room.players && room.players[room.currentTurnSlot]) {
        const prevPlayer = room.players[room.currentTurnSlot];
        if (prevPlayer && prevPlayer.isConnected === false && prevPlayer._graceTurnsLeft !== undefined) {
            prevPlayer._graceTurnsLeft -= 1;
            console.log(`[GRACIA AUTORITATIVA] Jugador ${prevPlayer.playerId} consumió 1 turno bot. Restantes: ${prevPlayer._graceTurnsLeft}`);

            if (prevPlayer._graceTurnsLeft <= 0) {
                console.log(`[EXPULSIÓN AUTORITATIVA] Jugador ${prevPlayer.playerId} agotó su gracia. EXPULSADO.`);
                delete prevPlayer._graceTurnsLeft;
                prevPlayer.isExpelled = true;
                prevPlayer.isBot = true;

                io.in(roomId).emit('event_player_expelled', { playerId: prevPlayer.playerId, reason: 'inactivity' });

                if (checkAbandonmentCondition(room, 'inactivity')) return;
            }
        }
    }

    if (checkAbandonmentCondition(room, 'voluntary')) return;

    // 2. Determinar el siguiente turno
    const totalSlots = room.players.length;
    let nextSlot = (room.currentTurnSlot !== undefined ? room.currentTurnSlot + 1 : 0) % totalSlots;

    if (explicitSlotIndex !== undefined) {
        nextSlot = explicitSlotIndex % totalSlots;
    }

    startRoomTurnAuthoritative(roomId, nextSlot);
}

function sendStateResyncDirect(socket, room) {
    if (!room || !room.gameStarted) return;
    const isHex = (room.targetPlayers || room.players.length) > 4;
    const colorsOrder = isHex ? HEX_COLORS_ORDER : SQUARE_COLORS_ORDER;
    const goalStep = getGoalStep(isHex);
    
    const finishedIndices = [];
    room.players.forEach((p, pIdx) => {
        const pTokens = room.tokens ? room.tokens.filter(t => t.playerId === pIdx) : [];
        if (pTokens.length > 0 && pTokens.every(t => t.step === goalStep)) {
            finishedIndices.push(pIdx);
        }
    });

    const activePlayer = room.players[room.currentTurnSlot];
    const currentTurnPlayerId = activePlayer ? activePlayer.playerId : '';

    const enrichedTokens = (room.tokens || []).map(tk => ({
        id: tk.id,
        playerId: tk.playerId,
        networkPlayerId: tk.networkPlayerId,
        color: tk.color || colorsOrder[tk.playerId] || 'yellow',
        step: typeof tk.step === 'number' ? tk.step : -1
    }));

    socket.emit('event_state_resynced', {
        tokens: enrichedTokens,
        currentTurn: currentTurnPlayerId,
        currentTurnSlot: room.currentTurnSlot,
        finishedIndices
    });
    console.log(`[SYNC AUTORITATIVO] Estado de juego enviado directamente a ${socket.id} (Player: ${socket.playerId})`);
}

// --- SOCKET.IO EVENT HANDLERS ---

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
                mode: mode || 'online_training',
                players: [],
                targetPlayers: targetPlayers || 2,
                gameStarted: false
            };
        }

        const room = rooms[foundRoomId];
        const existingPlayer = room.players.find(p => p.playerId === playerId);
        if (!existingPlayer) {
            room.players.push({
                playerId,
                playerName,
                socketId: socket.id,
                isConnected: true,
                isBot: false,
                slotIndex: room.players.length
            });
        } else {
            existingPlayer.socketId = socket.id;
            existingPlayer.isConnected = true;
            existingPlayer.isBot = false;
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

            setTimeout(() => {
                startRoomTurnAuthoritative(foundRoomId, 0);
            }, 3500);
        }
    });

    socket.on('leave_matchmaking', (payload) => {
        const playerId = (payload && payload.playerId) || socket.playerId;
        console.log(`[MATCHMAKING] leave_matchmaking recibido para PlayerID: ${playerId}`);
        
        if (socket.roomId && rooms[socket.roomId] && !rooms[socket.roomId].gameStarted) {
            const rId = socket.roomId;
            rooms[rId].players = rooms[rId].players.filter(p => p.playerId !== playerId && p.socketId !== socket.id);
            socket.leave(rId);
            if (rooms[rId].players.length === 0) {
                delete rooms[rId];
            } else {
                rooms[rId].players.forEach((p, idx) => { p.slotIndex = idx; });
                io.in(rId).emit('room_updated', {
                    id: rId,
                    players: rooms[rId].players,
                    targetPlayers: rooms[rId].targetPlayers
                });
            }
        }

        for (const [rId, room] of Object.entries(rooms)) {
            if (!room.gameStarted) {
                const hadPlayer = room.players.some(p => p.playerId === playerId || p.socketId === socket.id);
                if (hadPlayer) {
                    room.players = room.players.filter(p => p.playerId !== playerId && p.socketId !== socket.id);
                    socket.leave(rId);
                    if (room.players.length === 0) {
                        delete rooms[rId];
                    } else {
                        room.players.forEach((p, idx) => { p.slotIndex = idx; });
                        io.in(rId).emit('room_updated', {
                            id: rId,
                            players: room.players,
                            targetPlayers: room.targetPlayers
                        });
                    }
                }
            }
        }
    });

    // === LIMPIEZA AUTORITATIVA: ABANDONO EXPLÍCITO DE SALA ===
    socket.on('intent_leave_room', (payload) => {
        const roomId = (payload && payload.roomId) || socket.roomId;
        const playerId = (payload && payload.playerId) || socket.playerId;
        console.log(`[SALA] Abandono explícito de sala ${roomId} para PlayerID: ${playerId}`);

        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            const player = room.players.find(p => p.playerId === playerId || p.socketId === socket.id);
            if (player) {
                player.isConnected = false;
                player.isBot = true;
                player.isExpelled = true;
                delete player._graceTurnsLeft;
                
                io.in(roomId).emit('room_updated', {
                    id: roomId,
                    players: room.players,
                    targetPlayers: room.targetPlayers
                });
                io.in(roomId).emit('event_player_disconnected', {
                    playerId: player.playerId,
                    isExpelled: true
                });
                io.in(roomId).emit('event_player_expelled', {
                    playerId: player.playerId,
                    reason: 'voluntary'
                });
                
                if (room.gameStarted) {
                    if (checkAbandonmentCondition(room, 'voluntary')) {
                        return;
                    }
                    if (room.players[room.currentTurnSlot]?.playerId === player.playerId) {
                        advanceTurnAuthoritative(roomId);
                    }
                }
                
                const allDisconnected = room.players.every(p => p.isConnected === false);
                if (allDisconnected || !room.gameStarted) {
                    clearRoomTurnTimer(room);
                    delete rooms[roomId];
                    console.log(`[LIMPIEZA] Sala ${roomId} eliminada por abandono total.`);
                }
            }
            socket.leave(roomId);
        }
        if (socket.roomId === roomId) {
            socket.roomId = null;
        }
    });

    socket.on('create_private_room', (payload) => {
        const { playerId, playerName, targetPlayers, mode } = payload;
        const roomId = generateUniqueRoomId();
        rooms[roomId] = {
            id: roomId,
            isPrivate: true,
            mode: mode || 'online_training',
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
            socket.emit('event_room_expired', { roomId: cleanRoomCode, reason: "inactivity", isSelfExpelled: true });
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
            if (existingPlayer.isExpelled) {
                console.log(`[RECONEXIÓN TARDÍA] Jugador ${playerId} previamente expulsado de sala privada ${cleanRoomCode}.`);
                socket.emit('event_game_over_by_abandonment', {
                    winnerId: room.lastWinnerId || '',
                    reason: 'inactivity',
                    isSelfExpelled: true
                });
                return;
            }

            const wasOffline = !existingPlayer.isConnected || existingPlayer.isBot;
            existingPlayer.socketId = socket.id;
            existingPlayer.isConnected = true;
            existingPlayer.isBot = false;
            delete existingPlayer._graceTurnsLeft;
            console.log(`[RECONEXIÓN] Jugador ${playerId} volvió a sala privada ${cleanRoomCode}`);
            
            if (wasOffline && room.gameStarted) {
                const activePlayer = room.players[room.currentTurnSlot];
                if (activePlayer && (activePlayer.playerId === playerId || activePlayer.playerId === existingPlayer.playerId)) {
                    clearRoomTurnTimer(room);
                    if (room.currentTurnDice && room.currentTurnDice.hasRolled && room.currentTurnDice.remainingMoves && room.currentTurnDice.remainingMoves.length > 0) {
                        console.log(`[RECONEXIÓN A MITAD DE TURNO] Turno devuelto a ${playerId} en sala privada con jugadas pendientes: [${room.currentTurnDice.remainingMoves.join(', ')}]`);
                        io.in(cleanRoomCode).emit('event_dice_result', {
                            playerId: playerId,
                            diceValues: room.currentTurnDice.diceValues,
                            remainingMoves: room.currentTurnDice.remainingMoves
                        });
                        room.turnTimeoutHandle = setTimeout(() => {
                            console.log(`[TIMEOUT AUTORITATIVO] Jugador reconectado ${playerId} agotó sus 15s.`);
                            io.in(cleanRoomCode).emit('event_turn_timeout', { playerId: playerId });
                            room.turnTimeoutHandle = setTimeout(() => {
                                executeBotTurnSequenceAuthoritative(cleanRoomCode, playerId);
                            }, 800);
                        }, 15000);
                    } else {
                        console.log(`[RECONEXIÓN] Turno activo devuelto de inmediato al humano ${playerId} en sala privada ${cleanRoomCode}.`);
                        io.in(cleanRoomCode).emit('event_turn_started', {
                            playerId: playerId,
                            activePlayerId: playerId,
                            turnDurationSeconds: 15
                        });
                        room.turnTimeoutHandle = setTimeout(() => {
                            console.log(`[TIMEOUT AUTORITATIVO] Jugador reconectado ${playerId} agotó sus 15s.`);
                            io.in(cleanRoomCode).emit('event_turn_timeout', { playerId: playerId });
                            room.turnTimeoutHandle = setTimeout(() => {
                                executeBotTurnSequenceAuthoritative(cleanRoomCode, playerId);
                            }, 800);
                        }, 15000);
                    }
                }

                io.in(cleanRoomCode).emit('event_player_reconnected', {
                    playerId: playerId
                });
                sendStateResyncDirect(socket, room);
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
                startRoomTurnAuthoritative(cleanRoomCode, 0);
            }, 3500);
        }
    });

    // 🚪 Unirse / Reconectarse a una sala pública
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
                if (player.isExpelled) {
                    console.log(`[RECONEXIÓN TARDÍA] Jugador ${playerId} ya fue expulsado de sala ${roomId}.`);
                    socket.emit('event_game_over_by_abandonment', {
                        winnerId: room.lastWinnerId || '',
                        reason: 'inactivity',
                        isSelfExpelled: true
                    });
                    return;
                }

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
                    const activePlayer = room.players[room.currentTurnSlot];
                    if (activePlayer && (activePlayer.playerId === playerId || activePlayer.playerId === player.playerId)) {
                        clearRoomTurnTimer(room);
                        if (room.currentTurnDice && room.currentTurnDice.hasRolled && room.currentTurnDice.remainingMoves && room.currentTurnDice.remainingMoves.length > 0) {
                            console.log(`[RECONEXIÓN A MITAD DE TURNO] Turno devuelto a ${playerId} con jugadas pendientes: [${room.currentTurnDice.remainingMoves.join(', ')}]`);
                            io.in(roomId).emit('event_dice_result', {
                                playerId: playerId,
                                diceValues: room.currentTurnDice.diceValues,
                                remainingMoves: room.currentTurnDice.remainingMoves
                            });
                            room.turnTimeoutHandle = setTimeout(() => {
                                console.log(`[TIMEOUT AUTORITATIVO] Jugador reconectado ${playerId} no completó su jugada en 15s.`);
                                io.in(roomId).emit('event_turn_timeout', { playerId: playerId });
                                room.turnTimeoutHandle = setTimeout(() => {
                                    executeBotTurnSequenceAuthoritative(roomId, playerId);
                                }, 800);
                            }, 15000);
                        } else {
                            console.log(`[RECONEXIÓN] Turno activo devuelto de inmediato al humano ${playerId} en sala ${roomId}.`);
                            io.in(roomId).emit('event_turn_started', {
                                playerId: playerId,
                                activePlayerId: playerId,
                                turnDurationSeconds: 15
                            });
                            room.turnTimeoutHandle = setTimeout(() => {
                                console.log(`[TIMEOUT AUTORITATIVO] Jugador reconectado ${playerId} agotó sus 15s.`);
                                io.in(roomId).emit('event_turn_timeout', { playerId: playerId });
                                room.turnTimeoutHandle = setTimeout(() => {
                                    executeBotTurnSequenceAuthoritative(roomId, playerId);
                                }, 800);
                            }, 15000);
                        }
                    }

                    io.in(roomId).emit('event_player_reconnected', {
                        playerId: playerId
                    });
                    sendStateResyncDirect(socket, room);
                }
            }
        } else {
            socket.emit('event_room_expired', { roomId: roomId, reason: "inactivity", isSelfExpelled: true, message: "Has sido desconectado por inactividad" });
        }
    });

    socket.on('intent_roll_dice', (payload) => {
        const { roomId, playerId } = payload;
        const room = rooms[roomId];

        if (!room || !room.gameStarted) {
            console.log(`[AUTORITATIVO] 🚫 Rechazado intent_roll_dice: Sala ${roomId} no existe o no ha iniciado.`);
            return;
        }

        const activePlayer = room.players[room.currentTurnSlot];
        if (!activePlayer || activePlayer.playerId !== playerId) {
            console.log(`[AUTORITATIVO] 🚫 Rechazado intent_roll_dice: Jugador ${playerId} no es el turno activo (${activePlayer ? activePlayer.playerId : 'nadie'}).`);
            return;
        }

        if (room.currentTurnDice && room.currentTurnDice.hasRolled) {
            console.log(`[AUTORITATIVO] 🚫 Rechazado intent_roll_dice: Jugador ${playerId} ya lanzó los dados en este turno.`);
            return;
        }

        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;

        clearRoomTurnTimer(room);

        if (room.forceNextTurnAfterPenaltyMap) {
            room.forceNextTurnAfterPenaltyMap[playerId] = false;
        }

        room.currentTurnDice = {
            playerId: playerId,
            diceValues: [d1, d2],
            remainingMoves: [d1, d2],
            hasRolled: true
        };

            if (room.consecutiveDoublesMap) {
                if (d1 === d2) {
                    room.consecutiveDoublesMap[playerId] = (room.consecutiveDoublesMap[playerId] || 0) + 1;
                    console.log(`[AUTORITATIVO] 🎲 Jugador ${playerId} en Sala ${roomId} obtuvo DOBLES [${d1}, ${d2}]. Consecutivos: ${room.consecutiveDoublesMap[playerId]}`);
                    
                    if (room.consecutiveDoublesMap[playerId] >= 3) {
                        room.consecutiveDoublesMap[playerId] = 0;
                        console.log(`[AUTORITATIVO] 🚫 ¡3er DOBLE ALCANZADO! Castigo autoritativo para Jugador ${playerId}.`);
                        
                        const lastTokenId = room.lastMovedTokenMap ? room.lastMovedTokenMap[playerId] : null;
                        if (lastTokenId !== null && lastTokenId !== undefined && room.tokens) {
                            const pIdx = room.players.findIndex(p => p.playerId === playerId);
                            const targetPlayerIdx = pIdx !== -1 ? pIdx : 0;
                            
                            const tokenToPenalize = room.tokens.find(t => (t.networkPlayerId === playerId || t.playerId === targetPlayerIdx) && t.id === lastTokenId && t.step > 0);
                            if (tokenToPenalize) {
                                tokenToPenalize.step = -1;
                                
                                if (!room.forceNextTurnAfterPenaltyMap) room.forceNextTurnAfterPenaltyMap = {};
                                room.forceNextTurnAfterPenaltyMap[playerId] = true;

                                setTimeout(() => {
                                    console.log(`[AUTORITATIVO] 🏠 Ficha ${lastTokenId} de ${playerId} castigada a base (step = -1).`);
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
                }
            }

        // Temporizador de movimiento para humano (15s)
        room.turnTimeoutHandle = setTimeout(() => {
            console.log(`[TIMEOUT MOVIMIENTO] Humano ${playerId} no movió a tiempo. El bot suplirá la jugada.`);
            executeBotTurnSequenceAuthoritative(roomId, playerId);
        }, 15000);

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

        if (room && room.forceNextTurnAfterPenaltyMap && room.forceNextTurnAfterPenaltyMap[playerId]) {
            console.log(`[AUTORITATIVO] 🚫 Veto de movimiento: Jugador ${playerId} intentó mover durante secuencia de penalización.`);
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

                if (typeof newPathIndex === 'number' && typeof oldStep === 'number') {
                    const distanceMoved = newPathIndex - oldStep;
                    if (distanceMoved > 0 && room.pendingBonusMap && room.pendingBonusMap[playerId] > 0) {
                        let bonusToDeduct = 0;
                        if (distanceMoved >= room.pendingBonusMap[playerId] && distanceMoved > 12) {
                            bonusToDeduct = room.pendingBonusMap[playerId];
                        } else if (distanceMoved > 12) {
                            if (distanceMoved >= 25 && room.pendingBonusMap[playerId] >= 25 && isHex) bonusToDeduct = 25;
                            else if (distanceMoved >= 20 && room.pendingBonusMap[playerId] >= 20) bonusToDeduct = 20;
                            else if (distanceMoved >= 15 && room.pendingBonusMap[playerId] >= 15 && isHex) bonusToDeduct = 15;
                            else if (distanceMoved >= 10 && room.pendingBonusMap[playerId] >= 10) bonusToDeduct = 10;
                        } else if (distanceMoved === 10 || distanceMoved === 15 || distanceMoved === 20 || distanceMoved === 25) {
                            if (room.pendingBonusMap[playerId] >= distanceMoved) bonusToDeduct = distanceMoved;
                        }
                        
                        if (bonusToDeduct > 0) {
                            room.pendingBonusMap[playerId] -= bonusToDeduct;
                        }
                    }
                }

                if (room.currentTurnDice && room.currentTurnDice.remainingMoves) {
                    const dist = (oldStep < 0) ? (isHex ? 1 : 5) : (newPathIndex - oldStep);
                    const mIdx = room.currentTurnDice.remainingMoves.indexOf(dist);
                    if (mIdx !== -1) {
                        room.currentTurnDice.remainingMoves.splice(mIdx, 1);
                    } else if (room.currentTurnDice.remainingMoves.length === 2 && (room.currentTurnDice.remainingMoves[0] + room.currentTurnDice.remainingMoves[1] === dist)) {
                        room.currentTurnDice.remainingMoves = [];
                    } else if (room.currentTurnDice.remainingMoves.length > 0) {
                        room.currentTurnDice.remainingMoves.shift();
                    }
                }

                const { updatedTokens, capturedTokens, bonusSteps } = evaluateMoveRulesAuthoritative(
                    room.tokens, tokenId, targetPlayerIdx, newPathIndex, room.targetPlayers || room.players.length
                );

                if (capturedTokens.length > 0) {
                    room.tokens = updatedTokens;
                    capturedToEmit = capturedTokens;

                    if (bonusSteps > 0) {
                        if (!room.pendingBonusMap) room.pendingBonusMap = {};
                        room.pendingBonusMap[playerId] = (room.pendingBonusMap[playerId] || 0) + bonusSteps;
                    }
                }
            }
        }

        io.in(roomId).emit('event_token_moved', {
            playerId,
            tokenId,
            newPathIndex,
            isBotMove
        });

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
            });
        }
    });

    socket.on('intent_end_turn', (payload) => {
        const { roomId, nextPlayerId, nextTurnId, explicitNetworkId } = payload;
        
        const room = rooms[roomId];
        if (!room) return;

        let activePlayerId = null;
        if (room.players && room.currentTurnSlot !== undefined) {
            const activePlayer = room.players[room.currentTurnSlot];
            activePlayerId = activePlayer ? activePlayer.playerId : null;
        }

        // Retención autoritativa de turno por bono de captura pendiente
        if (activePlayerId && room.pendingBonusMap && room.pendingBonusMap[activePlayerId] > 0) {
            const bonusToAward = room.pendingBonusMap[activePlayerId];
            room.pendingBonusMap[activePlayerId] = 0;

            console.log(`[AUTORITATIVO] 🛑 Reemitiendo dados por bonificación pendiente (+${bonusToAward}) a ${activePlayerId}`);

            io.in(roomId).emit('event_dice_result', {
                playerId: activePlayerId,
                diceRoll1: 0,
                diceRoll2: 0,
                diceValues: [bonusToAward]
            });
            return;
        }

        let targetSlot = undefined;
        if (explicitNetworkId) {
            const foundIdx = room.players.findIndex(p => p.playerId === explicitNetworkId);
            if (foundIdx !== -1) targetSlot = foundIdx;
        } else if (nextPlayerId !== undefined || nextTurnId !== undefined) {
            const colorIdToSlotIndex = { 0: 0, 2: 1, 1: 2, 3: 3, 4: 4, 5: 5 };
            const parsedColorId = parseInt(nextPlayerId !== undefined ? nextPlayerId : nextTurnId, 10);
            targetSlot = colorIdToSlotIndex[parsedColorId];
        }

        advanceTurnAuthoritative(roomId, targetSlot);
    });

    socket.on('intent_chat', (payload) => {
        const { roomId, playerId, playerName, message } = payload;
        io.in(roomId).emit('event_chat', {
            playerId,
            playerName,
            message
        });
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
                        console.log(`[GRACIA AUTORITATIVA] Jugador ${playerId} desconectado. Sala ${room.targetPlayers}p = Bot con ${graceTurns} turnos de gracia.`);

                        const activePlayer = room.players[room.currentTurnSlot];
                        if (activePlayer && activePlayer.playerId === playerId) {
                            clearRoomTurnTimer(room);
                            room.turnTimeoutHandle = setTimeout(() => {
                                executeBotTurnSequenceAuthoritative(roomId, playerId);
                            }, 1200);
                        }
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
                        clearRoomTurnTimer(room);
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
    console.log(`[SERVER] Sweety Ludo WebSocket Server V24.0 Autoritativo (100% Server Bot & Reconnection) en puerto ${PORT}`);
});
