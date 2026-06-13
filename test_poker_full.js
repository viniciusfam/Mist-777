const pokerLogic = require('./server/pokerLogic');

function printState(round, step) {
  console.log(`\n=== ${step} ===`);
  console.log("Phase:", round.phase);
  console.log("Current Bet:", round.currentBet);
  console.log("Active Player Index:", round.activePlayerIndex);
  console.log("Last Raiser Index:", round.lastRaiserIndex);
  console.log("Action Count:", round.actionCount);
  console.log("Players:");
  round.players.forEach(p => {
    console.log(`  - [${p.id}] Status: ${p.status}, Bet: ${p.bet}, TotalBet: ${p.totalBet}, Chips: ${p.chips}, LastAction: ${p.lastAction}`);
  });
  console.log("Community Cards:", round.communityCards.length);
}

try {
  const players = [
    { id: 'bb_id', nick: 'BB', chips: 1000, disconnected: false }, // Dealer is 0
    { id: 'sb_id', nick: 'SB', chips: 1000, disconnected: false }
  ];

  let round = pokerLogic.createPokerRound(players, 0);
  printState(round, "START OF ROUND (Preflop)");

  // Preflop: SB calls
  round = pokerLogic.processAction(round, 'sb_id', 'call', 0);
  printState(round, "SB CALLS");

  // Preflop: BB checks
  round = pokerLogic.processAction(round, 'bb_id', 'check', 0);
  printState(round, "BB CHECKS (Should advance to Flop)");

  // Flop: SB checks
  round = pokerLogic.processAction(round, 'sb_id', 'check', 0);
  printState(round, "SB CHECKS (Flop)");

  // Flop: BB checks
  round = pokerLogic.processAction(round, 'bb_id', 'check', 0);
  printState(round, "BB CHECKS (Should advance to Turn)");

  // Turn: SB checks
  round = pokerLogic.processAction(round, 'sb_id', 'check', 0);
  printState(round, "SB CHECKS (Turn)");

  // Turn: BB checks
  round = pokerLogic.processAction(round, 'bb_id', 'check', 0);
  printState(round, "BB CHECKS (Should advance to River)");

  // River: SB checks
  round = pokerLogic.processAction(round, 'sb_id', 'check', 0);
  printState(round, "SB CHECKS (River)");

  // Start Hand 2 (dealer is bb_id which means index 1)
  console.log("\n====== STARTING HAND 2 ======");
  round = pokerLogic.createPokerRound(players, 1);
  printState(round, "START OF HAND 2 (Preflop)");

  // Preflop: SB calls
  round = pokerLogic.processAction(round, 'bb_id', 'call', 0);
  printState(round, "SB CALLS (Hand 2)");

  // Preflop: BB checks
  round = pokerLogic.processAction(round, 'sb_id', 'check', 0);
  printState(round, "BB CHECKS (Should advance to Flop, Hand 2)");
} catch (err) {
  console.error("ERROR CAUGHT:", err);
}
