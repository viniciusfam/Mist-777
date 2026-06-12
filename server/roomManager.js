/**
 * roomManager.js — Blackjack 21 PvP
 * Manages room lifecycle, player state, game flow, and turn timers.
 */

const {
  createShoe,
  drawCard,
  calculateHandValue,
  isNaturalBlackjack,
  runDealerTurn,
  evaluateResults,
} = require('./gameLogic');

const rooms = new Map(); // roomCode → Room object

const TURN_TIMEOUT_MS = 15000; // 15 seconds per turn
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

/**
 * Generates a short alphanumeric room code (6 chars).
 */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

/**
 * Creates a new room.
 * @param {string} name - Display name of the room
 * @param {string} ryoAmount - Ryo value per player (display only)
 * @param {Object} creator - { id, nick }
 * @returns {Object} Room object
 */
function createRoom(name, ryoAmount, creator) {
  const code = generateRoomCode();
  const room = {
    code,
    name: name.substring(0, 20),
    ryoAmount: parseInt(ryoAmount) || 1,
    accumulatedPot: 0,
    creatorId: creator.id,
    state: 'waiting', // waiting | playing | dealer_turn | finished
    players: [
      {
        id: creator.id,
        nick: creator.nick,
        hand: [],
        status: 'waiting', // waiting | playing | stand | bust | blackjack | done
        isActive: false,
      },
    ],
    dealerHand: [],
    shoe: createShoe(),
    currentPlayerIndex: 0,
    turnTimer: null,
    round: 0,
    results: null,
    createdAt: Date.now(),
  };

  rooms.set(code, room);
  return room;
}

/**
 * Gets a room by code (case-insensitive).
 */
function getRoom(code) {
  return rooms.get(code?.toUpperCase()) || null;
}

/**
 * Returns all rooms in waiting state (for lobby listing).
 */
