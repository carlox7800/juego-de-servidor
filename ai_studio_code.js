const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();

// Configuración de CORS compartida
app.use(cors());
app.use(bodyParser.json());

// Crear servidor HTTP nativo para envolver Express y Socket.io
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT"]
    }
});

// Base de datos temporal en memoria (RAM)
const memoryDatabase = {};

// ==========================================
// 🔌 ARQUITECTURA WEBSOCKETS (TIEMPO REAL)
// ==========================================
io.on('connection', (socket) => {
    console.log(`[🔌 RED] Dispositivo conectado: ${socket.id}`);

    // Unirse a una sala específica de Ludo
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`[🚪 ROOM] Cliente ${socket.id} se unió al canal de la sala: ${roomId}`);
        
        // ¡CORRECCIÓN!: Enviar solo el .data para que el teléfono lo pueda leer sin errores
        if (memoryDatabase[roomId]) {
            io.to(roomId).emit('room_state_changed', memoryDatabase[roomId].data);
            console.log(`[⚡ WEBSOCKET] ¡Aviso de entrada enviado a toda la sala ${roomId}!`);
        }
    });

    // Escuchar actualizaciones en tiempo real (Dados, Turnos, Movimientos)
    socket.on('update_room_state', (payload) => {
        const { roomId, data } = payload;
        
        if (memoryDatabase[roomId]) {
            memoryDatabase[roomId].data = data;
            
            // ¡CORRECCIÓN!: Enviar solo el .data para que el teléfono lo pueda leer sin errores
            socket.to(roomId).emit('room_state_changed', memoryDatabase[roomId].data);
            console.log(`[⚡ WEBSOCKET] Estado redistribuido al instante en sala: ${roomId}`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[❌ RED] Dispositivo desconectado: ${socket.id}`);
    });
});

// ==========================================
// 🌐 RUTAS HTTP TRADICIONALES (RETROCOMPATIBLES)
// ==========================================

// 1. CREAR SALA
app.post('/objects', (req, res) => {
    const requestData = req.body;
    let roomId = requestData.data?.room_code;
    
    if (!roomId && requestData.name) {
        roomId = requestData.name.replace('LudoRoomV3_', '');
    }
    if (!roomId) {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    }

    memoryDatabase[roomId] = {
        id: roomId,
        name: requestData.name || `LudoRoomV3_${roomId}`,
        data: requestData.data,
        createdAt: new Date().toISOString()
    };

    console.log(`[🚀 HTTP] Sala Creada mediante POST: ${roomId}`);
    res.json(memoryDatabase[roomId]);
});

// 2. OBTENER SALA
app.get('/objects/:id', (req, res) => {
    const roomId = req.params.id;
    const room = memoryDatabase[roomId];
    if (room) {
        res.json(room);
    } else {
        res.status(404).json({ error: `La sala ${roomId} no existe.` });
    }
});

// 3. ACTUALIZAR SALA
app.put('/objects/:id', (req, res) => {
    const roomId = req.params.id;
    const requestData = req.body;

    if (memoryDatabase[roomId]) {
        memoryDatabase[roomId].data = requestData.data;
        
        // ¡CORRECCIÓN!: Sincroniza enviando solo el .data vía WebSockets
        io.to(roomId).emit('room_state_changed', memoryDatabase[roomId].data);
        
        console.log(`[♻️ HTTP] Sala Actualizada vía PUT: ${roomId}`);
        res.json(memoryDatabase[roomId]);
    } else {
        res.status(404).json({ error: `La sala ${roomId} no existe.` });
    }
});

// Arrancar el Servidor usando "server.listen" en lugar de "app.listen"
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`⚡ MOTOR REAL-TIME SOCKET.IO ACTIVO ⚡`);
    console.log(`=========================================`);
    console.log(`🟢 Puerto de escucha: ${PORT}`);
});
