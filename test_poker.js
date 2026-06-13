const pokerLogic = require('./server/pokerLogic');

// Mock a room creation
const players = [
  { id: 'bb_id', nick: 'BB', chips: 1000, disconnected: false }, // Dealer is 0, so 1 is SB, 0 is BB (for 2 players)
  { id: 'sb_id', nick: 'SB', chips: 1000, disconnected: false }
];

const round = pokerLogic.createPokerRound(players, 0);

console.log("=== START OF ROUND ===");
console.log("Phase:", round.phase);
console.log("Current Bet:", round.currentBet);
console.log("Active Player Index:", round.activePlayerIndex);
console.log("Last Raiser Index:", round.lastRaiserIndex);
console.log("Players:", round.players.map(p => ({ id: p.id, bet: p.bet, status: p.status, lastAction: p.lastAction })));

// Player 1 (SB) calls
console.log("\n=== SB CALLS ===");
let updatedRound = pokerLogic.processAction(round, 'sb_id', 'call', 0);
console.log("Phase:", updatedRound.phase);
console.log("Current Bet:", updatedRound.currentBet);
console.log("Active Player Index:", updatedRound.activePlayerIndex);
console.log("Last Raiser Index:", updatedRound.lastRaiserIndex);
console.log("Players:", updatedRound.players.map(p => ({ id: p.id, bet: p.bet, status: p.status, lastAction: p.lastAction })));

// BB Checks
console.log("\n=== BB CHECKS ===");
updatedRound = pokerLogic.processAction(updatedRound, 'bb_id', 'check', 0);
console.log("Phase:", updatedRound.phase);
console.log("Current Bet:", updatedRound.currentBet);
console.log("Active Player Index:", updatedRound.activePlayerIndex);
console.log("Last Raiser Index:", updatedRound.lastRaiserIndex);
console.log("Community Cards:", updatedRound.communityCards.length);
