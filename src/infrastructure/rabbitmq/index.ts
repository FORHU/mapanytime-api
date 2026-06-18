import { rabbitConnection } from "./connection";
import { setupExchanges } from "./exchanges";
import { publish } from "./publisher";
import { consume } from "./consumer";

export const rabbitmq = {
  connect: async () => {
    await rabbitConnection.connect();
    await setupExchanges();
  },
  close: async () => {
    await rabbitConnection.close();
  },
  isReady: () => rabbitConnection.isReady(),
  publish,
  consume,
};
