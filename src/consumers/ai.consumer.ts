import { rabbitmq } from "../infrastructure/rabbitmq";
import { ROUTING_KEYS } from "../events/routing-keys";
import logger from "../utils/logger";

interface AiAnalysisPayload {
  userId: string;
  imageUrl: string;
  analysisType: string;
}

export const startAiConsumer = async () => {
  const QUEUE_NAME = "ai.analysis.queue";

  await rabbitmq.consume<AiAnalysisPayload>(
    QUEUE_NAME,
    ROUTING_KEYS.AI_ANALYSIS_REQUESTED,
    async (payload) => {
      logger.info(
        `[AiConsumer] Starting intensive AI analysis for user ${payload.userId}...`,
      );

      // Simulate heavy AI processing time
      await new Promise((resolve) => setTimeout(resolve, 3000));

      logger.info(
        `[AiConsumer] Successfully completed AI analysis: ${payload.analysisType} for user ${payload.userId}`,
      );

      // We could optionally publish another event here like 'ai.analysis.completed'
    },
  );
};
