const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);

// === V17.6: ACELERADOR DE HEARTBEAT ===
// Reducimos el tiempo máximo de espera a 9 segundos (4s intervalo + 5s tolerancia)
// Si un teléfono pierde el internet de golpe, el servidor se dará cuenta al instante.
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 4000,
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

// REST API
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
        
        // ESCUDO ANTI-BLOQUEO
        if (currentData.status === "PLAYING" && newData.status === "PLAYING") {
            const currentCount = currentData.joinedPlayersCount || 0;
            const newCount = newData.joinedPlayersCount || 0;
            
            if (newCount >= currentCount) {
                console.log(`Petición REST ignorada en sala ${roomId} para proteger los dados.`);
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

// WEBSOCKETS
io.on('connection', (socket) => {
    console.log(`Socket conectado: ${socket.id}`);

    socket.on('latency_ping', (clientTimestamp, callback) => {
        if (typeof callback === 'function') {
            callback();
        }
    });

    socket.on('join_room', (payload) => {
        const roomId = typeof payload === 'string' ? payload : payload.roomId;
        const playerId = typeof payload === 'string' ? null : payload.playerId;
        
        socket.join(roomId);
        
        if (playerId) {
            console.log(`Socket ${socket.id} se unió a la sala ${roomId} con identidad: ${playerId}`);
            socket.data = { roomId, playerId };
        }
        
        if (objectsStore[roomId]) {
            socket.emit('room_state_changed', objectsStore[roomId].data);
        }
    });

    socket.on('update_room_state', (payload) => {
        const { roomId, data } = payload;
        if (objectsStore[roomId]) {
            objectsStore[roomId].data = data;
        }
        io.in(roomId).emit('room_state_changed', data);
    });

    socket.on('disconnect', () => {
        console.log(`Socket desconectado: ${socket.id}`);
        
        if (socket.data && socket.data.roomId && socket.data.playerId) {
            const { roomId, playerId } = socket.data;
            const room = objectsStore[roomId];
            
            if (room && room.data && room.data.players) {
                // === V17.6: CORRECCIÓN DEL TYPO JSON (player_id) ===
                const playerIndex = room.data.players.findIndex(p => p.player_id === playerId);
                
                if (playerIndex !== -1) {
                    room.data.players.splice(playerIndex, 1);
                    
                    if (room.data.joinedPlayersCount !== undefined) {
                        room.data.joinedPlayersCount = room.data.players.length;
                    }
                    
                    io.in(roomId).emit('room_state_changed', room.data);
                    
                    console.log(`[ESCUDO V17.6] Jugador ${playerId} extraído de sala ${roomId} por caída de red en 9 segs.`);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de Ludo ejecutándose en puerto ${PORT}`);
});
