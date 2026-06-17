const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Configuración estricta para evitar bloqueos de CORS y Parseo
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Configuración de WebSockets con tiempo de espera generoso para conexiones móviles
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Almacén en memoria (Single Source of Truth de persistencia temporal)
const objectsStore = {};

// ==========================================
// 1. ENDPOINTS REST (Creación, Ingreso y Lectura)
// ==========================================

// Ruta raíz para validación de salud (Health Check) en Render
app.get('/', (req, res) => {
    res.send('Sweety Ludo Server V12.7 - Engine Síncrono Activo');
});

// Crear Sala (Host)
app.post('/objects', (req, res) => {
    try {
        // Genera un código amistoso de 6 dígitos para la UI
        const roomId = Math.floor(100000 + Math.random() * 900000).toString();
        const requestBody = req.body || {};
        
        const newRoom = {
            id: roomId,
            name: requestBody.name || "Sala Ludo",
            data: requestBody.data || {},
            createdAt: new Date().toISOString()
        };
        
        objectsStore[roomId] = newRoom;
        console.log(`[REST] Sala Creada: ${roomId}`);
        res.status(201).json(newRoom);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Obtener Sala (Joiner / Recovery)
app.get('/objects/:id', (req, res) => {
    const roomId = req.params.id;
    if (objectsStore[roomId]) {
        res.status(200).json(objectsStore[roomId]);
    } else {
        res.status(404).json({ error: "Room not found" });
    }
});

// Actualizar Sala vía REST (Usado al unirse o salir de la sala)
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
        
        // Retransmitir automáticamente el nuevo estado a todos los sockets conectados
        io.in(roomId).emit('room_state_changed', updatedRoom.data);
        console.log(`[REST -> SOCKET] Sala ${roomId} actualizada y retransmitida.`);
        
        res.status(200).json(updatedRoom);
    } else {
        res.status(404).json({ error: "Room not found" });
    }
});

// ==========================================
// 2. MOTOR WEBSOCKET (Retransmisor de Tiempo Real)
// ==========================================

io.on('connection', (socket) => {
    console.log(`[SOCKET] Usuario conectado: ${socket.id}`);

    // Unirse al canal de comunicación bidireccional
    socket.on('join_room', (roomId) => {
        if (!roomId) return;
        socket.join(roomId);
        console.log(`[SOCKET] Cliente ${socket.id} unido a la sala: ${roomId}`);
        
        // Empujar el último estado conocido al cliente recién unido
        if (objectsStore[roomId]) {
            socket.emit('room_state_changed', objectsStore[roomId].data);
        }
    });

    // CORAZÓN DEL MOTOR: Actualización súper rápida en tiempo real
    // Recibe dados, movimientos, temporizadores y chat, y lo escupe de inmediato a todos.
    socket.on('update_room_state', (payload) => {
        if (!payload || !payload.roomId || !payload.data) return;
        
        const roomId = payload.roomId;
        const stateData = payload.data;
        
        // Sincronizar el caché REST para que nuevos jugadores o reconexiones vean este estado
        if (objectsStore[roomId]) {
            objectsStore[roomId].data = stateData;
        }

        // Emitir a todos en la sala (incluyendo a quien lo envió, para cerrar su ciclo local)
        io.in(roomId).emit('room_state_changed', stateData);
    });

    // Eventos genéricos para escalabilidad
    socket.on('send_emote', (payload) => {
        if (payload && payload.roomId && payload.data) {
            io.in(payload.roomId).emit('receive_emote', payload.data);
        }
    });

    socket.on('request_rematch', (payload) => {
        if (payload && payload.roomId && payload.data) {
            io.in(payload.roomId).emit('rematch_requested', payload.data);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[SOCKET] Usuario desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sweety Ludo Backend V12.7 - Inicializado y escuchando en el puerto ${PORT}`);
});
