const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// Configuración básica
app.use(cors());
app.use(bodyParser.json());

// Base de datos temporal en memoria (RAM)
// Almacena las salas creadas por los jugadores
const memoryDatabase = {};

// 1. CREAR SALA (Android hace un POST a /objects)
app.post('/objects', (req, res) => {
    const requestData = req.body;
    
    // El juego envía la estructura con un objeto "data" que contiene el estado.
    // Buscamos el room_code proporcionado por Android, o lo extraemos del título.
    let roomId = requestData.data?.room_code;
    
    if (!roomId && requestData.name) {
        roomId = requestData.name.replace('LudoRoomV3_', '');
    }

    if (!roomId) {
        // Genera un código de 6 dígitos seguro por si acaso
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
    }

    // Guarda el estado de la sala bajo su ID de 6 dígitos
    memoryDatabase[roomId] = {
        id: roomId, // ¡Clave crítica para que joinOnlineMatch funcione!
        name: requestData.name || `LudoRoomV3_${roomId}`,
        data: requestData.data,
        createdAt: new Date().toISOString()
    };

    console.log(`[🚀 EVENTO] Sala Pública/Privada Creada: ${roomId}`);
    
    // Se devuelve la estructura exacta que Retrofit/Moshi espera
    res.json(memoryDatabase[roomId]);
});

// 2. OBTENER SALA (Android hace GET a /objects/:id para unirse o para actualizarse)
app.get('/objects/:id', (req, res) => {
    const roomId = req.params.id;
    const room = memoryDatabase[roomId];

    if (room) {
        res.json(room);
    } else {
        res.status(404).json({ error: `La sala ${roomId} no fue encontrada en el servidor.` });
    }
});

// 3. ACTUALIZAR SALA (Android hace PUT a /objects/:id cuando tira el dado o mueve ficha)
app.put('/objects/:id', (req, res) => {
    const roomId = req.params.id;
    const requestData = req.body;

    if (memoryDatabase[roomId]) {
        // Actualiza master logic con los movimientos enviados desde el cliente
        memoryDatabase[roomId].data = requestData.data;
        
        // Log ligero para ver la actividad sin saturar la consola
        console.log(`[♻️ EVENTO] Sala Actualizada por cliente: ${roomId} -> Turno: ${requestData.data.turn_controller?.current_turn_slot_index}`);
        
        res.json(memoryDatabase[roomId]);
    } else {
        res.status(404).json({ error: `Error de Sincronización: La sala ${roomId} no existe.` });
    }
});

// Arrancar el Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🎲 SERVIDOR LUDO INICIADO CORRIECTAMENTE 🎲`);
    console.log(`=========================================`);
    console.log(`🟢 Puerto de escucha: ${PORT}`);
    console.log(`🌐 Cuando subas esto a Render, pega esa URL en tu 'MultiplayerManager.kt'`);
});
