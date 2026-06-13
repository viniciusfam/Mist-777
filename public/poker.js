'use strict';

/**
 * poker.js — Client-side logic for Texas Hold'em
 */

let pokerState = null;
let prevPokerState = null;
let pokerTimerInterval = null;
let lastRoundSeen = 0;

// Listen for direct poker updates
socket.on('poker_update', (state) => {
  console.log('[Poker] Update:', state);
  
  // Preserve myHand if it exists
  if (pokerState && pokerState.myHand) {
    state.myHand = pokerState.myHand;
  }
  
  pokerState = state;
  
  detectPokerSounds(prevPokerState, state);
  prevPokerState = state;
  
  // Transition to poker screen if round started
  if (state.state === 'playing' || state.state === 'finished') {
    if (typeof showScreen === 'function') {
      const currentScreen = Object.entries(screens).find(([, el]) => el.classList.contains('active'))?.[0];
      if (currentScreen !== 'poker') showScreen('poker');
    }
  }

  renderPokerScreen(state);
});

socket.on('poker_hand', (hand) => {
  console.log('[Poker] Received private hand:', hand);
  if (pokerState) {
    pokerState.myHand = hand;
    renderPokerScreen(pokerState);
  }
});

function renderPokerScreen(state) {
  try {
    if (!state || !state.players) return;

    // Update HUD
    document.getElementById('poker-room-name').textContent = state.name;
    document.getElementById('poker-round-display').textContent = `Round ${state.round}`;
    
    // Check if new round started to show banner
    if (state.round && state.round !== lastRoundSeen) {
      if (lastRoundSeen !== 0 || state.round === 1) {
        showRoundBanner(state.round);
      }
      lastRoundSeen = state.round;
    }
    
    // Show/hide treasurer button
    const isCreator = state.creatorId === socket.id;
    const treasurerBtn = document.getElementById('btn-treasurer-open');
    if (treasurerBtn) {
      if (isCreator) treasurerBtn.classList.remove('hidden');
      else treasurerBtn.classList.add('hidden');
    }

    // Center area
    const potEl = document.getElementById('poker-pot');
    if (potEl) potEl.textContent = (state.pot || 0).toLocaleString();
    
    const curBetEl = document.getElementById('poker-current-bet-display');
    if (curBetEl) curBetEl.innerHTML = `Aposta: <strong>${state.currentBet || 0}</strong>`;
    
    // Side pots if any
    const sidePotsDiv = document.getElementById('poker-side-pots');
    if (sidePotsDiv) {
      if (state.sidePots && state.sidePots.length > 1) {
        sidePotsDiv.innerHTML = state.sidePots.map((p, i) => `Pot ${i+1}: ${p.amount}`).join(' | ');
      } else {
        sidePotsDiv.innerHTML = '';
      }
    }

    // Community Cards
    const commCardsDiv = document.getElementById('poker-community-cards');
    if (commCardsDiv) {
      commCardsDiv.innerHTML = (state.communityCards || []).map(c => createCardHTML(c)).join('');
    }

    // Seats (up to 8 players radially)
    const seatsContainer = document.getElementById('poker-seats-container');
    if (seatsContainer) {
      seatsContainer.innerHTML = '';

      const numPlayers = state.players.length;
      // Radius for positioning
      const rx = window.innerWidth > 900 ? 500 : window.innerWidth * 0.4;
      const ry = window.innerWidth > 900 ? 250 : window.innerHeight * 0.25;

      // We want the current user to be at the bottom (seat 0)
      const myIndex = state.players.findIndex(p => p.id === socket.id);
      const offsetIndex = myIndex >= 0 ? myIndex : 0;

      state.players.forEach((p, i) => {
        // Calculate angle: bottom is PI/2. Distribute evenly.
        const visualPosition = (i - offsetIndex + numPlayers) % numPlayers;
        const angle = (Math.PI / 2) + (visualPosition * (2 * Math.PI / numPlayers));
        
        // Convert polar to cartesian
        const x = Math.cos(angle) * rx;
        const y = Math.sin(angle) * ry;

        const seat = document.createElement('div');
        seat.className = `poker-seat ${p.isActive ? 'is-active' : ''} ${p.status === 'folded' ? 'is-folded' : ''}`;
        seat.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;

        // Cards
        let cardsHTML = '';
        if (p.status !== 'folded') {
          if (p.id === socket.id && state.myHand) {
            cardsHTML = state.myHand.map(c => createCardHTML(c)).join('');
          } else if (p.hand && p.hand.length > 0) {
            cardsHTML = p.hand.map(c => createCardHTML(c)).join('');
          } else {
            // Hidden cards
            cardsHTML = `<div class="playing-card face-down"></div><div class="playing-card face-down"></div>`;
          }
        }

        // Tokens
        let tokens = '';
        if (p.isDealer) tokens += `<div class="poker-token dealer">D</div>`;
        else if (p.isSB) tokens += `<div class="poker-token sb">SB</div>`;
        else if (p.isBB) tokens += `<div class="poker-token bb">BB</div>`;

        seat.innerHTML = `
          <div class="poker-seat-cards">${cardsHTML}</div>
          <div class="poker-avatar">
            ${getInitials(p.nick || '?')}
            ${tokens}
          </div>
          <div class="poker-seat-nick">${escapeHtml(p.nick || 'User')}</div>
          <div class="poker-seat-chips">${(p.chips || 0).toLocaleString()}</div>
          <div class="poker-seat-bet ${p.bet > 0 ? 'has-bet' : ''}">${p.bet || 0}</div>
        `;

        seatsContainer.appendChild(seat);
      });
    }

    // Action Panel
    const me = state.players.find(p => p.id === socket.id);
    const actionPanel = document.getElementById('poker-action-panel');
    const waitingPanel = document.getElementById('poker-waiting-panel');

    socket.emit('debug_log', `[Client ${socket.id}] renderPokerScreen: phase=${state.phase}, meFound=${!!me}, meIsActive=${me?.isActive}, activePlayerIndex=${state.activePlayerIndex}`);

    if (actionPanel && waitingPanel) {
      if (me && me.isActive && state.phase !== 'showdown') {
        actionPanel.classList.add('active');
        waitingPanel.classList.remove('active');
        setupActionButtons(state, me);
        startPokerTimer(state);
      } else {
        actionPanel.classList.remove('active');
        if (state.phase !== 'showdown') waitingPanel.classList.add('active');
        else waitingPanel.classList.remove('active');
        stopPokerTimer();
      }
    }

    // Showdown logic
    if (state.phase === 'showdown') {
      // Show winner toast
      let winnersText = '';
      if (state.payouts && Object.keys(state.payouts).length > 0) {
        const wins = [];
        for (const [pid, amount] of Object.entries(state.payouts)) {
          const p = state.players.find(x => x.id === pid);
          if (p) wins.push(`${p.nick} ganhou ${amount}`);
        }
        winnersText = wins.join(' | ');
      }
      
      const wp = document.getElementById('poker-waiting-panel');
      if (wp) {
        wp.textContent = winnersText || 'Showdown!';
        wp.classList.add('active');
      }

      // Show evaluations
      if (state.evaluations) {
        state.evaluations.forEach(ev => {
          if (ev.folded) return;
          showToast(`${ev.nick}: ${ev.eval.name}`, 4000);
        });
      }
    } else {
      const activePlayer = state.players.find(p => p.isActive);
      const wp = document.getElementById('poker-waiting-panel');
      if (wp) {
        if (activePlayer) {
          wp.textContent = `Vez de ${activePlayer.nick}...`;
        } else {
          wp.textContent = 'Aguardando...';
        }
      }
    }
  } catch (err) {
    console.error('Render Poker Error:', err);
    showToast(`Erro visual: ${err.message}`, 5000);
  }
}

