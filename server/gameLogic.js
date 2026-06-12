/**
 * gameLogic.js — Blackjack 21 PvP
 * Handles deck creation, shuffling, hand calculation, and dealer AI.
 * Uses 6 decks (312 cards) as per casino standard.
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const NUM_DECKS = 6;

/**
 * Creates and returns a shuffled shoe of NUM_DECKS decks.
 */
function createShoe() {
  const shoe = [];
  for (let d = 0; d < NUM_DECKS; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        shoe.push({ suit, rank });
      }
    }
  }
  return shuffle(shoe);
}

/**
 * Fisher-Yates shuffle (in-place).
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Returns the numeric value of a single card rank.
 * Aces return 11 by default (adjusted in calculateHandValue).
 */
function cardValue(rank) {
  if (rank === 'A') return 11;
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  return parseInt(rank, 10);
}

/**
 * Calculates the best total value of a hand.
 * Aces are counted as 11 unless that causes a bust, then as 1.
 * @param {Array} hand - Array of card objects { suit, rank }
 * @returns {number} Best hand value
 */
function calculateHandValue(hand) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.hidden) continue; // Skip hidden dealer card
    const val = cardValue(card.rank);
    total += val;
    if (card.rank === 'A') aces++;
  }

  // Reduce aces from 11 to 1 as needed to avoid bust
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

/**
 * Calculates total including hidden cards (for final dealer reveal).
 */
function calculateFullHandValue(hand) {
  return calculateHandValue(hand.map(c => ({ ...c, hidden: false })));
}

/**
 * Checks if a hand is a Natural Blackjack (exactly 2 cards totaling 21).
 * @param {Array} hand
 * @returns {boolean}
 */
function isNaturalBlackjack(hand) {
  const visibleHand = hand.filter(c => !c.hidden);
  if (visibleHand.length !== 2) return false;
  return calculateHandValue(visibleHand) === 21;
}

/**
 * Checks if a hand is busted (over 21).
 * @param {Array} hand
 * @returns {boolean}
 */
function isBust(hand) {
  return calculateHandValue(hand) > 21;
}

/**
 * Draws one card from the shoe.
 * Reshuffles if shoe runs low (<= 52 cards remaining).
 * @param {Array} shoe - Mutable shoe array
 * @param {boolean} hidden - Whether the card should be face-down
 * @returns {Object} Card object
 */
function drawCard(shoe, hidden = false) {
  if (shoe.length <= 52) {
    const newShoe = createShoe();
    shoe.length = 0;
    shoe.push(...newShoe);
  }
  const card = shoe.pop();
  card.hidden = hidden;
  return card;
}

/**
 * Runs the dealer's turn. Dealer hits on 16 or less, stands on 17+.
 * Soft 17 (Ace + 6) → dealer hits.
 * @param {Array} hand - Dealer's hand (mutated)
 * @param {Array} shoe - Shared shoe (mutated)
 * @returns {Array} Final dealer hand
 */
function runDealerTurn(hand, shoe) {
  // Reveal hidden card first
  for (const card of hand) {
    card.hidden = false;
  }

  while (true) {
    const total = calculateHandValue(hand);
    if (total >= 17) break;
    hand.push(drawCard(shoe));
  }

  return hand;
}

/**
 * Evaluates player results against the dealer's final hand.
 * Returns result for each player: 'blackjack', 'win', 'lose', 'push', 'bust'
 *
 * Victory conditions:
 *  - Bust → 'bust' (lose)
 *  - Player bust only → dealer wins
 *  - Natural Blackjack → 'blackjack' (wins, pays 3:2 — visual marker only)
 *  - Player score > dealer score → 'win'
 *  - Player score === dealer score → 'push'
 *  - Player score < dealer score → 'lose'
 *  - Dealer busts → non-bust players win
 *  - If EVERYONE loses/busts → 'house_wins'
 *
 * @param {Array} players - Array of { id, nick, hand }
 * @param {Array} dealerHand - Dealer's revealed hand
 * @returns {Object} { playerResults: {[id]: result}, houseWins: boolean, winners: [id] }
 */
function evaluateResults(players, dealerHand) {
  const dealerTotal = calculateFullHandValue(dealerHand);
  const dealerBusted = dealerTotal > 21;
  const dealerNaturalBJ = isNaturalBlackjack(dealerHand);
  const effectiveDealerTotal = dealerNaturalBJ ? 21.5 : dealerTotal;

  const playerResults = {};
  const winners = [];
  const pushes = [];

  for (const player of players) {
    const playerTotal = calculateHandValue(player.hand);
    const playerBusted = playerTotal > 21;
    const naturalBJ = isNaturalBlackjack(player.hand);
    const effectiveTotal = naturalBJ ? 21.5 : playerTotal;

    if (playerBusted) {
      playerResults[player.id] = { result: 'bust', total: playerTotal, effectiveTotal: 0 };
    } else if (dealerBusted) {
      playerResults[player.id] = { result: naturalBJ ? 'blackjack' : 'win', total: playerTotal, effectiveTotal };
      winners.push(player.id);
    } else if (effectiveTotal > effectiveDealerTotal) {
      playerResults[player.id] = { result: naturalBJ ? 'blackjack' : 'win', total: playerTotal, effectiveTotal };
      winners.push(player.id);
    } else if (effectiveTotal === effectiveDealerTotal) {
      playerResults[player.id] = { result: 'push', total: playerTotal, effectiveTotal };
      pushes.push(player.id);
    } else {
      playerResults[player.id] = { result: 'lose', total: playerTotal, effectiveTotal };
    }
  }

  // Determine overall winner among human players
  let finalWinners = [];
  if (winners.length > 0) {
    const maxScore = Math.max(...winners.map(id => playerResults[id].effectiveTotal));
    finalWinners = winners.filter(id => playerResults[id].effectiveTotal === maxScore);
  }

  // Se não houve vencedores, mas houve empates com a casa, a casa NÃO leva o dinheiro (Rollover)
  let tieWithHouse = false;
  if (finalWinners.length === 0 && pushes.length > 0) {
    tieWithHouse = true;
  }

  const houseWins = finalWinners.length === 0 && !tieWithHouse;

  return {
    dealerTotal,
    dealerBusted,
    playerResults,
    finalWinners,
    houseWins,
    tieWithHouse,
  };
}

module.exports = {
  createShoe,
  drawCard,
  calculateHandValue,
  calculateFullHandValue,
  isNaturalBlackjack,
  isBust,
  runDealerTurn,
  evaluateResults,
};
