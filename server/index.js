/**
 * index.js — Cassino Central (Blackjack + Poker)
 * Express + Socket.IO entry point.
 */

// CRASH PROTECTION: Never let the server die from an uncaught error
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception — server stayed alive:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled Rejection — server stayed alive:', err);
});

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
  addChips,
} = require('./roomManager');

const { createPokerRound, processAction, SMALL_BLIND, BIG_BLIND } = require('./pokerLogic');

const app = express();

// --- Production Optimizations ---
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve static files
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Track socket → { nick, roomCode }
const socketInfo = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emitGameUpdate(room) {
  const state = getRoomState(room);
  io.to(room.code).emit('game_update', state);
  if (room.state === 'finished') io.to(room.code).emit('game_over', state);
  io.emit('lobby_update', getPublicRooms());
}

function emitPokerUpdate(room) {
  const pr = room.pokerRound;
  if (!pr) return;
  const base = {
    code: room.code,
    name: room.name,
    gameType: 'poker',
    creatorId: room.creatorId,
    state: room.state,
    round: room.round,
    dealerIndex: room.dealerIndex,
    phase: pr.phase,
    pot: pr.pot,
    currentBet: pr.currentBet,
    communityCards: pr.communityCards,
    sidePots: pr.sidePots || [],
    payouts: pr.payouts || {},
    evaluations: pr.evaluations || [],
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    sbIndex: pr.sbIndex,
    bbIndex: pr.bbIndex,
    activePlayerIndex: pr.activePlayerIndex,
    pokerTurnStart: room.pokerTurnStart || null,
    players: pr.players.map((p, i) => ({
      id: p.id,
      nick: p.nick,
      chips: p.chips,
      bet: p.bet,
      totalBet: p.totalBet,
      status: p.status,
      lastAction: p.lastAction,
      isDealer: i === (room.dealerIndex % pr.players.length),
      isSB: i === pr.sbIndex,
      isBB: i === pr.bbIndex,
      isActive: i === pr.activePlayerIndex,
      hand: pr.phase === 'showdown' ? p.hand : [],
    })),
  };

  // Send to each player with their private hole cards
  for (const p of pr.players) {
    io.to(p.id).emit('poker_update', { ...base, myHand: p.hand });
  }

  io.emit('lobby_update', getPublicRooms());
}

// ─── Poker Round Management ───────────────────────────────────────────────────

const pokerTimers = new Map();

function schedulePokerTimer(room) {
  clearPokerTimer(room.code);
  const pr = room.pokerRound;
  if (!pr || pr.phase === 'showdown') return;
  const activePlayer = pr.players[pr.activePlayerIndex];
  if (!activePlayer || activePlayer.status !== 'active') return;

  room.pokerTurnStart = Date.now();
  pokerTimers.set(room.code, setTimeout(() => {
    try {
      room.pokerRound = processAction(room.pokerRound, activePlayer.id, 'fold');
      if (room.pokerRound.phase === 'showdown') finishPokerRound(room);
      else { schedulePokerTimer(room); emitPokerUpdate(room); }
    } catch (_) { /* ignore */ }
  }, 30000));
}

function clearPokerTimer(code) {
  if (pokerTimers.has(code)) { clearTimeout(pokerTimers.get(code)); pokerTimers.delete(code); }
}

function startPokerRound(room) {
  room.state = 'playing';
  room.round++;
  const active = room.players.filter(p => !p.disconnected && p.chips > 0);
  if (active.length < 2) { room.state = 'waiting'; emitGameUpdate(room); return; }

  room.pokerRound = createPokerRound(
    active.map(p => ({ id: p.id, nick: p.nick, chips: p.chips, disconnected: false })),
    room.dealerIndex % active.length
  );
  schedulePokerTimer(room);
  emitPokerUpdate(room);
}