function setupActionButtons(state, me) {
  const toCall = state.currentBet - me.bet;
  
  const btnFold = document.getElementById('btn-poker-fold');
  const btnCheck = document.getElementById('btn-poker-check');
  const btnCall = document.getElementById('btn-poker-call');
  const btnRaise = document.getElementById('btn-poker-raise');
  const btnAllin = document.getElementById('btn-poker-allin');
  const raiseSlider = document.getElementById('poker-raise-slider');
  const raiseVal = document.getElementById('poker-raise-val');

  // Reset
  btnFold.style.display = 'flex';
  btnCheck.style.display = 'none';
  btnCall.style.display = 'none';
  btnRaise.style.display = 'flex';
  btnAllin.style.display = 'flex';

  if (toCall === 0) {
    btnCheck.style.display = 'flex';
  } else {
    btnCall.style.display = 'flex';
    document.getElementById('poker-call-amount').textContent = toCall;
  }

  // Raise slider setup
  const minRaise = state.currentBet + state.bigBlind;
  if (me.chips + me.bet <= minRaise) {
    // Cannot raise, only all in
    btnRaise.style.display = 'none';
    raiseSlider.parentElement.style.display = 'none';
  } else {
    raiseSlider.parentElement.style.display = 'flex';
    raiseSlider.min = minRaise;
    raiseSlider.max = me.chips + me.bet;
    raiseSlider.value = minRaise;
    raiseVal.textContent = minRaise;
    
    raiseSlider.oninput = () => {
      raiseVal.textContent = raiseSlider.value;
    };
  }

  // Bind Actions (clean up old first)
  const act = (action, amount = 0) => {
    socket.emit('poker_action', action, amount, res => {
      if (res?.error) {
        showToast(res.error);
        const me = pokerState?.players?.find(p => p.id === socket.id);
        if (me && me.isActive) {
          document.getElementById('poker-action-panel').classList.add('active');
        }
      }
    });
    document.getElementById('poker-action-panel').classList.remove('active');
  };

  btnFold.onclick = () => act('fold');
  btnCheck.onclick = () => act('check');
  btnCall.onclick = () => act('call');
  btnAllin.onclick = () => act('allin');
  btnRaise.onclick = () => {
    act('raise', parseInt(raiseSlider.value));
  };
}

