import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import type { Server } from 'socket.io';
import { io as connect, Socket as ClientSocket } from 'socket.io-client';
import { emitNotificationToUser, initSocket } from '../../src/infrastructure/socket';
import { resolveActiveUser } from '../../src/middleware/auth.middleware';

jest.mock('../../src/middleware/auth.middleware', () => ({
  resolveActiveUser: jest.fn(),
}));

const mockResolve = resolveActiveUser as jest.Mock;

/**
 * F107. `subscribe_notifications` used to take `{ userId }` on trust, so any client could
 * read any user's order notifications by naming them, and `send_notification` let any
 * client push a fake one to anybody. The channel joined is now the token's user's alone.
 */
describe('socket notification channel (F107)', () => {
  let http: HttpServer;
  let io: Server;
  let url: string;
  const clients: ClientSocket[] = [];

  beforeAll((done) => {
    http = createServer();
    io = initSocket(http);
    http.listen(0, () => {
      url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
      done();
    });
  });

  afterEach(() => {
    while (clients.length) clients.pop()?.disconnect();
    jest.clearAllMocks();
  });

  afterAll((done) => {
    io.close();
    http.close(() => done());
  });

  const open = () =>
    new Promise<ClientSocket>((resolve) => {
      const client = connect(url, { transports: ['websocket'], forceNew: true });
      clients.push(client);
      client.on('connect', () => resolve(client));
    });

  /** Resolves with whatever arrives first, or 'nothing' after a short wait. */
  const firstOf = (client: ClientSocket, events: string[], ms = 300) =>
    new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('nothing'), ms);
      for (const e of events) {
        client.once(e, () => {
          clearTimeout(timer);
          resolve(e);
        });
      }
    });

  const settle = () => new Promise((r) => setTimeout(r, 100));

  const sample = { id: 'n-1', title: 'Order paid', body: '…', sentAt: '2026-10-14T00:00:00Z' };

  it('rejects a subscription with no token, whatever userId it names', async () => {
    const client = await open();
    const outcome = firstOf(client, ['notifications:unauthorized']);

    client.emit('subscribe_notifications', { userId: 'victim' });

    expect(await outcome).toBe('notifications:unauthorized');
    expect(mockResolve).not.toHaveBeenCalled();

    const received = firstOf(client, ['notification:new']);
    emitNotificationToUser('victim', sample);
    expect(await received).toBe('nothing');
  });

  it("joins the token's user, not the userId in the payload", async () => {
    mockResolve.mockResolvedValue({ id: 'attacker' });
    const client = await open();

    client.emit('subscribe_notifications', { token: 'valid-for-attacker', userId: 'victim' });
    await settle();
    expect(mockResolve).toHaveBeenCalledWith('valid-for-attacker');

    const forVictim = firstOf(client, ['notification:new']);
    emitNotificationToUser('victim', sample);
    expect(await forVictim).toBe('nothing');

    const forSelf = firstOf(client, ['notification:new']);
    emitNotificationToUser('attacker', sample);
    expect(await forSelf).toBe('notification:new');
  });

  it('leaves the old channel when a later subscribe presents a bad token', async () => {
    mockResolve.mockResolvedValueOnce({ id: 'user-a' }).mockResolvedValueOnce(null);
    const client = await open();

    client.emit('subscribe_notifications', { token: 'good' });
    await settle();
    client.emit('subscribe_notifications', { token: 'revoked' });
    await settle();

    const received = firstOf(client, ['notification:new']);
    emitNotificationToUser('user-a', sample);
    expect(await received).toBe('nothing');
  });

  it('no longer relays client-sent notifications', async () => {
    mockResolve.mockResolvedValue({ id: 'target' });
    const target = await open();
    target.emit('subscribe_notifications', { token: 'target-token' });
    await settle();

    const sender = await open();
    const received = firstOf(target, ['notification:new']);
    sender.emit('send_notification', { ...sample, userId: 'target' });

    expect(await received).toBe('nothing');
  });
});
