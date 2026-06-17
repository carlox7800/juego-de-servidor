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
    const newRoom = req.body;
    objectsStore[newRoom.id] = newRoom;
    res.status(201).json(newRoom);
});

app.put('/objects/:id', (req, res) => {
    const roomId = req.params.id;
    const requestBody = req.body;
    
    if (objectsStore[roomId]) {
        const updatedRoom = {
            id: roomId,
            name: requestBody.name || objectsStore[roomId].name,
            data: requestBody.data || objectsStore[roomId].data,
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

// WEBSOCKETS (Sincronización Pura y Rápida - Single Source of Truth)
io.on('connection', (socket) => {
    console.log(`Socket conectado: ${socket.id}`);

    // Unirse a la sala de Socket.IO
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`Socket ${socket.id} se unió a la sala ${roomId}`);
    });

    // Escuchar actualizaciones de estado de juego directas y rebotarlas
    socket.on('update_room_state', (payload) => {
        const { roomId, data } = payload;
        
        // Sincronizar silenciosamente con el almacenamiento en memoria
        if (objectsStore[roomId]) {
            objectsStore[roomId].data = data;
        }

        // Retransmisión ultrarrápida a todos los clientes (Sin cálculos de motor)
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
