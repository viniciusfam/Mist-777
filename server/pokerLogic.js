'use strict';
/**
 * pokerLogic.js — Texas Hold'em Engine
 * 
 * Handles: deck, dealing, blinds, betting rounds (preflop→flop→turn→river→showdown),
 * hand evaluation (best 5 from 7), side pot calculation, and payout.
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const SMALL_BLIND = 25;
const BIG_BLIND   = 50;

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['♠','♥','♦','♣'];
const RANK_VAL = Object.fromEntries(RANKS.map((r,i) => [r, i + 2]));

// ─── Deck ─────────────────────────────────────────────────────────────────────
function createDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ─── Hand Evaluator ───────────────────────────────────────────────────────────
// Returns { rank: number, name: string, tiebreakers: number[] }
// Higher rank = better hand. Rank 8=StraightFlush..0=HighCard etc.

function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...getCombinations(rest, k - 1).map(c => [first, ...c]),
    ...getCombinations(rest, k),
  ];
}

function evaluateFive(cards) {
  // cards: array of 5 {rank,suit}
  const vals = cards.map(c => RANK_VAL[c.rank]).sort((a,b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = new Set(suits).size === 1;
  
  // Check straight
  let isStraight = false;
  let straightHigh = vals[0];
  if (vals[0] - vals[4] === 4 && new Set(vals).size === 5) {
    isStraight = true;
  }
  // Wheel (A-2-3-4-5)
  if (!isStraight && JSON.stringify(vals) === JSON.stringify([14,5,4,3,2])) {
    isStraight = true;
    straightHigh = 5;
  }

  // Count occurrences
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([v,c]) => ({ v: +v, c }))
    .sort((a,b) => b.c - a.c || b.v - a.v);
  
  const freq = groups.map(g => g.c);

  // Royal/Straight Flush
  if (isFlush && isStraight) {
    return { rank: straightHigh === 14 ? 9 : 8, name: straightHigh === 14 ? 'Royal Flush' : 'Straight Flush', tiebreakers: [straightHigh] };
  }
  // Four of a Kind
  if (freq[0] === 4) {
    return { rank: 7, name: 'Quadra', tiebreakers: [groups[0].v, groups[1].v] };
  }
  // Full House
  if (freq[0] === 3 && freq[1] === 2) {
    return { rank: 6, name: 'Full House', tiebreakers: [groups[0].v, groups[1].v] };
  }
  // Flush
  if (isFlush) {
    return { rank: 5, name: 'Flush', tiebreakers: vals };
  }
  // Straight
  if (isStraight) {
    return { rank: 4, name: 'Sequência', tiebreakers: [straightHigh] };
  }
  // Three of a Kind
  if (freq[0] === 3) {
    return { rank: 3, name: 'Trinca', tiebreakers: [groups[0].v, ...groups.slice(1).map(g=>g.v)] };
  }
  // Two Pair
  if (freq[0] === 2 && freq[1] === 2) {
    return { rank: 2, name: 'Dois Pares', tiebreakers: [groups[0].v, groups[1].v, groups[2].v] };
  }
  // One Pair
  if (freq[0] === 2) {
    return { rank: 1, name: 'Par', tiebreakers: [groups[0].v, ...groups.slice(1).map(g=>g.v)] };
  }
  // High Card
  return { rank: 0, name: 'Carta Alta', tiebreakers: vals };
}

function bestHandFrom7(cards) {
  // If everyone folded, we might not have 5 cards to evaluate. Return dummy hand.
  if (cards.length < 5) {
    return { rank: -1, name: 'Venceu por Fold', tiebreakers: [] };
  }

  // Pick best 5-card combination out of 7
  const combos = getCombinations(cards, 5);
  let best = null;
  for (const combo of combos) {
    const ev = evaluateFive(combo);
    if (!best || compareEval(ev, best) > 0) {
      best = { ...ev, cards: combo };
    }
  }
  return best;
}

function compareEval(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const diff = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ─── Side Pot Calculator ──────────────────────────────────────────────────────
/**
 * Given players with { id, totalContributed, status }
 * Returns array of pots: [{ amount, eligibleIds }]
 */
function calculateSidePots(contributions) {
  // contributions: [{ id, amount, folded }]
  const active = contributions.filter(c => !c.folded);
  if (active.length === 0) return [];

  const sorted = [...contributions].sort((a,b) => a.amount - b.amount);
  const pots = [];
  let previousLevel = 0;

  for (let i = 0; i < sorted.length; i++) {
    const level = sorted[i].amount;
    if (level <= previousLevel) continue;
    const slice = level - previousLevel;
    const eligible = contributions.filter(c => c.amount >= level && !c.folded).map(c => c.id);
    // Also count folded players' contribution up to this level for pot size
    const potAmount = contributions.reduce((sum, c) => {
      return sum + Math.min(c.amount, level) - Math.min(c.amount, previousLevel);
    }, 0);
    pots.push({ amount: potAmount, eligibleIds: eligible });
    previousLevel = level;
  }

  return pots;
}

