const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    // Versión 18.6 - Pings ultra agresivos para detectar caídas en 9 segundos
    pingInterval: 4000,
    pingTimeout: 5000
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
        res.status(404).json({ error: 'Sala no encontrada' });
    }
});

// --- LÓGICA DE WEBSOCKETS (SALA Y PARTIDA) ---
io.on('connection', (socket) => {
    console.log(`[+] Cliente conectado: ${socket.id}`);

    socket.on('join_room', (data) => {
        let roomId = data.roomId;
        const nickname = data.nickname || "Jugador";
        const playerColor = data.color;
        const playerId = data.playerId || socket.id;

        // Validar límite global de 6 jugadores
        if (roomId && objectsStore[roomId]) {
            const currentPlayersCount = Object.keys(objectsStore[roomId].players || {}).length;
            if (currentPlayersCount >= 6) {
                // Verificar si es una reconexión (si el jugador ya estaba en la sala)
                const existingPlayer = Object.values(objectsStore[roomId].players).find(p => p.playerId === playerId);
                if (!existingPlayer) {
                    socket.emit('room_error', { message: 'La sala está llena (máximo 6 jugadores)' });
                    return;
                }
            }
        }

        if (!roomId) {
            roomId = generateUniqueRoomId();
            objectsStore[roomId] = {
                createdAt: Date.now(),
                players: {}
            };
            console.log(`[SALA] Creada nueva sala: ${roomId}`);
        }

        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerId = playerId;

        if (!objectsStore[roomId]) {
            objectsStore[roomId] = {
                createdAt: Date.now(),
                players: {}
            };
        }

        // Versión 18.6 - Reconexión Inteligente
        // Si el jugador ya existía en la memoria de la sala, actualizar su socketId y marcar is_connected
        const existingPlayerKey = Object.keys(objectsStore[roomId].players).find(
            key => objectsStore[roomId].players[key].playerId === playerId
        );

        if (existingPlayerKey) {
            console.log(`[RECONEXIÓN] Jugador ${nickname} regresó a la sala ${roomId}`);
            objectsStore[roomId].players[existingPlayerKey].socketId = socket.id;
            objectsStore[roomId].players[existingPlayerKey].is_connected = true; // RECONECTADO
        } else {
            // Asignar el primer índice disponible del 0 al 5
            let availableIndex = -1;
            for (let i = 0; i < 6; i++) {
                if (!objectsStore[roomId].players[i]) {
                    availableIndex = i;
                    break;
                }
            }

            if (availableIndex === -1) {
                socket.emit('room_error', { message: 'La sala está llena' });
                return;
            }

            objectsStore[roomId].players[availableIndex] = {
                socketId: socket.id,
                playerId: playerId,
                nickname: nickname,
                color: playerColor,
                slotIndex: availableIndex,
                is_connected: true // JUGADOR NUEVO (CONECTADO)
            };
        }

        // Emitir a todos en la sala el estado actualizado de los jugadores
        io.to(roomId).emit('room_state_changed', objectsStore[roomId].players);
    });

    // Enviar mensaje al chat general o de sala
    socket.on('chat_message', (data) => {
        console.log(`[CHAT] Mensaje recibido en sala ${socket.roomId}:`, data);
        if (socket.roomId) {
            io.to(socket.roomId).emit('chat_message', data);
        } else {
            io.emit('chat_message', data);
        }
    });

    // Compartir la configuración de la partida con todos en la sala
    socket.on('share_match_config', (data) => {
        if (socket.roomId) {
            console.log(`[CONFIG] Compartiendo config en sala ${socket.roomId}`);
            io.to(socket.roomId).emit('match_config_shared', data);
        }
    });

    // Avisar que la partida ha comenzado (para cerrar los lobbys)
    socket.on('start_game', () => {
        if (socket.roomId) {
            console.log(`[GAME] Iniciando partida en sala ${socket.roomId}`);
            io.to(socket.roomId).emit('game_started');
        }
    });

    // --- SINCRONIZACIÓN EN TIEMPO REAL DEL TABLERO ---

    // Sincronizar Fichas (Posición, Progreso)
    socket.on('sync_tokens', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('sync_tokens', data);
        }
    });

    // Sincronizar el Jugador Activo (Turno)
    socket.on('sync_turn', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('sync_turn', data);
        }
    });

    // Sincronizar resultado del Dado
    socket.on('sync_dice', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('sync_dice', data);
        }
    });

    // Sincronizar Fichas Resaltadas (Ayuda visual)
    socket.on('sync_highlights', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('sync_highlights', data);
        }
    });

    // --- EFECTOS VISUALES Y DE SONIDO ---
    
    // Reproducir sonido/efecto de Captura (Comer ficha)
    socket.on('play_capture_effect', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('play_capture_effect');
        }
    });

    // Reproducir sonido/efecto de Coronación (Llegar al centro)
    socket.on('play_crown_effect', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('play_crown_effect');
        }
    });

    // Sincronizar Reacciones/Emojis en el tablero
    socket.on('sync_reaction', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('sync_reaction', data);
        }
    });

    // Versión 18.6 - DESCONEXIÓN INTELIGENTE (is_connected: false)
    socket.on('disconnect', () => {
        console.log(`[-] Cliente desconectado: ${socket.id} (PlayerID: ${socket.playerId})`);
        
        const roomId = socket.roomId;
        if (roomId && objectsStore[roomId]) {
            // Buscar la llave del jugador basándose en su playerId
            const playerKey = Object.keys(objectsStore[roomId].players).find(
                key => objectsStore[roomId].players[key].playerId === socket.playerId
            );

            if (playerKey) {
                console.log(`[SALA] Jugador ${objectsStore[roomId].players[playerKey].nickname} marcado como DESCONECTADO (is_connected = false)`);
                
                // 1. Apagamos la bandera para que Android active el modo bot
                objectsStore[roomId].players[playerKey].is_connected = false;

                // 2. Avisamos inmediatamente a la sala
                io.to(roomId).emit('room_state_changed', objectsStore[roomId].players);
                
                // 3. Programamos la destrucción diferida (10 minutos de limpieza basura)
                // Si la sala está completamente vacía (todos is_connected === false), la borramos después.
                setTimeout(() => {
                    if (objectsStore[roomId]) {
                        const allDisconnected = Object.values(objectsStore[roomId].players).every(p => p.is_connected === false);
                        if (allDisconnected) {
                            console.log(`[LIMPIEZA] Sala ${roomId} eliminada por inactividad total.`);
                            delete objectsStore[roomId];
                        }
                    }
                }, 600000); // 10 minutos
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor Node.js Ludo V18.6 corriendo en el puerto ${PORT}`);
});
