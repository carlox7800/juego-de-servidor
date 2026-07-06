const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    // Pings agresivos para que Render y la red móvil detecten caídas en 10s
    pingInterval: 5000,
    pingTimeout: 5000
});

// Base de datos en memoria
const objectsStore = {};

function generateUniqueRoomId() {
    let roomId;
    do {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    } while (objectsStore[roomId]);
    return roomId;
}

// =========================================================================
// REST API
// =========================================================================

app.get('/objects/:id', (req, res) => {
    const roomId = req.params.id;
    if (objectsStore[roomId]) {
        res.json({ id: roomId, ...objectsStore[roomId] });
    } else {
        res.status(404).json({ error: "Object not found" });
    }
});

app.post('/objects', (req, res) => {
    const requestBody = req.body;
    const roomId = requestBody.id || generateUniqueRoomId();

    const newRoom = {
        id: roomId,
        name: requestBody.name || "Nueva Sala",
        data: requestBody.data || {},
        createdAt: new Date().toISOString()
    };

    objectsStore[roomId] = newRoom;
    res.status(201).json(newRoom);
});

app.put('/objects/:id', (req, res) => {
    const roomId = req.params.id;
    const requestBody = req.body;

    if (objectsStore[roomId]) {
        const currentData = objectsStore[roomId].data || {};
        const newData = requestBody.data || {};

        // ESCUDO ANTI-BLOQUEO: Ignorar escrituras REST que intenten reducir
        // joinedPlayersCount mientras la partida está en curso. Protege los dados.
        if (currentData.status === "PLAYING" && newData.status === "PLAYING") {
            const currentCount = currentData.joinedPlayersCount || 0;
            const newCount = newData.joinedPlayersCount || 0;

            if (newCount >= currentCount) {
                console.log(`[ESCUDO] Petición REST ignorada en sala ${roomId} (protegiendo estado de juego).`);
                return res.json(objectsStore[roomId]);
            }
        }

        const updatedRoom = {
            id: roomId,
            name: requestBody.name || objectsStore[roomId].name,
            data: newData,
            createdAt: objectsStore[roomId].createdAt
        };
        objectsStore[roomId] = updatedRoom;
        
        io.in(roomId).emit('room_state_changed', updatedRoom.data);
        res.json(updatedRoom);
    } else {
        res.status(404).json({ error: "Object not found" });
    }
});

// =========================================================================
// WEBSOCKETS
// =========================================================================

