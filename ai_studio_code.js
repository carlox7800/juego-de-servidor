const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Base de datos en memoria
const objectsStore = {};

// FUNCIÓN AUXILIAR: Generar PIN de 6 dígitos único en el servidor
function generateUniqueRoomId() {
    let roomId;
    do {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    } while (objectsStore[roomId]);
    return roomId;
}

// REST API para inicialización
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
    
    // El servidor genera el ID de forma autónoma si no viene uno válido desde el cliente
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
        
        // ESCUDO ANTI-BLOQUEO:
        if (currentData.status === "PLAYING" && newData.status === "PLAYING") {
            const currentCount = currentData.joinedPlayersCount || 0;
            const newCount = newData.joinedPlayersCount || 0;
            
            if (newCount >= currentCount) {
                console.log(`Petición REST ignorada en sala ${roomId} para proteger los dados del Host.`);
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
        
        // Retransmitir automáticamente el nuevo estado inicial a todos los sockets
        io.in(roomId).emit('room_state_changed', updatedRoom.data);
        res.json(updatedRoom);
    } else {
        res.status(404).json({ error: "Object not found" });
    }
});

// WEBSOCKETS (Sincronización Pura y Detección de Caídas)
io.on('connection', (socket) => {
    console.log(`Socket conectado: ${socket.id}`);

    // === MEDIDOR DE LATENCIA NATIVA (PING/PONG) ===
    socket.on('latency_ping', (clientTimestamp, callback) => {
        // Si el cliente adjuntó un callback de Acknowledge, lo ejecutamos al instante
        if (typeof callback === 'function') {
            callback();
        }
    });
    // ==============================================

    // === V17.5: JOIN ROOM CON IDENTIDAD ===
    socket.on('join_room', (payload) => {
        // Compatibilidad híbrida: Extrae roomId y playerId si el cliente está actualizado (V17.5)
        const roomId = typeof payload === 'string' ? payload : payload.roomId;
        const playerId = typeof payload === 'string' ? null : payload.playerId;
        
        socket.join(roomId);
        
        if (playerId) {
            console.log(`Socket ${socket.id} se unió a la sala ${roomId} con identidad de jugador: ${playerId}`);
            // Guardar identidad en la memoria del socket
            socket.data = { roomId, playerId };
        } else {
            console.log(`Socket ${socket.id} se unió a la sala ${roomId} sin identidad (Legacy)`);
        }
        
        // ¡SOLUCIÓN AL VALLE DE DESINCRONIZACIÓN (LATE-JOIN)!
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

    // === V17.5: INTELIGENCIA DE DESCONEXIÓN ABRUPTA ===
    socket.on('disconnect', () => {
        console.log(`Socket desconectado: ${socket.id}`);
        
        // Si el socket tenía una identidad registrada al unirse
        if (socket.data && socket.data.roomId && socket.data.playerId) {
            const { roomId, playerId } = socket.data;
            const room = objectsStore[roomId];
            
            // Si la sala y la lista de jugadores existen
            if (room && room.data && room.data.players) {
                // Buscamos si el jugador desconectado sigue en la sala
                const playerIndex = room.data.players.findIndex(p => p.playerId === playerId);
                
                if (playerIndex !== -1) {
                    // 1. Lo extraemos forzosamente de la lista
                    room.data.players.splice(playerIndex, 1);
                    
                    // 2. Mantenemos el contador de sala sincronizado
                    if (room.data.joinedPlayersCount !== undefined) {
                        room.data.joinedPlayersCount = room.data.players.length;
                    }
                    
                    // 3. Avisamos DE INMEDIATO a los teléfonos sobrevivientes
                    io.in(roomId).emit('room_state_changed', room.data);
                    
                    console.log(`[ESCUDO V17.5] Jugador ${playerId} extraído automáticamente de sala ${roomId} por caída de red. Servidor notificó al resto.`);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor Síncrono de Sweety Ludo ejecutándose en puerto ${PORT}`);
});
