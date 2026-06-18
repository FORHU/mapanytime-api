import { rabbitConnection } from "./connection";

export const APP_EXCHANGE = "app.events";
export const DLX_EXCHANGE = "app.dlx"; // Dead Letter Exchange

export const setupExchanges = async () => {
  const channel = rabbitConnection.getChannel();

  // Setup main topic exchange
  await channel.assertExchange(APP_EXCHANGE, "topic", { durable: true });

  // Setup Dead Letter Exchange
  await channel.assertExchange(DLX_EXCHANGE, "topic", { durable: true });
};
