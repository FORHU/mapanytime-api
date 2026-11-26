#!/bin/sh
# Runs inside LocalStack each time it becomes ready (mounted into
# /etc/localstack/init/ready.d). The free image keeps everything in memory, so
# this recreates the event bus on every start. Every call is idempotent.
#
# The shape matches what infra/README.md asks for in AWS (#127):
#   one SNS topic  ->  one SQS queue per consumer, raw delivery, filtered on the
#                      eventType message attribute (= the routing key)
#   each queue     ->  a -dlq twin through a redrive policy
#
# Keep the list below in sync with .env.example and src/events/routing-keys.ts.
set -eu

REGION="${AWS_DEFAULT_REGION:-ap-southeast-1}"
# 4 = the first attempt plus the three retries the RabbitMQ consumer allowed.
MAX_RECEIVES="${QUEUE_MAX_RECEIVES:-4}"
TOPIC_NAME="mapanytime-events"

topic_arn=$(awslocal sns create-topic --region "$REGION" --name "$TOPIC_NAME" \
  --query TopicArn --output text)

# create_consumer_queue <queue-name> <eventType it receives>
create_consumer_queue() {
  q="$1"
  event_type="$2"

  dlq_url=$(awslocal sqs create-queue --region "$REGION" --queue-name "$q-dlq" \
    --query QueueUrl --output text)
  dlq_arn=$(awslocal sqs get-queue-attributes --region "$REGION" --queue-url "$dlq_url" \
    --attribute-names QueueArn --query Attributes.QueueArn --output text)

  url=$(awslocal sqs create-queue --region "$REGION" --queue-name "$q" \
    --query QueueUrl --output text)
  arn=$(awslocal sqs get-queue-attributes --region "$REGION" --queue-url "$url" \
    --attribute-names QueueArn --query Attributes.QueueArn --output text)

  # RedrivePolicy is a JSON string inside JSON; a file avoids shell-quoting it.
  cat > /tmp/redrive.json <<EOF
{"RedrivePolicy": "{\"deadLetterTargetArn\":\"$dlq_arn\",\"maxReceiveCount\":\"$MAX_RECEIVES\"}"}
EOF
  awslocal sqs set-queue-attributes --region "$REGION" --queue-url "$url" \
    --attributes file:///tmp/redrive.json

  # Subscribing the same queue twice returns the existing subscription.
  cat > /tmp/subscription.json <<EOF
{"RawMessageDelivery": "true", "FilterPolicy": "{\"eventType\":[\"$event_type\"]}"}
EOF
  awslocal sns subscribe --region "$REGION" --topic-arn "$topic_arn" \
    --protocol sqs --notification-endpoint "$arn" \
    --attributes file:///tmp/subscription.json >/dev/null

  echo "queue ready: $q <- $event_type (dlq: $q-dlq, max receives: $MAX_RECEIVES, region: $REGION)"
}

create_consumer_queue email-send email.send.requested
create_consumer_queue analytics-events analytics.event.recorded

echo "topic ready: $topic_arn"
