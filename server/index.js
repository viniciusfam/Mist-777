/**
 * index.js — Blackjack 21 PvP Server
 * Express + Socket.IO entry point.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');

const {
  createRoom,
  getRoom,
  getPublicRooms,
  joinRoom,
  leaveRoom,
  startGame,
  playerAction,
  resetRoom,
  getRoomState,
} = require('./roomManager');

const app = express();

// --- Production Optimizations ---
app.use(compression()); // Gzip/Brotli compression for fast network loading
app.use(helmet({
  contentSecurityPolicy: false, // Disabled to allow inline scripts/styles for this basic SPA
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// Serve static frontend files (Caching de 1 dia ativado para Produção)
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '1d'
}));

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Track socket → { nick, roomCode }
const socketInfo = new Map();

/**
 * Emits current game state to all players in a room.
 * Also broadcasts updated lobby to everyone.
 */
function emitGameUpdate(room) {
  const state = getRoomState(room);
  io.to(room.code).emit('game_update', state);

  if (room.state === 'finished') {
    io.to(room.code).emit('game_over', state);
  }

  // Update lobby for everyone
  io.emit('lobby_update', getPublicRooms());
}

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // --- Nick Registration ---
  socket.on('set_nick', (nick, callback) => {
    if (!nick || typeof nick !== 'string' || nick.trim().length < 2) {
      return callback?.({ error: 'Nick deve ter pelo menos 2 caracteres.' });
    }
    const cleanNick = nick.trim().substring(0, 20);
    socketInfo.set(socket.id, { nick: cleanNick, roomCode: null });
    console.log(`[Nick] ${socket.id} → ${cleanNick}`);
    callback?.({ ok: true, nick: cleanNick });
  });

  // --- Get Lobby List ---
  socket.on('get_rooms', (callback) => {
    callback?.(getPublicRooms());
  });

  // --- Create Room ---
  socket.on('create_room', ({ name, ryoAmount }, callback) => {
    const info = socketInfo.get(socket.id);
    if (!info?.nick) return callback?.({ error: 'Defina seu nick primeiro.' });
    if (!name || name.trim().length < 2) return callback?.({ error: 'Nome da sala inválido.' });

    const room = createRoom(name, ryoAmount, { id: socket.id, nick: info.nick });
    info.roomCode = room.code;
    socket.join(room.code);

    console.log(`[Room] Created: ${room.code} "${room.name}" by ${info.nick}`);
    io.emit('lobby_update', getPublicRooms());
    callback?.({ ok: true, room: getRoomState(room) });
  });

  // --- Join Room ---
  socket.on('join_room', (code, callback) => {
    const info = socketInfo.get(socket.id);
    if (!info?.nick) return callback?.({ error: 'Defina seu nick primeiro.' });

    const result = joinRoom(code, { id: socket.id, nick: info.nick });

    if (typeof result === 'string') {
      const errors = {
        ROOM_NOT_FOUND: 'Sala não encontrada.',
        GAME_IN_PROGRESS: 'Partida já em andamento.',
        ROOM_FULL: 'Sala cheia.',
      };
      return callback?.({ error: errors[result] || result });
    }

    info.roomCode = result.code;
    socket.join(result.code);

    console.log(`[Room] ${info.nick} joined ${result.code}`);
    const state = getRoomState(result);
    io.to(result.code).emit('game_update', state);
    io.emit('lobby_update', getPublicRooms());
    callback?.({ ok: true, room: state });
  });

  // --- Start Game ---
  socket.on('start_game', (callback) => {
    const info = socketInfo.get(socket.id);
    if (!info?.roomCode) return callback?.({ error: 'Você não está em uma sala.' });

    const result = startGame(info.roomCode, socket.id, emitGameUpdate);

    if (typeof result === 'string') {
      const errors = {
        ROOM_NOT_FOUND: 'Sala não encontrada.',
        NOT_CREATOR: 'Apenas o criador pode iniciar.',
        ALREADY_STARTED: 'Partida já iniciada.',
        NOT_ENOUGH_PLAYERS: `Mínimo de 2 jogadores necessário.`,
      };
      return callback?.({ error: errors[result] || result });
    }

    console.log(`[Game] Started in ${info.roomCode}`);
    callback?.({ ok: true });
    io.emit('lobby_update', getPublicRooms());
  });

  // --- Player Action (Hit / Stand) ---
  socket.on('player_action', ({ action }, callback) => {
    const info = socketInfo.get(socket.id);
    if (!info?.roomCode) return callback?.({ error: 'Você não está em uma sala.' });
    if (!['hit', 'stand'].includes(action)) return callback?.({ error: 'Ação inválida.' });

    const result = playerAction(info.roomCode, socket.id, action, emitGameUpdate);

    if (typeof result === 'string') {
      return callback?.({ error: result === 'NOT_YOUR_TURN' ? 'Não é seu turno.' : result });
    }

    // NOTE: emitGameUpdate is already called inside playerAction → setActivePlayer.
    // Do NOT call it again here — that caused double renders and turn confusion.
    callback?.({ ok: true });
  });

  // --- Play Again (Reset Room) ---
  socket.on('play_again', (callback) => {
    const info = socketInfo.get(socket.id);
    if (!info?.roomCode) return callback?.({ error: 'Você não está em uma sala.' });

    const room = getRoom(info.roomCode);
    if (!room) return callback?.({ error: 'Sala não encontrada.' });
    if (room.creatorId !== socket.id) return callback?.({ error: 'Apenas o criador pode reiniciar.' });

    const updated = resetRoom(info.roomCode);
    if (!updated) return callback?.({ error: 'Não foi possível reiniciar.' });

    io.to(updated.code).emit('game_update', getRoomState(updated));
    io.emit('lobby_update', getPublicRooms());
    callback?.({ ok: true });
  });

  // --- Leave Room ---
  socket.on('leave_room', (callback) => {
    handleLeave(socket);
    callback?.({ ok: true });
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    handleLeave(socket);
    socketInfo.delete(socket.id);
  });

  function handleLeave(socket) {
    const info = socketInfo.get(socket.id);
    if (!info?.roomCode) return;

    const updated = leaveRoom(info.roomCode, socket.id, emitGameUpdate);
    socket.leave(info.roomCode);
    info.roomCode = null;

    if (updated) {
      io.to(updated.code).emit('game_update', getRoomState(updated));
    }
    io.emit('lobby_update', getPublicRooms());
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🃏 Blackjack 21 PvP — Server running at http://localhost:${PORT}\n`);
});