function getPublicRooms() {
  return Array.from(rooms.values())
    .filter(r => r.state === 'waiting')
    .map(r => ({
      code: r.code,
      name: r.name,
      ryoAmount: r.ryoAmount,
      players: r.players.length,
      maxPlayers: MAX_PLAYERS,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Adds a player to a room.
 * @returns {Object|string} Updated room or error string
 */
function joinRoom(code, player) {
  const room = getRoom(code);
  if (!room) return 'ROOM_NOT_FOUND';
  if (room.state !== 'waiting') return 'GAME_IN_PROGRESS';
  if (room.players.length >= MAX_PLAYERS) return 'ROOM_FULL';
  if (room.players.find(p => p.id === player.id)) return room; // already in room

    id: player.id,
    nick: player.nick,
    hand: [],
    status: 'waiting',
    isActive: false,
    sessionBalance: 0,
    disconnected: false,
  });

  return room;
}

/**
 * Removes a player from a room.
 * - waiting  → remove from list, transfer creator if needed
 * - playing  → mark as disconnected, advance turn if needed
 * - finished → remove from list, transfer creator if needed, emit update
 */
function leaveRoom(code, playerId, emitGameUpdate) {
  const room = getRoom(code);
  if (!room) return null;
  const player = room.players.find(p => p.id === playerId);
  if (player) {
    player.status = 'disconnected';
    player.disconnected = true;
  }

  // Se todos os jogadores da sala estiverem desconectados, deleta a sala
  const activePlayers = room.players.filter(p => !p.disconnected);
  if (activePlayers.length === 0) {
    clearTurnTimer(room);
    rooms.delete(code);
    return null;
  }

  if (room.state === 'waiting' || room.state === 'finished') {
    // Transfer creator role if needed
    if (room.creatorId === playerId && activePlayers.length > 0) {
      room.creatorId = activePlayers[0].id;
    }
  } else if (room.state === 'playing') {
    // Se for o turno do jogador, avança
    const currentActivePlayer = room.players[room.currentPlayerIndex];
    if (currentActivePlayer && currentActivePlayer.id === playerId) {
      clearTurnTimer(room);
      setActivePlayer(room, emitGameUpdate);
    } else {
      emitGameUpdate(room);
    }
  }

  return room;
}

/**
 * Starts the game. Only the creator can start. Requires MIN_PLAYERS.
 * @returns {Object|string} Room or error string
 */
function startGame(code, requesterId, emitGameUpdate) {
  const room = getRoom(code);
  if (!room) return 'ROOM_NOT_FOUND';
  if (room.creatorId !== requesterId) return 'NOT_CREATOR';
  if (room.state !== 'waiting' || room.starting) return 'ALREADY_STARTED';
  if (room.players.length < MIN_PLAYERS) return 'NOT_ENOUGH_PLAYERS';

  // Lock immediately to block any duplicate calls that arrive before state = 'playing'
  room.starting = true;
  room.state = 'playing';
  room.round++;

  // ── Shuffle turn order randomly each round (Fisher-Yates) ──────────────────
  for (let i = room.players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
  }
  // Store the turn order for display
  room.turnOrder = room.players.map(p => ({ id: p.id, nick: p.nick }));

  // Reset hands
  for (const player of room.players) {
    player.hand = [];
    player.status = 'playing';
    player.isActive = false;
    player.disconnected = false;
  }
  room.dealerHand = [];
  room.results = null;

  // Deal initial cards: 2 per player, then 2 for dealer (1 hidden)
  for (let i = 0; i < 2; i++) {
    for (const player of room.players) {
      player.hand.push(drawCard(room.shoe));
    }
    // Dealer's second card is hidden
    room.dealerHand.push(drawCard(room.shoe, i === 1));
  }

  // Check for instant blackjacks
  for (const player of room.players) {
    if (isNaturalBlackjack(player.hand)) {
      player.status = 'blackjack';
    }
  }

  // Set first active player
  room.currentPlayerIndex = 0;
  setActivePlayer(room, emitGameUpdate);

  return room;
}

/**
 * Sets a player as active and starts their turn timer.
 */
function setActivePlayer(room, emitGameUpdate) {
  // Skip players who already have blackjack, bust, stand or disconnected
  while (
    room.currentPlayerIndex < room.players.length &&
    (room.players[room.currentPlayerIndex].status === 'blackjack' ||
      room.players[room.currentPlayerIndex].status === 'bust' ||
      room.players[room.currentPlayerIndex].status === 'stand' ||
      room.players[room.currentPlayerIndex].status === 'disconnected' ||
      room.players[room.currentPlayerIndex].disconnected)
  ) {
    room.currentPlayerIndex++;
  }

  // All players done → dealer's turn
  if (room.currentPlayerIndex >= room.players.length) {
    runDealerPhase(room, emitGameUpdate);
    return;
  }

  const activePlayer = room.players[room.currentPlayerIndex];
  activePlayer.isActive = true;
  activePlayer.status = 'playing';

  // Set timer BEFORE emitting so clients receive correct turnTimerStart
  clearTurnTimer(room);
  room.turnTimerStart = Date.now();
  room.turnTimer = setTimeout(() => {
    // Auto-stand after 15s
    playerAction(room.code, activePlayer.id, 'stand', emitGameUpdate);
  }, TURN_TIMEOUT_MS);

  // Emit once — after all state is ready
  emitGameUpdate(room);
}

/**
 * Handles a player action: 'hit' or 'stand'.
 */
function playerAction(code, playerId, action, emitGameUpdate) {
  const room = getRoom(code);
  if (!room || room.state !== 'playing') return 'INVALID_STATE';

  const activePlayer = room.players[room.currentPlayerIndex];
  if (!activePlayer || activePlayer.id !== playerId) return 'NOT_YOUR_TURN';

  clearTurnTimer(room);
  activePlayer.isActive = false;

  if (action === 'hit') {
    const newCard = drawCard(room.shoe);
    activePlayer.hand.push(newCard);
    const total = calculateHandValue(activePlayer.hand);

    if (total > 21) {
      activePlayer.status = 'bust';
      room.currentPlayerIndex++;
      setActivePlayer(room, emitGameUpdate);
    } else if (total === 21) {
      // Auto-stand at 21
      activePlayer.status = 'stand';
      room.currentPlayerIndex++;
      setActivePlayer(room, emitGameUpdate);
    } else {
      // Player can keep hitting — restart their turn
      setActivePlayer(room, emitGameUpdate);
      return room;
    }
  } else if (action === 'stand') {
    activePlayer.status = 'stand';
    room.currentPlayerIndex++;
    setActivePlayer(room, emitGameUpdate);
  }

  return room;
}

/**
 * Runs the dealer's turn asynchronously with delays for dramatic effect.
 */
function runDealerPhase(room, emitGameUpdate) {
  room.state = 'dealer_turn';

  // Reveal hidden card first
  for (const card of room.dealerHand) {
    card.hidden = false;
  }
  
  // Emit the reveal
  emitGameUpdate(room);

  function drawNext() {
    // Safety check in case room was destroyed
    if (!rooms.has(room.code) || room.state !== 'dealer_turn') return;

    const total = calculateHandValue(room.dealerHand);
    if (total >= 17) {
      // Dealer stops. Calculate results.
      room.results = evaluateResults(
        room.players.filter(p => !p.disconnected),
        room.dealerHand
      );
      room.state = 'finished';
      const activePlayers = room.players.filter(p => !p.disconnected);
      const currentPot = activePlayers.length * room.ryoAmount;
      room.results.prize = currentPot + room.accumulatedPot;

      // Update Session Balances
      for (const p of room.players) {
        if (p.disconnected) continue;
        // Deduct entrance fee
        p.sessionBalance -= room.ryoAmount;
      }

      if (room.results.tieWithHouse) {
        room.accumulatedPot += currentPot;
      } else {
        room.accumulatedPot = 0;
        
        // Payout to winners
        if (room.results.finalWinners.length > 0 && !room.results.houseWins) {
          const splitPrize = Math.floor(room.results.prize / room.results.finalWinners.length);
          for (const wid of room.results.finalWinners) {
            const winner = room.players.find(p => p.id === wid);
            if (winner) {
              winner.sessionBalance += splitPrize;
              // Natural blackjack bonus (3:2) -> 1.5x ryoAmount
              const pr = room.results.playerResults[winner.id];
              if (pr && pr.result === 'blackjack') {
                winner.sessionBalance += Math.floor(room.ryoAmount * 1.5);
              }
            }
          }
        }
      }

      emitGameUpdate(room);
      return;
    }

    // Dealer hits
    room.dealerHand.push(drawCard(room.shoe));
    emitGameUpdate(room);

    // Schedule next draw
    setTimeout(drawNext, 600);
  }

  // Start drawing after 600ms delay to allow the initial flip animation to finish
  setTimeout(drawNext, 600);
}

/**
 * Resets a finished room back to waiting state for a new round.
 */
function resetRoom(code) {
  const room = getRoom(code);
  if (!room || room.state !== 'finished') return null;

  room.state = 'waiting';
  room.starting = false;
  room.dealerHand = [];
  room.results = null;
  room.currentPlayerIndex = 0;
  room.turnTimerStart = null;

  for (const player of room.players) {
    player.hand = [];
    player.status = 'waiting';
    player.isActive = false;
  }

  return room;
}

/**
 * Clears the active turn timer for a room.
 */
function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnTimerStart = null;
  }
}