io.on('connection', (socket) => {
    console.log(`[WS] Socket conectado: ${socket.id}`);

    // Medición de latencia (ping/pong)
    socket.on('latency_ping', (clientTimestamp, callback) => {
        if (typeof callback === 'function') {
            callback();
        }
    });

    // Unirse / Reconectarse a una sala
    socket.on('join_room', (payload) => {
        const roomId   = typeof payload === 'string' ? payload : payload.roomId;
        const playerId = typeof payload === 'string' ? null    : payload.playerId;

        socket.join(roomId);

        const room = objectsStore[roomId];
        if (playerId && room && room.data && Array.isArray(room.data.players)) {

            // ================================================================
            // V18.6 - RECONEXIÓN SEGURA POR PLAYER_ID
            // Buscamos si ya existía un registro de este jugador en la sala
            // (puede estar marcado is_connected: false tras una caída de red).
            // ================================================================
            const existingIndex = room.data.players.findIndex(
                p => p.player_id === playerId
            );

            if (existingIndex !== -1) {
                // JUGADOR CONOCIDO: reactivar sin cambiar color ni slotIndex
                const wasConnected = room.data.players[existingIndex].is_connected;
                room.data.players[existingIndex].is_connected = true;

                // Registrar el nuevo socket para eventos futuros de desconexión
                socket.data = { roomId, playerId };

                if (!wasConnected) {
                    console.log(`[RECONEXIÓN V18.6] Jugador ${playerId} volvió a sala ${roomId} (color: ${room.data.players[existingIndex].color}, slot: ${room.data.players[existingIndex].slot_index})`);
                } else {
                    console.log(`[JOIN] Jugador ${playerId} re-emitió join_room en sala ${roomId} (ya conectado).`);
                }

            } else {
                // JUGADOR NUEVO: primera vez en la sala
                console.log(`[JOIN] Nuevo jugador ${playerId} en sala ${roomId}.`);
                socket.data = { roomId, playerId };
                // El cliente Android ya añadió al jugador vía REST antes del socket;
                // no duplicamos el registro, solo guardamos la identidad del socket.
            }

            // Emitir estado actualizado a TODOS los clientes de la sala
            io.in(roomId).emit('room_state_changed', room.data);

        } else {
            // Sin playerId o sala inexistente: emitir estado actual al solicitante
            socket.data = { roomId, playerId };
            if (room) {
                socket.emit('room_state_changed', room.data);
            }
        }
    });

    // Actualización de estado en tiempo real
    socket.on('update_room_state', (payload) => {
        const { roomId, data } = payload;
        if (objectsStore[roomId]) {
            // Reemplazamos la "data" por la nueva enviada desde el Android
            objectsStore[roomId].data = data;
        }
        // Broadcast
        io.in(roomId).emit('room_state_changed', data);
    });

    // Eventos passthrough
    socket.on('chat_message', (data) => {
        if (socket.data && socket.data.roomId) {
            io.to(socket.data.roomId).emit('chat_message', data);
        } else {
            io.emit('chat_message', data);
        }
    });
    
    socket.on('sync_tokens', (data) => {
        if (socket.data && socket.data.roomId) io.to(socket.data.roomId).emit('sync_tokens', data);
    });

    socket.on('sync_turn', (data) => {
        if (socket.data && socket.data.roomId) io.to(socket.data.roomId).emit('sync_turn', data);
    });

    socket.on('sync_dice', (data) => {
        if (socket.data && socket.data.roomId) io.to(socket.data.roomId).emit('sync_dice', data);
    });

    socket.on('sync_highlights', (data) => {
        if (socket.data && socket.data.roomId) io.to(socket.data.roomId).emit('sync_highlights', data);
    });
    
    socket.on('play_capture_effect', () => {
        if (socket.data && socket.data.roomId) io.to(socket.data.roomId).emit('play_capture_effect');
    });

    socket.on('play_crown_effect', () => {
        if (socket.data && socket.data.roomId) io.to(socket.data.roomId).emit('play_crown_effect');
    });

    socket.on('sync_reaction', (data) => {
        if (socket.data && socket.data.roomId) io.to(socket.data.roomId).emit('sync_reaction', data);
    });

    // ================================================================
    // V18.6 - DESCONEXIÓN INTELIGENTE (BANDERAS EN LUGAR DE BORRADO)
    // ================================================================
    socket.on('disconnect', () => {
        const { roomId, playerId } = socket.data || {};
        if (roomId && playerId) {
            const room = objectsStore[roomId];
            
            if (room && room.data && Array.isArray(room.data.players)) {
                
                const playerIndex = room.data.players.findIndex(
                    p => p.player_id === playerId
                );

                if (playerIndex !== -1) {
                    const player = room.data.players[playerIndex];
                    
                    // En lugar de borrar (splice), lo mantenemos en su asiento y 
                    // marcamos is_connected: false.
                    //
                    // Beneficios:
                    // 1. Android sabrá EXACTAMENTE quién se fue sin perder color ni posición.
                    // 2. Android puede iniciar un temporizador de gracia y pasar el turno a un BOT.
                    // 3. Si el jugador se reconecta luego, ocupará el MISMO ASIENTO.
                    room.data.players[playerIndex].is_connected = false;

                    // joinedPlayersCount refleja solo los jugadores activos
                    room.data.joinedPlayersCount = room.data.players.filter(
                        p => p.is_connected === true
                    ).length;
                    
                    io.in(roomId).emit('room_state_changed', room.data);
                    
                    console.log(`[DESCONEXIÓN V18.6] Jugador ${playerId} marcado is_connected=false en sala ${roomId}. Color: ${player.color}, slot: ${player.slot_index}`);

                    // Limpieza diferida de salas completamente vacías
                    setTimeout(() => {
                        const currentRoom = objectsStore[roomId];
                        if (currentRoom && currentRoom.data && Array.isArray(currentRoom.data.players)) {
                            const allDisconnected = currentRoom.data.players.every(
                                p => p.is_connected === false
                            );
                            if (allDisconnected) {
                                console.log(`[LIMPIEZA V18.6] Eliminando sala ${roomId} por inactividad total de 10 segs.`);
                                delete objectsStore[roomId];
                            }
                        }
                    }, 10000);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor Síncrono de Sweety Ludo V18 ejecutándose en puerto ${PORT}`);
});