function finishPokerRound(room) {
  clearPokerTimer(room.code);
  const pr = room.pokerRound;

  // Sync chips back to room.players
  for (const rp of pr.players) {
    const roomPlayer = room.players.find(p => p.id === rp.id);
    if (roomPlayer) {
      roomPlayer.chips = rp.chips;
      roomPlayer.sessionBalance = (roomPlayer.sessionBalance || 0) + ((pr.payouts?.[rp.id] || 0) - rp.totalBet);
    }
  }

  room.state = 'finished';
  emitPokerUpdate(room);

  // Auto-return to waiting after 8s
  setTimeout(() => {
    if (!getRoom(room.code)) return;
    const remaining = room.players.filter(p => !p.disconnected && p.chips > 0);
    room.dealerIndex = (room.dealerIndex + 1) % Math.max(1, remaining.length);
    room.state = 'waiting';
    room.pokerRound = null;
    emitGameUpdate(room);
  }, 8000);
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('set_nick', (nick, callback) => {
    if (!nick || typeof nick !== 'string' || nick.trim().length < 2)
      return callback?.({ error: 'Nick deve ter pelo menos 2 caracteres.' });
    const cleanNick = nick.trim().substring(0, 20);
    socketInfo.set(socket.id, { nick: cleanNick, roomCode: null });
    callback?.({ ok: true, nick: cleanNick });
  });

  socket.on('get_rooms', (callback) => callback?.(getPublicRooms()));

  socket.on('create_room', ({ name, ryoAmount, gameType = 'blackjack' }, callback) => {
    const info = socketInfo.get(socket.id);
    if (!info?.nick) return callback?.({ error: 'Defina seu nick primeiro.' });
    if (!name || name.trim().length < 2) return callback?.({ error: 'Nome da sala inválido.' });
    const room = createRoom(name, ryoAmount, { id: socket.id, nick: info.nick }, gameType);
    info.roomCode = room.code;
    socket.join(room.code);
    console.log(`[Room] Created: ${room.code} "${room.name}" [${gameType}] by ${info.nick}`);
    io.emit('lobby_update', getPublicRooms());
    callback?.({ ok: true, room: getRoomState(room) });
  });

  socket.on('join_room', (code, callback) => {
    const info = socketInfo.get(socket.id);
    if (!info?.nick) return callback?.({ error: 'Defina seu nick primeiro.' });
    const result = joinRoom(code, { id: socket.id, nick: info.nick });
    if (typeof result === 'string') {
      const errs = { ROOM_NOT_FOUND: 'Sala não encontrada.', GAME_IN_PROGRESS: 'Partida já em andamento.', ROOM_FULL: 'Sala cheia.' };
      return callback?.({ error: errs[result] || result });
    }
    info.roomCode = result.code;
    socket.join(result.code);
    console.log(`[Join] ${info.nick} joined ${result.code} (gameType=${result.gameType}, state=${result.state}, pokerRound=${!!result.pokerRound})`);
    
    // If a poker round is active, send poker_update (with private hand) to this specific player
    if (result.gameType === 'poker' && result.pokerRound) {
      emitPokerUpdate(result);
    } else {
      const state = getRoomState(result);
      io.to(result.code).emit('game_update', state);
    }
    io.emit('lobby_update', getPublicRooms());
    callback?.({ ok: true, room: getRoomState(result) });
  });

  socket.on('start_game', (callback) => {
    const info = socketInfo.get(socket.id);
    if (!info?.roomCode) return callback?.({ error: 'Você não está em uma sala.' });
    const room = getRoom(info.roomCode);
    if (!room) return callback?.({ error: 'Sala não encontrada.' });
    if (room.creatorId !== socket.id) return callback?.({ error: 'Apenas o criador pode iniciar.' });

    if (room.gameType === 'poker') {
      try {
        const active = room.players.filter(p => !p.disconnected && p.chips > 0);
        if (active.length < 2) return callback?.({ error: 'Mínimo 2 jogadores com fichas para iniciar.' });
        startPokerRound(room);
        return callback?.({ ok: true });
      } catch (err) {
        console.error('[Start Poker Error]:', err);
        return callback?.({ error: `Server crash: ${err.message}` });
      }
    }

    const result = startGame(info.roomCode, socket.id, emitGameUpdate);
    if (typeof result === 'string') {
      const errs = { ROOM_NOT_FOUND: 'Sala não encontrada.', NOT_CREATOR: 'Apenas o criador pode iniciar.', ALREADY_STARTED: 'Partida já iniciada.', NOT_ENOUGH_PLAYERS: 'Mínimo de 2 jogadores necessário.' };
      return callback?.({ error: errs[result] || result });
    }
    callback?.({ ok: true });
    io.emit('lobby_update', getPublicRooms());
  });

  // Blackjack action
  socket.on('player_action', ({ action }, callback) => {
    const info = socketInfo.get(socket.id);
    if (!info?.roomCode) return callback?.({ error: 'Você não está em uma sala.' });
    if (!['hit', 'stand'].includes(action)) return callback?.({ error: 'Ação inválida.' });
    const result = playerAction(info.roomCode, socket.id, action, emitGameUpdate);
    if (typeof result === 'string')
      return callback?.({ error: result === 'NOT_YOUR_TURN' ? 'Não é seu turno.' : result });
    callback?.({ ok: true });
  });

  // Poker action: fold | check | call | raise | allin
  socket.on('poker_action', (actionArg, amountArg, callbackArg) => {
    let action, amount, callback;
    if (typeof actionArg === 'object' && actionArg !== null) {
      action = actionArg.action;
      amount = actionArg.amount;
      callback = amountArg;
    } else {
      action = actionArg;
      amount = amountArg;
      callback = callbackArg;
    }

    const info = socketInfo.get(socket.id);
    if (!info?.roomCode) return callback?.({ error: 'Você não está em uma sala.' });
    const room = getRoom(info.roomCode);
    if (!room?.pokerRound) return callback?.({ error: 'Nenhuma rodada de poker em andamento.' });

    try {
      const pr = room.pokerRound;
      const activeP = pr.players[pr.activePlayerIndex];
      console.log(`[Poker Action] ${info.nick} (${socket.id}) -> ${action} | phase=${pr.phase} activeIdx=${pr.activePlayerIndex} expectedPlayer=${activeP?.nick}(${activeP?.id})`);
      clearPokerTimer(room.code);
      room.pokerRound = processAction(room.pokerRound, socket.id, action, amount || 0);
      console.log(`[Poker Action] Result: phase=${room.pokerRound.phase} activeIdx=${room.pokerRound.activePlayerIndex}`);
      if (room.pokerRound.phase === 'showdown') finishPokerRound(room);
      else { schedulePokerTimer(room); emitPokerUpdate(room); }
      callback?.({ ok: true });
    } catch (err) {
      console.log(`[Poker Action ERROR] ${info.nick}: ${err.message}`);
      callback?.({ error: err.message });
    }
  });

  // Treasurer: add chips to a player
  socket.on('add_chips', ({ targetPlayerId, amount }, callback) => {
    const info = socketInfo.get(socket.id);
    if (!info?.roomCode) return callback?.({ error: 'Você não está em uma sala.' });
    const result = addChips(info.roomCode, socket.id, targetPlayerId, amount);
    if (typeof result === 'string') {
      const errs = { ROOM_NOT_FOUND: 'Sala não encontrada.', NOT_CREATOR: 'Apenas o Tesoureiro pode creditar fichas.', PLAYER_NOT_FOUND: 'Jogador não encontrado.' };
      return callback?.({ error: errs[result] || result });
    }
    io.to(result.code).emit('game_update', getRoomState(result));
    callback?.({ ok: true });
  });

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

  socket.on('leave_room', (callback) => { handleLeave(socket); callback?.({ ok: true }); });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    handleLeave(socket);
    socketInfo.delete(socket.id);
  });

  function handleLeave(socket) {
    const info = socketInfo.get(socket.id);
    if (!info?.roomCode) return;
    const roomCode = info.roomCode;
    const room = getRoom(roomCode);
    const updated = leaveRoom(roomCode, socket.id, emitGameUpdate);
    socket.leave(roomCode);
    info.roomCode = null;
    if (updated) {
      // CRITICAL FIX: If a poker round is active, emit poker_update, NOT game_update
      // game_update causes the client to switch to the blackjack screen, killing the poker game
      if (updated.gameType === 'poker' && updated.pokerRound) {
        console.log(`[Leave] Player left during poker round in room ${roomCode}, emitting poker_update`);
        emitPokerUpdate(updated);
      } else {
        io.to(updated.code).emit('game_update', getRoomState(updated));
      }
    }
    io.emit('lobby_update', getPublicRooms());
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎰 Cassino Central — Server running at http://localhost:${PORT}\n`);
});
