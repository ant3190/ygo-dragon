// Loopback-only browser fixture for the real WindBot pre-duel wire adapter.
// It exercises a draw, a win and turn order; it never simulates a rules duel.
import { WebSocketServer } from 'ws';
import { packet, PacketStream, utf16 } from '../server/protocol.mjs';
const server = new WebSocketServer({ host: '127.0.0.1', port: 18090 });
server.on('connection', (socket) => {
  const stream = new PacketStream();
  let round = 0;
  socket.on('message', (raw) => {
    for (const message of stream.read(raw)) {
      if (message.type === 18)
        socket.send(
          Buffer.concat([
            packet(18),
            packet(19, Buffer.from([0x10])),
            packet(32, Buffer.concat([utf16('猜拳界面验收', 40), Buffer.from([1])])),
            packet(33, Buffer.from([0x19])),
          ]),
        );
      if (message.type === 37) socket.send(packet(3));
      if (message.type === 3) {
        const mine = message.data[0];
        const opponent = ++round === 1 ? mine : { 1: 3, 2: 1, 3: 2 }[mine];
        socket.send(
          Buffer.concat([packet(5, Buffer.from([mine, opponent])), packet(round === 1 ? 3 : 4)]),
        );
        console.log(`RPS round ${round}: ${mine}/${opponent}`);
      }
      if (message.type === 4) console.log(`Turn order confirmed: ${message.data[0]}`);
    }
  });
});
server.on('listening', () => console.log('RPS fixture: ws://127.0.0.1:18090 (loopback only)'));
process.on('SIGINT', () => {
  for (const socket of server.clients) socket.terminate();
  server.close();
});
