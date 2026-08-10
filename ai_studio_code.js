const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// ---------------------------------------------------
// CONFIGURACIÓN CORS ACTUALIZADA (V20 - MOTOR AAA)
// ---------------------------------------------------
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    maxHttpBufferSize: 1e6
});

const rooms = {};

// Constantes de Mapeo (Fase 1)
const TRACK_STEPS = 52;
const HEX_TRACK_STEPS = 78;

const SQUARE_COLORS_ORDER = ['yellow', 'green', 'red', 'blue'];
const HEX_COLORS_ORDER = ['yellow', 'purple', 'green', 'red', 'orange', 'blue'];

const SQUARE_SAFE_CELLS = [
    1, 9, 14, 22, 27, 35, 40, 48
];

const HEX_SAFE_CELLS = [
    1, 8, 14, 21, 27, 34, 40, 47, 53, 60, 66, 73
];

const STAR_CELLS = [9, 22, 35, 48]; // Cuadrado

function getStartOffset(colorName, isHex) {
    if (isHex) {
        switch (colorName) {
            case 'yellow': return 0;
            case 'purple': return 13;
            case 'green': return 26;
            case 'red': return 39;
            case 'orange': return 52;
            case 'blue': return 65;
            default: return 0;
        }
    } else {
        switch (colorName) {
            case 'yellow': return 0;
            case 'green': return 13;
            case 'red': return 26;
            case 'blue': return 39;
            default: return 0;
        }
    }
}

function getCellIndexForToken(colorName, step, isHex) {
    if (step < 0) return 'Base';
    
    const trackSize = isHex ? HEX_TRACK_STEPS : TRACK_STEPS;
    const goalStep = isHex ? 85 : 58;

    if (step === goalStep) return 'Meta';
    if (step >= trackSize) return 'Pasillo';

    const startOffset = getStartOffset(colorName, isHex);
    let cellIndex = (startOffset + step) % trackSize;
    if (cellIndex === 0) cellIndex = trackSize;
    return cellIndex;
}

function evaluateMoveRulesAuthoritative(tokens, movingTokenIndex, movingPlayerIdx, targetStep, totalPlayers) {
  const isHex = totalPlayers > 4;
  const trackSize = isHex ? HEX_TRACK_STEPS : TRACK_STEPS;
  const safeCells = isHex ? HEX_SAFE_CELLS : SQUARE_SAFE_CELLS;
  const perimeter = isHex ? 78 : 52;

  let capturedTokens = [];
  let bonusSteps = 0;
  let isExpulsion = false;

  const colorName = (isHex ? HEX_COLORS_ORDER : SQUARE_COLORS_ORDER)[movingPlayerIdx] || 'yellow';
  const movingTokenCell = getCellIndexForToken(colorName, targetStep, isHex);

  if (typeof movingTokenCell === 'number') {
      const tokensOnSameCell = tokens.filter(t => {
          if (t.step <= 0 || t.step >= trackSize) return false;
          const tColor = (isHex ? HEX_COLORS_ORDER : SQUARE_COLORS_ORDER)[t.playerId];
          return getCellIndexForToken(tColor, t.step, isHex) === movingTokenCell;
      });

      const myTokensOnCell = tokensOnSameCell.filter(t => t.playerId === movingPlayerIdx);
      const enemyTokensOnCell = tokensOnSameCell.filter(t => t.playerId !== movingPlayerIdx);

      if (targetStep === 1) { // Casilla de Salida (Expulsión obligatoria)
          if (myTokensOnCell.length === 1 && enemyTokensOnCell.length === 1) {
              capturedTokens.push(enemyTokensOnCell[0]);
              isExpulsion = true;
          }
      } else if (!safeCells.includes(movingTokenCell)) { // Casillas normales (Captura estándar)
          if (enemyTokensOnCell.length === 1) {
              capturedTokens.push(enemyTokensOnCell[0]);
              bonusSteps = isHex ? 25 : 20;
          }
      }
  }

  let penalizedToken = null;
  const updatedTokens = tokens.map(t => {
      const isCaptured = capturedTokens.some(ct => ct.playerId === t.playerId && ct.id === t.id);
      if (isCaptured) {
          penalizedToken = { ...t, step: -1 };
          return penalizedToken;
      }
      if (t.playerId === movingPlayerIdx && t.id === movingTokenIndex) {
          return { ...t, step: targetStep };
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
    res.send("Sweety Ludo V21.5 Motor AAA Autoritativo is running.");
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
            
            setTimeout(() => {
                const firstPlayer = room.players[0].playerId;
                io.in(foundRoomId).emit('event_turn_started', {
                    playerId: firstPlayer,
                    activePlayerId: firstPlayer
                });
            }, 3500);
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
                    activePlayerId: firstPlayer
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
        let isThreeDoublesPenalty = false;

        if (room && room.consecutiveDoublesMap) {
            if (d1 === d2) {
                room.consecutiveDoublesMap[playerId] = (room.consecutiveDoublesMap[playerId] || 0) + 1;
                console.log(`[AUTORITATIVO QA] 🎲 Jugador ${playerId} en Sala ${roomId} obtuvo DOBLES [${d1}, ${d2}]. Consecutivos: ${room.consecutiveDoublesMap[playerId]}`);
                
                if (room.consecutiveDoublesMap[playerId] >= 3) {
                    isThreeDoublesPenalty = true;
                    room.consecutiveDoublesMap[playerId] = 0;
                    console.log(`[AUTORITATIVO FASE 3] 🚫 ¡3er DOBLE ALCANZADO! Ejecutando castigo autoritativo para Jugador ${playerId}.`);
                    
                    const lastTokenId = room.lastMovedTokenMap ? room.lastMovedTokenMap[playerId] : null;
                    if (lastTokenId !== null && lastTokenId !== undefined && room.tokens) {
                        const pIdx = room.players.findIndex(p => p.playerId === playerId);
                        const targetPlayerIdx = pIdx !== -1 ? pIdx : 0;
                        
                        const tokenToPenalize = room.tokens.find(t => (t.networkPlayerId === playerId || t.playerId === targetPlayerIdx) && t.id === lastTokenId && t.step > 0);
                        if (tokenToPenalize) {
                            tokenToPenalize.step = -1;
                            console.log(`[AUTORITATIVO FASE 3] 🏠 Ficha ${lastTokenId} del Jugador ${playerId} castigada y enviada a la base (step = -1).`);
                            
                            // Emitir orden autoritativa de retorno a casa
                            io.in(roomId).emit('event_token_moved', {
                                playerId: playerId,
                                tokenId: lastTokenId,
                                newPathIndex: -1,
                                isBotMove: false
                            });
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
        let nextNetworkId;
        let targetSlot = 0;

        if (explicitNetworkId) {
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
    console.log(`[SERVER] Sweety Ludo WebSocket Server V23.0 Base + Private Room Sync Fix en puerto ${PORT}`);
});