function startPokerTimer(state) {
  stopPokerTimer();
  if (!state.pokerTurnStart) return;

  const timerText = document.getElementById('poker-timer-count');
  const timerCircle = document.getElementById('poker-timer-circle');
  
  // 40 seconds total
  const turnDuration = 40000;
  let remaining = turnDuration;
  let lastFrameTime = performance.now();

  const update = (now) => {
    const delta = now - lastFrameTime;
    lastFrameTime = now;
    
    remaining = Math.max(0, remaining - delta);
    const secs = Math.ceil(remaining / 1000);
    timerText.textContent = secs;
    
    const dash = (remaining / turnDuration) * 113; // 113 is approx circumference of r=18
    timerCircle.style.strokeDashoffset = 113 - dash;

    if (secs <= 10) timerCircle.classList.add('urgent');
    else timerCircle.classList.remove('urgent');

    if (remaining > 0) {
      pokerTimerInterval = requestAnimationFrame(update);
    }
  };
  pokerTimerInterval = requestAnimationFrame(update);
}

function stopPokerTimer() {
  if (pokerTimerInterval) cancelAnimationFrame(pokerTimerInterval);
  pokerTimerInterval = null;
}

function showRoundBanner(roundNum) {
  let banner = document.getElementById('poker-round-banner');
  let text = document.getElementById('poker-round-banner-text');
  
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'poker-round-banner';
    banner.className = 'poker-round-banner';
    
    text = document.createElement('h1');
    text.id = 'poker-round-banner-text';
    banner.appendChild(text);
    
    const screenPoker = document.getElementById('screen-poker');
    if (screenPoker) screenPoker.appendChild(banner);
    else document.body.appendChild(banner);
  }
  
  text.textContent = `RODADA ${roundNum}`;
  // Force reflow
  void banner.offsetWidth;
  banner.classList.add('show');
  
  setTimeout(() => {
    banner.classList.remove('show');
  }, 3500);
}

// ─── DOM Events for Poker ──────────────────────────────────────────────────────

document.getElementById('btn-toggle-cheat').addEventListener('click', () => {
  document.getElementById('poker-cheat-sheet').classList.add('hidden');
  document.getElementById('btn-show-cheat').classList.remove('hidden');
});

