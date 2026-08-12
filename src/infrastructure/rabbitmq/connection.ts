import amqp, { ChannelModel, Channel } from 'amqplib';
import { EventEmitter } from 'node:events';
import { RABBITMQ_URL } from '../../config';
import logger from '../../utils/logger';

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 1000;

class RabbitMQConnection {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private reconnectAttempts = 0;
  private isShuttingDown = false;

  public async connect(): Promise<void> {
    if (this.connection && this.channel) return;

    try {
      this.connection = await amqp.connect(RABBITMQ_URL);
      this.reconnectAttempts = 0;

      (this.connection as unknown as EventEmitter).on('error', (err: Error) => {
        logger.error('[RabbitMQ] Connection error:', err);
      });

      (this.connection as unknown as EventEmitter).on('close', () => {
        this.connection = null;
        this.channel = null;

        if (!this.isShuttingDown) {
          logger.warn('[RabbitMQ] Connection closed unexpectedly. Reconnecting...');
          this.scheduleReconnect();
        }
      });

      this.channel = await this.connection.createChannel();

      // Prefetch 1 ensures fair dispatch — a consumer won't receive a new message
      // until it acknowledges the previous one.
      this.channel.prefetch(1);

      logger.info('[RabbitMQ] Connected and channel established.');
    } catch (error) {
      logger.error('[RabbitMQ] Failed to connect:', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error('[RabbitMQ] Max reconnect attempts reached. Giving up.');
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff: 1s, 2s, 4s, 8s... capped at 30s
    const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1), 30000);
    logger.warn(
      `[RabbitMQ] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
    );

    setTimeout(() => this.connect(), delay);
  }

  public getChannel(): Channel {
    if (!this.channel) {
      throw new Error('[RabbitMQ] Channel not initialized. Call connect() first.');
    }
    return this.channel;
  }

  /**
   * Open a channel separate from the shared one, with its own prefetch.
   *
   * The shared channel is pinned at prefetch(1) for fair dispatch, which makes
   * batching impossible on it: a consumer never holds more than one unacked
   * message, so a buffer can never fill. A batch consumer needs to hold a whole
   * batch in flight at once, and prefetch is a channel-level setting — so it
   * needs a channel of its own rather than raising the limit for every other
   * consumer sharing this one.
   */
  public async createDedicatedChannel(prefetch: number): Promise<Channel> {
    if (!this.connection) {
      throw new Error('[RabbitMQ] Connection not initialized. Call connect() first.');
    }

    const channel = await this.connection.createChannel();
    await channel.prefetch(prefetch);
    return channel;
  }

  public isReady(): boolean {
    return !!this.connection && !!this.channel;
  }

  public async close(): Promise<void> {
    this.isShuttingDown = true;
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
      logger.info('[RabbitMQ] Connection closed gracefully.');
    } catch (err) {
      logger.error('[RabbitMQ] Error during graceful close:', err);
    }
  }
}

export const rabbitConnection = new RabbitMQConnection();
