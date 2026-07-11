const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);

// === V20.9: MOTOR AAA AUTORITATIVO ===
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 4000,
    pingTimeout: 5000
});

// Base de datos en memoria para salas (Rooms)
const rooms = {};

function generateUniqueRoomId() {
    let roomId;
    do {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[roomId]);
    return roomId;
}

// REST API para validación de que el servidor funciona
app.get('/', (req, res) => {
    res.send("Sweety Ludo V20.9 Motor AAA Autoritativo is running.");
});

// =========================================================================
// WEBSOCKETS (MOTOR DE JUEGO)
// =========================================================================

io.on('connection', (socket) => {
    console.log(`[WS] Nuevo socket conectado: ${socket.id}`);

    // Identidad del jugador
    socket.on('register_identity', (payload) => {
        socket.playerId = payload.playerId;
        console.log(`[AUTH] Socket ${socket.id} registrado como PlayerID: ${socket.playerId}`);
    });

    // ==========================================
    // MATCHMAKING Y SALAS
    // ==========================================

    socket.on('join_matchmaking', (payload) => {
        const { playerId, playerName, targetPlayers, mode } = payload;
        console.log(`[MATCHMAKING] Player ${playerName} (${playerId}) buscando sala de ${targetPlayers} jugadores, modo ${mode}`);
        
        let foundRoomId = null;
        // Buscar sala pública existente que no esté llena
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
                targetPlayers: targetPlayers || 2
            };
            console.log(`[ROOM] Creada nueva sala pública: ${foundRoomId}`);
        }

        const room = rooms[foundRoomId];
        // Evitar duplicados si reenvía el join
        if (!room.players.find(p => p.playerId === playerId)) {
            room.players.push({ playerId, playerName, socketId: socket.id });
        }
        
        socket.join(foundRoomId);
        socket.roomId = foundRoomId;

        // Si la sala se llenó, emitir match_found para arrancar el juego
        if (room.players.length === room.targetPlayers) {
            console.log(`[MATCH_FOUND] Sala ${foundRoomId} completada. Iniciando partida.`);
            
            io.in(foundRoomId).emit('match_found', {
                roomId: foundRoomId,
                players: room.players
            });
        }
    });

    socket.on('create_private_room', (payload) => {
        const { playerId, playerName, targetPlayers } = payload;
        const roomId = generateUniqueRoomId();
        rooms[roomId] = {
            id: roomId,
            isPrivate: true,
            players: [{ playerId, playerName, socketId: socket.id }],
            targetPlayers: targetPlayers || 2
        };
        socket.join(roomId);
        socket.roomId = roomId;
        console.log(`[PRIVATE_ROOM] Player ${playerName} creó sala privada: ${roomId}`);
        socket.emit('private_room_created', { roomCode: roomId });
    });

    socket.on('join_private_room', (payload) => {
        const { playerId, playerName, roomCode } = payload;
        const room = rooms[roomCode];

        if (!room || !room.isPrivate) {
            socket.emit('room_error', { message: "Sala privada no encontrada" });
            return;
        }

        if (room.players.length >= room.targetPlayers) {
            socket.emit('room_error', { message: "La sala está llena" });
            return;
        }

        if (!room.players.find(p => p.playerId === playerId)) {
            room.players.push({ playerId, playerName, socketId: socket.id });
        }
        socket.join(roomCode);
        socket.roomId = roomCode;
        console.log(`[PRIVATE_ROOM] Player ${playerName} se unió a sala privada: ${roomCode}`);

        if (room.players.length === room.targetPlayers) {
            console.log(`[MATCH_FOUND] Sala privada ${roomCode} completada. Iniciando partida.`);
            io.in(roomCode).emit('match_found', {
                roomId: roomCode,
                players: room.players
            });
        }
    });

    // ==========================================
    // LÓGICA DE JUEGO AUTORITATIVO
    // ==========================================

    // V20.9 - El servidor genera los dados aleatorios y los envía a todos
    socket.on('intent_roll_dice', (payload) => {
        const { roomId, playerId } = payload;
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        
        console.log(`[GAME] Player ${playerId} (Sala ${roomId}) lanzó dados: ${d1}, ${d2}`);
        
        // Broadcast del resultado a todos en la sala, incluido el que tiró
        io.in(roomId).emit('event_dice_result', {
            playerId: playerId,
            diceRoll1: d1,
            diceRoll2: d2,
            diceValues: [d1, d2]
        });
    });

    socket.on('intent_move_token', (payload) => {
        const { roomId, playerId, tokenId, newPathIndex, isBotMove } = payload;
        console.log(`[GAME] Player ${playerId} (Sala ${roomId}) movió ficha ${tokenId} -> ${newPathIndex}`);
        
        io.in(roomId).emit('event_token_moved', {
            playerId,
            tokenId,
            newPathIndex,
            isBotMove
        });
    });

    socket.on('intent_end_turn', (payload) => {
        const { roomId, nextTurnId } = payload;
        console.log(`[GAME] Sala ${roomId} cambio de turno a: ${nextTurnId}`);
        
        // ¡CRUCIAL V20.9! Transmitir a todos que es el turno del otro jugador
        io.in(roomId).emit('event_turn_started', {
            nextTurnId: nextTurnId
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

    // ==========================================
    // DESCONEXIONES
    // ==========================================

    socket.on('disconnect', () => {
        console.log(`[WS] Socket desconectado: ${socket.id} (PlayerID: ${socket.playerId})`);
        if (socket.roomId && socket.playerId) {
            io.in(socket.roomId).emit('event_player_disconnected', {
                playerId: socket.playerId
            });
            
            // Para la Fase de Gracia (9 segundos), no borramos al jugador
            // de la memoria de forma inmediata. Permitimos que vuelva y se reconecte
            // emitiendo join_private_room / join_matchmaking nuevamente.
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[SERVER] Sweety Ludo WebSocket Server V20.9 (Motor AAA) ejecutándose en puerto ${PORT}`);
});