// ─── Game State Factory ───────────────────────────────────────────────────────
function createPokerRound(players, dealerIndex) {
  const deck = shuffleDeck(createDeck());
  // Only deal to players who have enough chips and are connected
  const activePlayers = players.filter(p => p.chips > 0 && !p.disconnected);
  
  if (activePlayers.length < 2) {
    throw new Error('Not enough active players with chips to start poker');
  }
  
  const playerStates = activePlayers.map(p => ({
    id: p.id,
    nick: p.nick,
    chips: p.chips,
    hand: [deck.pop(), deck.pop()],
    bet: 0,           // bet in current street
    totalBet: 0,      // total bet across all streets
    status: 'active', // active | folded | allin | out
    lastAction: null,
  }));

  // Determine blinds
  const numPlayers = playerStates.length;
  let sbIndex, bbIndex;
  
  if (numPlayers === 2) {
    // Heads Up: Dealer is Small Blind
    sbIndex = dealerIndex;
    bbIndex = (dealerIndex + 1) % 2;
  } else {
    // Standard 3+ players
    sbIndex = (dealerIndex + 1) % numPlayers;
    bbIndex = (dealerIndex + 2) % numPlayers;
  }

  // Post blinds
  function postBlind(playerIdx, amount) {
    const p = playerStates[playerIdx];
    const actual = Math.min(p.chips, amount);
    p.chips -= actual;
    p.bet += actual;
    p.totalBet += actual;
    if (p.chips === 0) p.status = 'allin';
  }

  postBlind(sbIndex, SMALL_BLIND);
  postBlind(bbIndex, BIG_BLIND);

  // First to act preflop = player after BB
  const firstToAct = (bbIndex + 1) % numPlayers;

  return {
    phase: 'preflop',           // preflop | flop | turn | river | showdown
    deck,
    communityCards: [],
    players: playerStates,
    pot: 0,                     // chips already moved to pot (from previous streets)
    currentBet: BIG_BLIND,
    dealerIndex,
    sbIndex,
    bbIndex,
    activePlayerIndex: firstToAct,
    lastRaiserIndex: bbIndex,   // BB counts as "raiser" preflop — action ends when we reach BB
    actionCount: 0,             // how many actions taken this street
    sidePots: [],               // computed at showdown
    contributions: playerStates.map(p => ({ id: p.id, amount: p.totalBet, folded: false })),
  };
}

// ─── Action Handler ───────────────────────────────────────────────────────────
/**
 * processAction(round, playerId, action, raiseAmount?)
 * Returns updated round state. Throws on invalid action.
 */
function processAction(round, playerId, action, raiseAmount = 0) {
  const player = round.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');
  if (player.status !== 'active') throw new Error('Player cannot act');
  if (round.players[round.activePlayerIndex]?.id !== playerId) throw new Error('Not your turn');

  const toCall = round.currentBet - player.bet;

  switch (action) {
    case 'fold': {
      player.status = 'folded';
      player.lastAction = 'fold';
      break;
    }
    case 'check': {
      if (toCall > 0) throw new Error('Cannot check — must call or raise');
      player.lastAction = 'check';
      break;
    }
    case 'call': {
      const actual = Math.min(toCall, player.chips);
      player.chips -= actual;
      player.bet += actual;
      player.totalBet += actual;
      if (player.chips === 0) player.status = 'allin';
      player.lastAction = 'call';
      break;
    }
    case 'raise': {
      const minRaise = round.currentBet + BIG_BLIND;
      const amount = Math.max(raiseAmount, minRaise);
      const totalNeeded = amount - player.bet;
      const actual = Math.min(totalNeeded, player.chips);
      player.chips -= actual;
      player.bet += actual;
      player.totalBet += actual;
      round.currentBet = player.bet;
      round.lastRaiserIndex = round.activePlayerIndex;
      if (player.chips === 0) player.status = 'allin';
      player.lastAction = `raise:${player.bet}`;
      break;
    }
    case 'allin': {
      const all = player.chips;
      player.bet += all;
      player.totalBet += all;
      player.chips = 0;
      if (player.bet > round.currentBet) {
        round.currentBet = player.bet;
        round.lastRaiserIndex = round.activePlayerIndex;
      }
      player.status = 'allin';
      player.lastAction = 'allin';
      break;
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }

  round.actionCount++;

  // Advance to next active player or move to next phase
  return advanceRound(round);
}

// ─── Round Advancement ────────────────────────────────────────────────────────
function advanceRound(round) {
  const activePlayers = round.players.filter(p => p.status === 'active' || p.status === 'allin');
  const stillActive   = round.players.filter(p => p.status === 'active');

  // If only 1 player left (everyone else folded), they win immediately
  if (stillActive.length + round.players.filter(p => p.status === 'allin').length === 1 && 
      round.players.filter(p => p.status === 'folded').length > 0 &&
      stillActive.length === 1) {
    // All others folded
    return endRound(round);
  }
  if (stillActive.length === 0) {
    // Everyone is allin, run it out
    return runItOut(round);
  }

  // Find next active player
  const nextIndex = findNextActive(round.players, round.activePlayerIndex);

  // Check if betting is closed (we've gone around to the last raiser)
  if (isBettingClosed(round, nextIndex)) {
    return advancePhase(round);
  }

  round.activePlayerIndex = nextIndex;
  return round;
}

function findNextActive(players, currentIndex) {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (currentIndex + i) % n;
    if (players[idx].status === 'active') return idx;
  }
  return -1;
}