document.getElementById('btn-show-cheat').addEventListener('click', () => {
  document.getElementById('poker-cheat-sheet').classList.remove('hidden');
  document.getElementById('btn-show-cheat').classList.add('hidden');
});

// Treasurer Panel
document.getElementById('btn-treasurer-open').addEventListener('click', () => {
  const modal = document.getElementById('modal-treasurer');
  const select = document.getElementById('treasurer-player-select');
  select.innerHTML = '';
  
  if (pokerState) {
    pokerState.players.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.nick} (Atual: ${p.chips})`;
      select.appendChild(opt);
    });
  }
  
  modal.classList.add('active');
});

document.getElementById('btn-treasurer-close').addEventListener('click', () => {
  document.getElementById('modal-treasurer').classList.remove('active');
});

document.getElementById('btn-treasurer-confirm').addEventListener('click', () => {
  const pid = document.getElementById('treasurer-player-select').value;
  const amt = document.getElementById('treasurer-chips-input').value;
  if (!pid) return showToast('Selecione um jogador');
  
  socket.emit('add_chips', { targetPlayerId: pid, amount: amt }, res => {
    if (res?.error) {
      document.getElementById('treasurer-error').textContent = res.error;
    } else {
      document.getElementById('treasurer-error').textContent = '';
      showToast('Fichas creditadas!');
      document.getElementById('modal-treasurer').classList.remove('active');
    }
  });
});

document.getElementById('btn-scoreboard-poker').addEventListener('click', () => {
  document.getElementById('modal-scoreboard').classList.add('active');
});

// Reuse app.js helper
function createCardHTML(card) {
  if (card.hidden) return `<div class="playing-card face-down"></div>`;
  const isRed = card.suit === '♥' || card.suit === '♦';
  return `
    <div class="playing-card face-up ${isRed ? 'red' : ''}">
      <div class="card-rank">${card.rank}</div>
      <div class="card-suit">${card.suit}</div>
      <div class="card-center-suit">${card.suit}</div>
    </div>
  `;
}

function detectPokerSounds(prev, curr) {
  if (!curr) return;
  if (!Sounds || !Sounds.isEnabled()) return;

  // If this is the very first state (e.g. game just started)
  if (!prev) {
    if (curr.phase === 'preflop') Sounds.gameStart();
    return;
  }

  // Play your turn if it became my turn
  const wasMyTurn = prev.players.find(p => p.id === socket.id)?.isActive;
  const isMyTurn = curr.players.find(p => p.id === socket.id)?.isActive;
  if (!wasMyTurn && isMyTurn && curr.phase !== 'showdown') {
    Sounds.yourTurn();
  }

  // Detect Community Card deals (Flop, Turn, River)
  const prevComm = prev.communityCards || [];
  const currComm = curr.communityCards || [];
  if (currComm.length > prevComm.length && curr.phase !== 'showdown') {
    // Deal sound for each new card
    for (let i = 0; i < currComm.length - prevComm.length; i++) {
      setTimeout(() => Sounds.cardDeal(), i * 150);
    }
  }

  // Detect Phase change to Showdown
  if (curr.phase === 'showdown' && prev.phase !== 'showdown') {
    const myPayout = curr.payouts && curr.payouts[socket.id] ? curr.payouts[socket.id] : 0;
    if (myPayout > 0) {
      setTimeout(() => Sounds.win(), 400); // Wait a beat then play win sound
    } else {
      // If someone else won and we didn't
      setTimeout(() => Sounds.houseWins(), 400);
    }
  }

  // Detect actions by comparing lastAction
  curr.players.forEach(p => {
    const pPrev = prev.players.find(x => x.id === p.id);
    if (pPrev && p.lastAction !== pPrev.lastAction && p.lastAction) {
      const action = p.lastAction.split(':')[0];
      if (action === 'fold') Sounds.fold();
      else if (action === 'call' || action === 'check' || action === 'raise') Sounds.call();
      else if (action === 'allin') Sounds.allIn();
    }
  });
}