/**
 * Returns a safe serializable version of a room for socket broadcast.
 * Hides the shoe contents (anti-cheat).
 */
function getRoomState(room) {
  return {
    code: room.code,
    name: room.name,
    ryoAmount: room.ryoAmount,
    accumulatedPot: room.accumulatedPot || 0,
    creatorId: room.creatorId,
    state: room.state,
    round: room.round,
    players: room.players.map(p => ({
      id: p.id,
      nick: p.nick,
      hand: p.hand,
      handValue: calculateHandValue(p.hand),
      status: p.status,
      isActive: p.isActive,
      sessionBalance: p.sessionBalance || 0,
      disconnected: p.disconnected || false,
    })),
    dealerHand: room.dealerHand,
    dealerValue: room.state === 'playing'
      ? calculateHandValue(room.dealerHand.filter(c => !c.hidden))
      : calculateHandValue(room.dealerHand.map(c => ({ ...c, hidden: false }))),
    currentPlayerIndex: room.currentPlayerIndex,
    turnTimerStart: room.turnTimerStart,
    turnTimeoutMs: TURN_TIMEOUT_MS,
    turnOrder: room.turnOrder || [],
    results: room.results,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
  };
}

module.exports = {
  createRoom,
  getRoom,
  getPublicRooms,
  joinRoom,
  leaveRoom,
  startGame,
  playerAction,
  resetRoom,
  getRoomState,
  TURN_TIMEOUT_MS,
};