function isBettingClosed(round, nextIndex) {
  if (nextIndex === -1) return true;
  
  const activePlayers = round.players.filter(p => p.status === 'active');
  
  // Everyone active has matched the highest bet
  const allMatched = activePlayers.every(p => p.bet >= round.currentBet);
  
  // Everyone active has acted at least once this street
  const allActed = activePlayers.every(p => p.lastAction !== null);
  
  return allMatched && allActed;
}

function advancePhase(round) {
  // Collect bets into pot
  for (const p of round.players) {
    round.pot += p.bet;
    p.bet = 0;
  }
  round.currentBet = 0;

  const phases = ['preflop','flop','turn','river','showdown'];
  const nextPhase = phases[phases.indexOf(round.phase) + 1];
  round.phase = nextPhase;

  if (nextPhase === 'flop') {
    round.communityCards.push(round.deck.pop(), round.deck.pop(), round.deck.pop());
  } else if (nextPhase === 'turn' || nextPhase === 'river') {
    round.communityCards.push(round.deck.pop());
  } else if (nextPhase === 'showdown') {
    return endRound(round);
  }

  // Reset street — first to act is first active player after dealer
  const firstActIdx = findNextActive(round.players, round.dealerIndex);
  round.activePlayerIndex = firstActIdx;
  round.lastRaiserIndex = firstActIdx; // Betting closes when we reach first actor again
  round.actionCount = 0;
  // Reset bets and actions for new street
  for (const p of round.players) {
    p.bet = 0;
    p.lastAction = null;
  }

  return round;
}

function runItOut(round) {
  // Everyone is all-in — reveal all remaining community cards
  while (round.communityCards.length < 5) round.communityCards.push(round.deck.pop());
  round.phase = 'showdown';
  return endRound(round);
}

// ─── Showdown & Payout ────────────────────────────────────────────────────────
function endRound(round) {
  // Collect remaining bets
  for (const p of round.players) {
    round.pot += p.bet;
    p.bet = 0;
  }

  const allCards = round.communityCards;
  const notFolded = round.players.filter(p => p.status !== 'folded');

  // Evaluate hands for players still in
  const evaluations = notFolded.map(p => {
    const combinedCards = [...p.hand, ...allCards];
    // If someone folds preflop, we have < 5 cards. Just give a dummy eval since they win by default.
    const handEval = combinedCards.length >= 5 ? bestHandFrom7(combinedCards) : { rank: 0, tiebreakers: [], name: 'Winner by Default' };
    return {
      id: p.id,
      nick: p.nick,
      eval: handEval,
      totalContributed: p.totalBet,
      folded: false,
    };
  });

  // Include folded players with 0 eligibility (for side pot calc)
  const foldedContribs = round.players
    .filter(p => p.status === 'folded')
    .map(p => ({ id: p.id, amount: p.totalBet, folded: true }));

  // Build contributions list (folded ones can still contribute to pots they were in)
  const allContribs = [
    ...evaluations.map(e => ({ id: e.id, amount: e.totalContributed, folded: false })),
    ...foldedContribs,
  ];

  const sidePots = calculateSidePots(allContribs);
  const payouts = {}; // id → chips won

  for (const pot of sidePots) {
    if (pot.amount <= 0) continue;
    const eligible = evaluations.filter(e => pot.eligibleIds.includes(e.id));
    if (eligible.length === 0) continue;

    // Find winner(s) among eligible
    eligible.sort((a,b) => compareEval(b.eval, a.eval));
    const best = eligible[0].eval;
    const winners = eligible.filter(e => compareEval(e.eval, best) === 0);
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;

    winners.forEach((w, i) => {
      payouts[w.id] = (payouts[w.id] || 0) + share + (i === 0 ? remainder : 0);
    });
  }

  // Distribute chips
  for (const p of round.players) {
    if (payouts[p.id]) p.chips += payouts[p.id];
  }

  round.phase = 'showdown';
  round.sidePots = sidePots;
  round.payouts = payouts;
  round.evaluations = evaluations;

  return round;
}

module.exports = {
  createPokerRound,
  processAction,
  SMALL_BLIND,
  BIG_BLIND,
};
