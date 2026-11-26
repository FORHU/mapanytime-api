import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { AWS_REGION } from '../../config';

/**
 * The SNS and SQS clients behind the event bus.
 *
 * Locally both point at LocalStack (docker-compose), through AWS_SNS_ENDPOINT
 * and AWS_SQS_ENDPOINT. Deployed environments leave both unset and reach real
 * AWS as the EC2 instance role.
 *
 * Credentials follow the rule in `utils/s3.client.ts`: passed only when an
 * endpoint is set. Developers are never issued AWS keys, and LocalStack accepts
 * any, so a fixed pair is enough. In a deployed environment, passing anything
 * would stop the SDK consulting the instance role.
 */
const localCredentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
};

const snsEndpoint = process.env.AWS_SNS_ENDPOINT;
const sqsEndpoint = process.env.AWS_SQS_ENDPOINT;

export const sns = new SNSClient({
  region: AWS_REGION,
  ...(snsEndpoint && { endpoint: snsEndpoint, credentials: localCredentials }),
});

export const sqs = new SQSClient({
  region: AWS_REGION,
  ...(sqsEndpoint && { endpoint: sqsEndpoint, credentials: localCredentials }),
});
