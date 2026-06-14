const io = require('socket.io-client');
const socket = io('http://localhost:3000');
socket.on('connect', () => {
  socket.emit('set_nick', 'Tester');
  socket.emit('join_room', 'test');
  setTimeout(() => {
    socket.emit('poker_action', 'raise', 100);
  }, 1000);
});
let prev = null;
socket.on('poker_update', (state) => {
  console.log('Update. phase:', state.phase);
  state.players.forEach(p => {
    const pPrev = prev ? prev.players.find(x => x.id === p.id) : null;
    if (pPrev && p.lastAction !== pPrev.lastAction) {
      console.log('ACTION CHANGED for', p.nick, pPrev.lastAction, '->', p.lastAction);
    }
  });
  prev = state;
});
