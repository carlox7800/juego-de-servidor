const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);

// === V21.0: MOTOR AAA AUTORITATIVO (ESTABILIZADO) ===
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
    res.send("Sweety Ludo V21.0 Motor AAA Autoritativo is running.");
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
                targetPlayers: targetPlayers || 2
            };
        }

        const room = rooms[foundRoomId];
        if (!room.players.find(p => p.playerId === playerId)) {
            room.players.push({ 
                playerId, 
                playerName, 
                socketId: socket.id,
                isConnected: true
            });
        }
        
        socket.join(foundRoomId);
        socket.roomId = foundRoomId;

        // V21.0: Broadcast room_updated to all so UI refreshes
        io.in(foundRoomId).emit('room_updated', {
            id: foundRoomId,
            players: room.players,
            targetPlayers: room.targetPlayers
        });

        if (room.players.length === room.targetPlayers) {
            io.in(foundRoomId).emit('match_found', {
                id: foundRoomId,       // CRITICAL FIX V21.0: Android reads getString("id")
                roomId: foundRoomId,   // Keep for fallback
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
            players: [{ 
                playerId, 
                playerName, 
                socketId: socket.id,
                isConnected: true 
            }],
            targetPlayers: targetPlayers || 2
        };
        socket.join(roomId);
        socket.roomId = roomId;
        // V21.0: Send id in private_room_created
        socket.emit('private_room_created', { roomCode: roomId, id: roomId });
        
        // V21.0: Explicitly send room_updated so Host sees themselves
        socket.emit('room_updated', {
            id: roomId,
            players: rooms[roomId].players,
            targetPlayers: rooms[roomId].targetPlayers
        });
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
            room.players.push({ 
                playerId, 
                playerName, 
                socketId: socket.id,
                isConnected: true 
            });
        }
        socket.join(roomCode);
        socket.roomId = roomCode;

        // V21.0: Broadcast room_updated so Host UI refreshes before jumping
        io.in(roomCode).emit('room_updated', {
            id: roomCode,
            players: room.players,
            targetPlayers: room.targetPlayers
        });

        if (room.players.length === room.targetPlayers) {
            io.in(roomCode).emit('match_found', {
                id: roomCode,         // CRITICAL FIX V21.0: Android reads getString("id")
                roomId: roomCode,
                players: room.players
            });
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
        const { roomId, nextTurnId } = payload;
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

    socket.on('disconnect', () => {
        if (socket.roomId && socket.playerId) {
            io.in(socket.roomId).emit('event_player_disconnected', {
                playerId: socket.playerId
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[SERVER] Sweety Ludo WebSocket Server V21.0 (Motor AAA Estabilizado) en puerto ${PORT}`);
});
