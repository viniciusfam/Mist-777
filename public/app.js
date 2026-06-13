/**
 * app.js — Blackjack 21 PvP Client
 * Manages all UI screens, Socket.IO events, game state rendering,
 * and the 15-second turn timer countdown.
 */

// ── Socket Connection ─────────────────────────────────────────────────────────
const socket = io();

// ── Init Audio on first interaction (browser policy) ─────────────────────────
document.addEventListener('click', () => Sounds.init(), { once: true });
document.addEventListener('keydown', () => Sounds.init(), { once: true });

// ── State ─────────────────────────────────────────────────────────────────────
let myNick = '';
let myRoomCode = null;
let gameState = null;
let timerInterval = null;
let bjBannerTimeout = null;

// ── Screen Management ─────────────────────────────────────────────────────────
const screens = {
  nick:     document.getElementById('screen-nick'),
  lobby:    document.getElementById('screen-lobby'),
  waiting:  document.getElementById('screen-waiting'),
  game:     document.getElementById('screen-game'),
  results:  document.getElementById('screen-results'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
const toastEl = document.getElementById('toast');
let toastTimeout = null;

function showToast(msg, duration = 2500) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ── Utility ───────────────────────────────────────────────────────────────────
function clearError(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = '';
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function getInitials(nick) {
  return nick.trim().substring(0, 2).toUpperCase();
}

// ── Card Rendering ────────────────────────────────────────────────────────────
const RED_SUITS = ['♥', '♦'];

function renderCard(card) {
  const div = document.createElement('div');

  if (card.hidden) {
    div.className = 'playing-card face-down';
    return div;
  }

  const isRed = RED_SUITS.includes(card.suit);
  div.className = `playing-card face-up${isRed ? ' red' : ''}`;

  div.innerHTML = `
    <span class="card-rank">${card.rank}</span>
    <span class="card-center-suit">${card.suit}</span>
    <span class="card-suit">${card.rank}</span>
  `;
  return div;
}

function renderCards(container, hand) {
  // If the hand is smaller than the container (e.g. new round), clear it completely
  if (container.children.length > hand.length) {
    container.innerHTML = '';
  }

  let newCardsAppended = 0;

  hand.forEach((card, i) => {
    const existingChild = container.children[i];
    
    if (existingChild) {
      // Check if it was hidden and is now revealed
      if (existingChild.classList.contains('face-down') && !card.hidden) {
        // Swap to face-up and trigger flip animation
        const newCardNode = renderCard(card);
        // Force reflow before applying animation
        void newCardNode.offsetWidth;
        newCardNode.style.animation = 'none'; // reset
        newCardNode.offsetHeight; // trigger reflow
        newCardNode.style.animation = 'flipCard 0.5s ease-out forwards';
        container.replaceChild(newCardNode, existingChild);
      }
      // If it's the same state, do nothing
    } else {
      // It's a new card, append it
      const newCardNode = renderCard(card);
      
      // Calculate stagger delay based ONLY on how many new cards are appended THIS frame
      const delay = newCardsAppended * 0.35; // 350ms stagger
      if (delay > 0) {
        newCardNode.style.animationDelay = `${delay}s`;
        newCardNode.style.animationFillMode = 'both';
      }
      
      container.appendChild(newCardNode);
      newCardsAppended++;
    }
  });
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function getStatusBadge(status) {
  const map = {
    playing:      ['badge-playing',      'Em Jogo'],
    stand:        ['badge-stand',        'Stand'],
    bust:         ['badge-bust',         'Bust!'],
    blackjack:    ['badge-blackjack',    'Blackjack!'],
    waiting:      ['badge-waiting',      'Aguardando'],
    done:         ['badge-stand',        'Stand'],
    disconnected: ['badge-disconnected', '✕ Saiu'],
  };
  const [cls, label] = map[status] || ['badge-waiting', status];
  return `<span class="pz-status-badge ${cls}">${label}</span>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN 1: NICK
// ═══════════════════════════════════════════════════════════════════════════════
document.getElementById('input-nick').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-enter').click();
});

document.getElementById('btn-enter').addEventListener('click', () => {
  const nick = document.getElementById('input-nick').value.trim();
  clearError('nick-error');

  if (nick.length < 2) {
    showError('nick-error', 'Nick deve ter pelo menos 2 caracteres.');
    return;
  }

  socket.emit('set_nick', nick, (res) => {
    if (res?.error) {
      showError('nick-error', res.error);
      return;
    }
    myNick = res.nick;
    document.getElementById('lobby-nick-display').textContent = myNick;
    socket.emit('get_rooms', (rooms) => renderRoomsList(rooms));
    showScreen('lobby');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN 2: LOBBY
// ═══════════════════════════════════════════════════════════════════════════════

// ── Create Room Modal ─────────────────────────────────────────────────────────
const modalCreate = document.getElementById('modal-create');

document.getElementById('btn-create-room').addEventListener('click', () => {
  modalCreate.classList.add('active');
  document.getElementById('input-room-name').focus();
});

document.getElementById('btn-create-cancel').addEventListener('click', () => {
  modalCreate.classList.remove('active');
  clearError('create-error');
});

modalCreate.addEventListener('click', (e) => {
  if (e.target === modalCreate) {
    modalCreate.classList.remove('active');
  }
});

document.getElementById('input-room-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-create-confirm').click();
});

document.getElementById('btn-create-confirm').addEventListener('click', () => {
  const name = document.getElementById('input-room-name').value.trim();
  const ryo  = document.getElementById('input-ryo').value;
  clearError('create-error');

  if (name.length < 2) {
    showError('create-error', 'Nome da sala inválido (mínimo 2 caracteres).');
    return;
  }

  socket.emit('create_room', { name, ryoAmount: ryo }, (res) => {
    if (res?.error) {
      showError('create-error', res.error);
      return;
    }
    modalCreate.classList.remove('active');
    myRoomCode = res.room.code;
    renderWaitingRoom(res.room);
    showScreen('waiting');
  });
});

// ── Join by Code ──────────────────────────────────────────────────────────────
document.getElementById('input-join-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join-code').click();
});

document.getElementById('btn-join-code').addEventListener('click', () => {
  const code = document.getElementById('input-join-code').value.trim().toUpperCase();
  clearError('lobby-error');

  if (!code) {
    showError('lobby-error', 'Digite o código da sala.');
    return;
  }

  joinRoom(code);
});

function joinRoom(code) {
  socket.emit('join_room', code, (res) => {
    if (res?.error) {
      showError('lobby-error', res.error);
      return;
    }
    myRoomCode = res.room.code;
    renderWaitingRoom(res.room);
    showScreen('waiting');
  });
}

// ── Rooms List Rendering ──────────────────────────────────────────────────────
function renderRoomsList(rooms) {
  const container = document.getElementById('rooms-list');

  if (!rooms || rooms.length === 0) {
    container.innerHTML = `
      <div class="rooms-empty">
        <span>🃏</span>
        <p>Nenhuma sala aberta. Seja o primeiro!</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  rooms.forEach(room => {
    const card = document.createElement('div');
    card.className = 'room-card';
    card.innerHTML = `
      <div class="room-card-info">
        <div class="room-card-name">${escapeHtml(room.name)}</div>
        <div class="room-card-meta">
          <span class="room-card-code">${room.code}</span>
          <span>💰 ${room.ryoAmount.toLocaleString()} ryo</span>
        </div>
      </div>
      <div class="room-card-right">
        <span class="room-players-count">👥 ${room.players}/${room.maxPlayers}</span>
        <button class="room-join-btn">Entrar</button>
      </div>`;

    card.querySelector('.room-join-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      clearError('lobby-error');
      joinRoom(room.code);
    });
    card.addEventListener('click', () => {
      clearError('lobby-error');
      joinRoom(room.code);
    });

    container.appendChild(card);
  });
}

// ── Socket: Lobby Update ──────────────────────────────────────────────────────
socket.on('lobby_update', (rooms) => {
  if (screens.lobby.classList.contains('active')) {
    renderRoomsList(rooms);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN 3: WAITING ROOM
// ═══════════════════════════════════════════════════════════════════════════════
function renderWaitingRoom(room) {
  document.getElementById('waiting-room-name').textContent = room.name;
  document.getElementById('waiting-room-code').textContent = room.code;
  document.getElementById('waiting-ryo').textContent = room.ryoAmount.toLocaleString();

  const potWrap = document.getElementById('waiting-pot-wrap');
  const potText = document.getElementById('waiting-pot');
  if (room.accumulatedPot > 0) {
    potWrap.classList.remove('hidden');
    potText.textContent = room.accumulatedPot.toLocaleString();
  } else {
    potWrap.classList.add('hidden');
  }

  const isCreator = room.creatorId === socket.id;
  const startBtn  = document.getElementById('btn-start-game');
  const hint      = document.getElementById('waiting-hint');

  // Always re-enable button (reset from previous round)
  startBtn.disabled = false;

  if (isCreator) {
    startBtn.classList.remove('hidden');
    hint.textContent = 'Aguardando jogadores... Inicie quando estiver pronto!';
  } else {
    startBtn.classList.add('hidden');
    hint.textContent = 'Aguardando o criador iniciar a partida...';
  }

  // Player slots
  const grid = document.getElementById('waiting-players-grid');
  grid.innerHTML = '';
  room.players.forEach(p => {
    const slot = document.createElement('div');
    const isYou = p.id === socket.id;
    const isCreatorSlot = p.id === room.creatorId;
    slot.className = `player-slot${isCreatorSlot ? ' creator' : ''}`;
    slot.innerHTML = `
      <div class="player-avatar">${getInitials(p.nick)}</div>
      <div class="player-slot-nick">${escapeHtml(p.nick)}</div>
      ${isYou ? '<div class="player-slot-you">Você</div>' : ''}`;
    grid.appendChild(slot);
  });
}

function renderScoreboard(room) {
  // Build the HTML rows
  const sortedPlayers = [...room.players].sort((a, b) => (b.sessionBalance || 0) - (a.sessionBalance || 0));

  function buildRows(tbody) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (sortedPlayers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" class="score-zero" style="text-align:center;">Nenhum jogador ainda.</td></tr>';
      return;
    }
    sortedPlayers.forEach(p => {
      const tr = document.createElement('tr');
      if (p.disconnected) tr.classList.add('score-ghost');

      let balClass = 'score-zero';
      let balText = '0 ryo';
      if (p.sessionBalance > 0) {
        balClass = 'score-pos';
        balText = `+ ${p.sessionBalance.toLocaleString()} ryo`;
      } else if (p.sessionBalance < 0) {
        balClass = 'score-neg';
        balText = `- ${Math.abs(p.sessionBalance).toLocaleString()} ryo`;
      }

      tr.innerHTML = `
        <td>
          <strong>${escapeHtml(p.nick)}</strong>
          ${p.id === socket.id ? ' <span class="text-muted">(Você)</span>' : ''}
          ${p.disconnected ? ' <span class="text-muted">[Saiu]</span>' : ''}
        </td>
        <td style="text-align: right;" class="${balClass}">${balText}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Update BOTH tables (inline on waiting room + modal for game screen)
  buildRows(document.getElementById('scoreboard-body'));
  buildRows(document.getElementById('scoreboard-body-modal'));
}

// ── Copy Room Code ────────────────────────────────────────────────────────────
document.getElementById('btn-copy-code').addEventListener('click', () => {
  const code = document.getElementById('waiting-room-code').textContent;
  navigator.clipboard.writeText(code).then(() => showToast(`Código ${code} copiado!`));
});

// ── Leave Room ────────────────────────────────────────────────────────────────
document.getElementById('btn-leave-room').addEventListener('click', () => {
  socket.emit('leave_room', () => {
    myRoomCode = null;
    socket.emit('get_rooms', (rooms) => renderRoomsList(rooms));
    showScreen('lobby');
  });
});

// ── Start Game ────────────────────────────────────────────────────────────────
document.getElementById('btn-start-game').addEventListener('click', () => {
  clearError('waiting-error');
  const btn = document.getElementById('btn-start-game');
  btn.disabled = true;
  socket.emit('start_game', (res) => {
    if (res?.error) {
      showError('waiting-error', res.error);
      btn.disabled = false;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN 4: GAME TABLE
// ═══════════════════════════════════════════════════════════════════════════════

// ── Hit / Stand Buttons ───────────────────────────────────────────────────────
document.getElementById('btn-hit').addEventListener('click', () => {
  Sounds.hit();
  socket.emit('player_action', { action: 'hit' }, (res) => {
    if (res?.error) showToast(res.error);
  });
});

document.getElementById('btn-stand').addEventListener('click', () => {
  Sounds.stand();
  socket.emit('player_action', { action: 'stand' }, (res) => {
    if (res?.error) showToast(res.error);
  });
});

// ── Render Game Table ─────────────────────────────────────────────────────────
// Track previous hand sizes to detect new cards being dealt
let prevHandSizes = {};
let prevDealerSize = 0;
let prevPlayerStatuses = {};
let prevIsMyTurn = false;

function renderGameTable(state) {
  gameState = state;

  // ── Detect new cards for sound ────────────────────────────────────────────
  const dealerVisible = state.dealerHand.filter(c => !c.hidden).length;
  if (dealerVisible > prevDealerSize) {
    const newCards = dealerVisible - prevDealerSize;
    for (let i = 0; i < newCards; i++) {
      setTimeout(() => {
        if (state.state === 'dealer_turn') Sounds.hit();
        else Sounds.cardDeal();
      }, i * 120);
    }
  }
  prevDealerSize = dealerVisible;

  state.players.forEach(p => {
    const prev = prevHandSizes[p.id] || 0;
    const curr = p.hand.length;
    if (curr > prev) {
      const newCards = curr - prev;
      for (let i = 0; i < newCards; i++) {
        setTimeout(() => Sounds.cardDeal(), i * 120);
      }
    }
    prevHandSizes[p.id] = curr;
  });

  // HUD
  document.getElementById('game-room-name').textContent = state.name;
  document.getElementById('game-ryo-display').textContent = state.ryoAmount.toLocaleString();
  document.getElementById('game-round-display').textContent = `Round ${state.round}`;

  // Dealer
  const dealerCards = document.getElementById('dealer-cards');
  renderCards(dealerCards, state.dealerHand);
  const dealerValueEl = document.getElementById('dealer-value-display');
  dealerValueEl.textContent = state.dealerValue > 0 ? state.dealerValue : '?';

  // Players
  const playersArea = document.getElementById('players-area');
  playersArea.innerHTML = '';

  state.players.forEach((p, index) => {
    const isYou = p.id === socket.id;
    const zone  = document.createElement('div');
    zone.className = `player-zone${p.isActive ? ' is-active' : ''}${isYou ? ' is-you' : ''}${p.disconnected ? ' status-disconnected' : ` status-${p.status}`}`;

    const val = p.handValue;
    const valClass = p.status === 'bust' ? 'bust' : p.status === 'blackjack' ? 'bj' : '';

    // Add turn order numbering (1., 2., 3.) so players know the randomized order
    zone.innerHTML = `
      <div class="pz-nick${isYou ? ' is-you-label' : ''}">
        <span class="turn-number">${index + 1}.</span> ${escapeHtml(p.nick)}${isYou ? ' (Você)' : ''}
      </div>
      <div class="cards-row" id="pz-cards-${p.id}"></div>
      <div class="pz-value ${valClass}">${val}</div>
      ${getStatusBadge(p.status)}`;

    playersArea.appendChild(zone);
    const cardsEl = document.getElementById(`pz-cards-${p.id}`);
    if (cardsEl) renderCards(cardsEl, p.hand);
  });

  // Action / Waiting panels
  // Use isActive flag directly — more reliable than currentPlayerIndex inference
  const isMyTurn = state.players.some(p => p.id === socket.id && p.isActive)
                   && state.state === 'playing';
  const activePlayer = state.players.find(p => p.isActive);

  // Play "Your Turn" sound if it just became my turn
  if (isMyTurn && !prevIsMyTurn) {
    Sounds.yourTurn();
  }
  prevIsMyTurn = isMyTurn;

  const actionPanel  = document.getElementById('action-panel');
  const waitingPanel = document.getElementById('waiting-panel');

  if (isMyTurn) {
    actionPanel.style.display  = 'flex';
    waitingPanel.style.display = 'none';
    startTimer(state.turnTimerStart, state.turnTimeoutMs);
  } else {
    actionPanel.style.display  = 'none';
    waitingPanel.style.display = 'flex';
    stopTimer();

    if (state.state === 'playing' && activePlayer) {
      document.getElementById('waiting-panel-text').textContent =
        `Vez de ${activePlayer.nick}...`;
    } else if (state.state === 'dealer_turn') {
      document.getElementById('waiting-panel-text').textContent = 'A Casa está jogando...';
    } else {
      document.getElementById('waiting-panel-text').textContent = 'Calculando resultado...';
    }
  }

  // Blackjack banner
  checkBlackjackBanner(state);

  // ── Sound: Bust detection ────────────────────────────────────────────────────
  state.players.forEach(p => {
    if (p.status === 'bust' && !p.disconnected) {
      const wasPlaying = (prevPlayerStatuses[p.id] === 'playing');
      if (wasPlaying) {
        if (p.id === socket.id) Sounds.bust();
        // Short delay so others hear it too (local)
        else setTimeout(() => Sounds.bust(), 200);
      }
    }
    prevPlayerStatuses[p.id] = p.status;
  });
}

// ── Timer Countdown ───────────────────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 18; // r=18

function startTimer(startTimestamp, durationMs) {
  stopTimer();

  const timerCircle = document.getElementById('timer-circle');
  const timerCount  = document.getElementById('timer-count');
  let lastSecond    = -1;

  function tick() {
    const elapsed   = Date.now() - startTimestamp;
    const remaining = Math.max(0, durationMs - elapsed);
    const seconds   = Math.ceil(remaining / 1000);
    const progress  = remaining / durationMs;

    timerCount.textContent = seconds;
    timerCircle.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);

    const urgent = seconds <= 5;
    timerCircle.classList.toggle('urgent', urgent);
    timerCount.classList.toggle('timer-count-urgent', urgent);

    // Tick sound on each new second in urgent zone
    if (urgent && seconds !== lastSecond && seconds > 0) {
      Sounds.timerTick();
      lastSecond = seconds;
    }
  }

  tick();
  timerInterval = setInterval(tick, 100);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  // Reset ring
  const timerCircle = document.getElementById('timer-circle');
  if (timerCircle) {
    timerCircle.style.strokeDashoffset = 0;
    timerCircle.classList.remove('urgent');
  }
}

// ── Blackjack Banner ──────────────────────────────────────────────────────────
let lastBjPlayers = new Set();

function checkBlackjackBanner(state) {
  const bjPlayers = state.players.filter(p => p.status === 'blackjack');

  for (const p of bjPlayers) {
    if (!lastBjPlayers.has(p.id)) {
      // New blackjack detected
      showBlackjackBanner(p.nick);
      Sounds.blackjack();
      lastBjPlayers.add(p.id);
    }
  }

  // Detect mid-game 21 (not blackjack — 3+ cards totaling 21)
  state.players.forEach(p => {
    const key = `21_${p.id}`;
    if (p.handValue === 21 && p.hand.length > 2 &&
        p.status === 'stand' && !lastBjPlayers.has(key)) {
      lastBjPlayers.add(key);
      Sounds.hit21();
      showToast(`${p.nick} fez 21! 🎯`);
    }
  });

  // Reset when game resets
  if (state.state === 'waiting') lastBjPlayers.clear();
}

function showBlackjackBanner(nick) {
  const banner   = document.getElementById('blackjack-banner');
  const nameEl   = document.getElementById('bj-player-name');
  nameEl.textContent = nick;
  banner.classList.remove('hidden');

  clearTimeout(bjBannerTimeout);
  bjBannerTimeout = setTimeout(() => {
    banner.classList.add('hidden');
  }, 3000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN 5: RESULTS
// ═══════════════════════════════════════════════════════════════════════════════
function renderResults(state) {
  stopTimer();
  const results = state.results;
  if (!results) return;

  // ── Result Sounds ────────────────────────────────────────────────────────────
  if (results.houseWins) {
    Sounds.houseWins();
  } else if (results.finalWinners.includes(socket.id)) {
    const myResult = results.playerResults[socket.id]?.result;
    if (myResult === 'blackjack') Sounds.blackjack();
    else Sounds.win();
  } else {
    const myResult = results.playerResults[socket.id]?.result;
    if (myResult === 'push') Sounds.push();
    else Sounds.bust();
  }

  showScreen('results');

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.getElementById('results-header');
  header.className = 'results-header';

  if (results.tieWithHouse) {
    header.classList.add('tie');
    header.innerHTML = `
      <div class="results-emoji">🎰</div>
      <div class="results-title gold">EMPATE COM A BANCA</div>
      <div class="results-subtitle">Ninguém superou o Dealer. O Pote vai acumular!</div>`;
  } else if (results.houseWins) {
    header.classList.add('house-wins');
    header.innerHTML = `
      <div class="results-emoji">🏦</div>
      <div class="results-title red">A VILA GANHOU</div>
      <div class="results-subtitle">O Tesoureiro recolhe o pote para o Banco de Eventos</div>`;
  } else if (results.finalWinners.length > 1) {
    header.classList.add('tie');
    const winnerNames = results.finalWinners
      .map(id => state.players.find(p => p.id === id)?.nick || '?')
      .join(' & ');
    header.innerHTML = `
      <div class="results-emoji">🤝</div>
      <div class="results-title blue">EMPATE!</div>
      <div class="results-subtitle">${escapeHtml(winnerNames)} dividem o pote</div>`;
  } else {
    header.classList.add('winner');
    const winner = state.players.find(p => p.id === results.finalWinners[0]);
    const isMe = winner?.id === socket.id;
    const isBlackjack = results.playerResults[winner?.id]?.result === 'blackjack';
    header.innerHTML = `
      <div class="results-emoji">${isBlackjack ? '🃏' : '👑'}</div>
      <div class="results-title gold">${isMe ? 'VOCÊ GANHOU!' : escapeHtml(winner?.nick || '?') + ' GANHOU!'}</div>
      <div class="results-subtitle">${isBlackjack ? 'Com Blackjack Natural! 🎉 (3:2)' : 'Winner takes all!'}</div>`;
  }

  // ── Dealer Row ───────────────────────────────────────────────────────────────
  const dealerRow = document.getElementById('results-dealer-row');
  const dealerClass = results.dealerBusted ? 'result-bust' : '';
  dealerRow.innerHTML = `
    <div class="dealer-result-label">
      <span>👑</span>
      <span>Dealer</span>
      <div class="cards-row" id="results-dealer-cards" style="gap:4px; min-height:0;"></div>
    </div>
    <div class="dealer-result-score ${dealerClass}">${results.dealerBusted ? 'BUST' : results.dealerTotal}</div>`;

  const rdcEl = document.getElementById('results-dealer-cards');
  if (rdcEl) renderCards(rdcEl, state.dealerHand);

  // ── Players ───────────────────────────────────────────────────────────────────
  const playersList = document.getElementById('results-players-list');
  playersList.innerHTML = '';

  const sortedPlayers = [...state.players].sort((a, b) => {
    const ra = results.playerResults[a.id]?.result || 'lose';
    const rb = results.playerResults[b.id]?.result || 'lose';
    const order = { blackjack: 0, win: 1, push: 2, lose: 3, bust: 4 };
    return (order[ra] ?? 5) - (order[rb] ?? 5);
  });

  sortedPlayers.forEach(p => {
    const pr = results.playerResults[p.id];
    if (!pr) return;

    const isWinner = results.finalWinners.includes(p.id);
    const isYou    = p.id === socket.id;

    // Em Winner-Takes-All, se alguém ganhou o pote, os outros perdem mesmo se ganharam do dealer
    let displayResult = pr.result;
    if (results.finalWinners.length > 0 && !isWinner) {
      if (displayResult === 'win' || displayResult === 'blackjack' || displayResult === 'push') {
        displayResult = 'lose'; 
      }
    }

    const resultBadgeClass = {
      blackjack: 'result-blackjack',
      win:       'result-win',
      push:      'result-push',
      lose:      'result-lose',
      bust:      'result-bust',
    }[displayResult] || 'result-lose';

    const resultLabel = {
      blackjack: '♠ BLACKJACK',
      win:       '✓ Ganhou',
      push:      '⇔ Empate',
      lose:      '✗ Perdeu',
      bust:      '💥 Bust',
    }[displayResult] || displayResult;

    const row = document.createElement('div');
    row.className = `result-player-row${isWinner ? ' is-winner' : ''}${isYou ? ' is-you' : ''}`;
    row.innerHTML = `
      <div class="result-player-left">
        <div class="result-avatar">${getInitials(p.nick)}</div>
        <div>
          <div class="result-nick">${escapeHtml(p.nick)}${isYou ? ' <span style="color:var(--green);font-size:0.75rem;">(Você)</span>' : ''}</div>
          <div class="result-score">Pontuação: ${pr.total}</div>
        </div>
      </div>
      <span class="result-badge ${resultBadgeClass}">${resultLabel}</span>`;

    playersList.appendChild(row);
  });

  // ── Ryo Info ──────────────────────────────────────────────────────────────────
  const ryoInfo = document.getElementById('results-ryo-info');
  const prize = results.prize || (state.players.length * state.ryoAmount);

  if (results.tieWithHouse) {
    ryoInfo.innerHTML = `
      💰 Pote da rodada: <strong>${(state.players.length * state.ryoAmount).toLocaleString()} ryo</strong><br>
      🎰 <strong>Rollover:</strong> O pote foi somado ao acumulado para a próxima mão!<br>
      Total acumulado para a próxima: <strong>${state.accumulatedPot.toLocaleString()} ryo</strong>`;
  } else if (results.houseWins) {
    ryoInfo.innerHTML = `
      💰 Pote retido: <strong>${prize.toLocaleString()} ryo</strong><br>
      🏦 A Vila recolheu o pote para o <strong>Banco de Eventos</strong>.<br>
      O Tesoureiro deve guardar os Ryos para futuras premiações em eventos.`;
  } else if (results.finalWinners.length > 1) {
    const split = Math.floor(prize / results.finalWinners.length);
    ryoInfo.innerHTML = `
      💰 Pote total: <strong>${prize.toLocaleString()} ryo</strong><br>
      🤝 Divisão do pote: <strong>${split.toLocaleString()} ryo</strong> para cada vencedor.<br>
      O Tesoureiro deve distribuir igualmente.`;
  } else {
    const winner = state.players.find(p => p.id === results.finalWinners[0]);
    const pr = results.playerResults[winner?.id];
    const bjBonus = pr?.result === 'blackjack' ? ` (+ bônus 3:2 = <strong>${Math.floor(state.ryoAmount * 1.5).toLocaleString()} ryo</strong> extra)` : '';
    ryoInfo.innerHTML = `
      💰 Pote total: <strong>${prize.toLocaleString()} ryo</strong><br>
      👑 <strong>${escapeHtml(winner?.nick || '?')}</strong> leva tudo!${bjBonus}<br>
      O Tesoureiro deve fazer o trade no MMO.`;
  }

  // ── Buttons ───────────────────────────────────────────────────────────────────
  const playAgainBtn = document.getElementById('btn-play-again');
  const room = gameState;

  if (room && room.creatorId === socket.id) {
    playAgainBtn.classList.remove('hidden');
  } else {
    playAgainBtn.classList.add('hidden');
  }
}

// ── Play Again ────────────────────────────────────────────────────────────────
document.getElementById('btn-play-again').addEventListener('click', () => {
  socket.emit('play_again', (res) => {
    if (res?.error) {
      showToast(res.error);
      return;
    }
  });
});

// ── Back to Lobby ─────────────────────────────────────────────────────────────
document.getElementById('btn-back-lobby').addEventListener('click', () => {
  socket.emit('leave_room', () => {
    myRoomCode = null;
    gameState = null;
    socket.emit('get_rooms', (rooms) => renderRoomsList(rooms));
    showScreen('lobby');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
let resultsTimeout = null;

socket.on('game_update', (state) => {
  renderScoreboard(state);
  // Clear any pending results screen transition if state changes
  clearTimeout(resultsTimeout);

  // Capture previous state BEFORE overwriting
  const prevGameState = gameState;
  gameState = state;
  myRoomCode = state.code;

  const currentScreen = Object.entries(screens).find(([, el]) => el.classList.contains('active'))?.[0];

  if (state.state === 'waiting') {
    // Detect player join/leave based on PREVIOUS state
    const prevCount = prevGameState?.players?.length ?? -1;
    if (prevCount >= 0 && currentScreen === 'waiting') {
      if (state.players.length > prevCount) Sounds.playerJoined();
      if (state.players.length < prevCount) Sounds.playerLeft();
    }
    prevHandSizes = {};
    prevDealerSize = 0;
    prevPlayerStatuses = {};
    prevIsMyTurn = false;
    
    // Show screen FIRST then render so DOM is visible
    if (currentScreen !== 'waiting') {
      if (currentScreen === 'results') {
        const overlay = document.getElementById('shuffle-overlay');
        overlay.classList.remove('hidden');
        setTimeout(() => {
          overlay.classList.add('hidden');
          showScreen('waiting');
        }, 1500); // 1.5s shuffling animation
      } else {
        showScreen('waiting');
      }
    }
    renderWaitingRoom(state);
    return;
  }

  if (state.state === 'playing') {
    if (currentScreen !== 'game') {
      Sounds.gameStart();
      showScreen('game');
    }
    renderGameTable(state);
    return;
  }

  if (state.state === 'finished') {
    renderGameTable(state);
    resultsTimeout = setTimeout(() => renderResults(state), 600);
  }
});

socket.on('game_over', (state) => {
  // Handled by game_update with 'finished' state
});

socket.on('connect', () => {
  if (myNick) {
    // Reconnect: re-send nick
    socket.emit('set_nick', myNick, () => {});
  }
});

socket.on('disconnect', () => {
  showToast('Conexão perdida. Reconectando...', 4000);
});

// ── Mute Button ───────────────────────────────────────────────────────────────
document.getElementById('btn-mute').addEventListener('click', () => {
  const on = Sounds.toggle();
  const btnMute  = document.getElementById('btn-mute');
  const iconOn   = document.getElementById('icon-sound-on');
  const iconOff  = document.getElementById('icon-sound-off');
  btnMute.classList.toggle('muted', !on);
  iconOn.classList.toggle('hidden', !on);
  iconOff.classList.toggle('hidden', on);
  showToast(on ? '🔊 Som ativado' : '🔇 Som desativado');
});

// ── Scoreboard Buttons ────────────────────────────────────────────────────────
function openScoreboard() {
  document.getElementById('modal-scoreboard').classList.remove('hidden');
}
function closeScoreboard() {
  document.getElementById('modal-scoreboard').classList.add('hidden');
}

document.getElementById('btn-open-scoreboard')?.addEventListener('click', openScoreboard);
document.getElementById('btn-scoreboard-game')?.addEventListener('click', openScoreboard);
document.getElementById('btn-close-scoreboard')?.addEventListener('click', closeScoreboard);

// Close modal when clicking outside
document.getElementById('modal-scoreboard')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeScoreboard();
});

// ── Escape HTML ───────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
