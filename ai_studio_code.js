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
        // Si el Host arranca la partida, la sala ya está en "PLAYING".
        // Ignoramos la petición REST lenta para no aplastar el dado que ya empezó a rodar por WebSocket.
        // Solo permitimos el PUT si es un jugador abandonando la partida (joinedPlayersCount menor).
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

// WEBSOCKETS (Sincronización Pura)
io.on('connection', (socket) => {
    console.log(`Socket conectado: ${socket.id}`);

    // === NUEVO: MEDIDOR DE LATENCIA NATIVA (PING/PONG) ===
    socket.on('latency_ping', (clientTimestamp, callback) => {
        // Si el cliente adjuntó un callback de Acknowledge, lo ejecutamos al instante
        if (typeof callback === 'function') {
            callback();
        }
    });
    // ======================================================

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`Socket ${socket.id} se unió a la sala ${roomId}`);
        
        // ¡SOLUCIÓN AL VALLE DE DESINCRONIZACIÓN (LATE-JOIN)!
        // Si el Host arrancó la partida mientras este socket apenas se estaba conectando,
        // le enviamos el estado "PLAYING" inmediatamente al terminar de conectar.
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
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor Síncrono de Sweety Ludo ejecutándose en puerto ${PORT}`);
});
