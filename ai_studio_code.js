const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 4000,
    pingTimeout: 5000
});

// Base de datos en memoria (Simulando REST)
const objectsStore = {};

function generateUniqueRoomId() {
    let roomId;
    do {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    } while (objectsStore[roomId]);
    return roomId;
}

// --- API REST PARA CREAR Y UNIR SALAS ---
app.get('/', (req, res) => {
    res.send("Ludo Server V18.9 is running");
});

app.post('/objects', (req, res) => {
    const roomId = generateUniqueRoomId();
    objectsStore[roomId] = {
        id: roomId,
        name: req.body.name || "",
        data: req.body.data || {}
    };
    console.log(`[REST] Sala creada: ${roomId}`);
    res.json(objectsStore[roomId]);
});

app.get('/objects/:id', (req, res) => {
    const roomId = req.params.id;
    if (objectsStore[roomId]) {
        res.json(objectsStore[roomId]);
    } else {
        res.status(404).json({ error: 'Sala no encontrada' });
    }
});

app.put('/objects/:id', (req, res) => {
    const roomId = req.params.id;
    if (objectsStore[roomId]) {
        objectsStore[roomId].name = req.body.name !== undefined ? req.body.name : objectsStore[roomId].name;
        objectsStore[roomId].data = req.body.data !== undefined ? req.body.data : objectsStore[roomId].data;
        console.log(`[REST] Sala actualizada vía PUT: ${roomId}`);
        
        // ¡LA PIEZA FALTANTE! Avisar a todos los sockets que el estado cambió (Ej: Alguien se unió)
        io.to(roomId).emit('room_state_changed', objectsStore[roomId].data);
        
        res.json(objectsStore[roomId]);
    } else {
        res.status(404).json({ error: 'Sala no encontrada' });
    }
});

// --- LÓGICA DE WEBSOCKETS (SALA Y PARTIDA) ---
io.on('connection', (socket) => {
    console.log(`[+] Cliente conectado: ${socket.id}`);

    socket.on('join_room', (payload) => {
        const roomId = payload.roomId;
        const playerId = payload.playerId;
        
        socket.roomId = roomId;
        socket.playerId = playerId;
        socket.join(roomId);

        console.log(`[SOCKET] ${playerId} se unió a la sala ${roomId}`);

        // Reconexión: Si el jugador ya existe en data.players, marcar isConnected = true
        if (roomId && objectsStore[roomId] && objectsStore[roomId].data && objectsStore[roomId].data.players) {
            let updated = false;
            objectsStore[roomId].data.players.forEach(p => {
                if (p.playerId === playerId) {
                    p.isConnected = true;
                    updated = true;
                }
            });
            if (updated) {
                console.log(`[RECONEXIÓN] Marcando isConnected=true para ${playerId}`);
                io.to(roomId).emit('room_state_changed', objectsStore[roomId].data);
            }
        }
    });

    // Android usa este evento para empujar cambios del tablero a todos los demás
    socket.on('update_room_state', (payload) => {
        const roomId = payload.roomId;
        if (roomId && objectsStore[roomId]) {
            objectsStore[roomId].data = payload.data;
            io.to(roomId).emit('room_state_changed', objectsStore[roomId].data);
        }
    });

    // --- EVENTOS PASSTHROUGH (Chat, Dados, Efectos) ---
    socket.on('chat_message', (data) => {
        if (socket.roomId) io.to(socket.roomId).emit('chat_message', data);
        else io.emit('chat_message', data);
    });
    
    socket.on('sync_tokens', (data) => {
        if (socket.roomId) socket.to(socket.roomId).emit('sync_tokens', data);
    });

    socket.on('sync_turn', (data) => {
        if (socket.roomId) socket.to(socket.roomId).emit('sync_turn', data);
    });

    socket.on('sync_dice', (data) => {
        if (socket.roomId) socket.to(socket.roomId).emit('sync_dice', data);
    });

    socket.on('sync_highlights', (data) => {
        if (socket.roomId) socket.to(socket.roomId).emit('sync_highlights', data);
    });

    socket.on('play_capture_effect', () => {
        if (socket.roomId) socket.to(socket.roomId).emit('play_capture_effect');
    });

    socket.on('play_crown_effect', () => {
        if (socket.roomId) socket.to(socket.roomId).emit('play_crown_effect');
    });

    socket.on('sync_reaction', (data) => {
        if (socket.roomId) socket.to(socket.roomId).emit('sync_reaction', data);
    });

    socket.on('latency_ping', (start, callback) => {
        callback();
    });

    // --- INTELIGENCIA DE DESCONEXIÓN PARA BOTS ---
    socket.on('disconnect', () => {
        console.log(`[-] Cliente desconectado: ${socket.id} (PlayerID: ${socket.playerId})`);
        const roomId = socket.roomId;
        
        if (roomId && objectsStore[roomId] && objectsStore[roomId].data && objectsStore[roomId].data.players) {
            let updated = false;
            objectsStore[roomId].data.players.forEach(p => {
                if (p.playerId === socket.playerId) {
                    p.isConnected = false;
                    updated = true;
                }
            });
            
            if (updated) {
                console.log(`[DESCONEXIÓN] Marcando isConnected=false para ${socket.playerId}`);
                io.to(roomId).emit('room_state_changed', objectsStore[roomId].data);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor Node.js Ludo V18.9 corriendo en el puerto ${PORT}`);
});
