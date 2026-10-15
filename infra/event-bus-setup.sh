#!/usr/bin/env bash
#
# Creates the event bus (#127) for one environment in real AWS: an SNS topic,
# one SQS queue per consumer with a -dlq twin, and a filtered raw-delivery
# subscription for each. Run by hand, once per environment, by someone holding
# admin credentials. Neither workflow runs it, and the instance role cannot.
# Safe to re-run: every call is create-or-get.
#
#   infra/event-bus-setup.sh staging
#   infra/event-bus-setup.sh production
#
# It prints the three values to set as that GitHub environment's variables.
#
# The local equivalent is docker/localstack/init-events.sh. Keep the consumer
# list in step with it and with src/events/routing-keys.ts.

set -euo pipefail

ENV_NAME="${1:?usage: $0 <staging|production>}"
REGION="${AWS_REGION:-ap-southeast-1}"
# 4 = the first attempt plus three retries.
MAX_RECEIVES="${QUEUE_MAX_RECEIVES:-4}"
# Longer than any consumer's own visibility timeout; the consumer sets its own
# per receive, so this is only the fallback.
VISIBILITY_TIMEOUT=60
# A DLQ keeps messages for the maximum, 14 days, so someone has time to look.
DLQ_RETENTION=1209600
PREFIX="${ENV_NAME}-mapanytime"

topic_arn=$(aws sns create-topic --region "$REGION" --name "${PREFIX}-events" \
  --query TopicArn --output text)

declare -A QUEUE_URLS

# create_consumer_queue <short-name> <eventType it receives>
create_consumer_queue() {
  local name="${PREFIX}-$1" event_type="$2"

  local dlq_url dlq_arn url arn
  dlq_url=$(aws sqs create-queue --region "$REGION" --queue-name "${name}-dlq" \
    --attributes "MessageRetentionPeriod=${DLQ_RETENTION}" --query QueueUrl --output text)
  dlq_arn=$(aws sqs get-queue-attributes --region "$REGION" --queue-url "$dlq_url" \
    --attribute-names QueueArn --query Attributes.QueueArn --output text)

  url=$(aws sqs create-queue --region "$REGION" --queue-name "$name" \
    --query QueueUrl --output text)
  arn=$(aws sqs get-queue-attributes --region "$REGION" --queue-url "$url" \
    --attribute-names QueueArn --query Attributes.QueueArn --output text)

  # Redrive, and a queue policy letting only this topic deliver to the queue.
  # Without the policy the subscription confirms but every delivery is denied,
  # silently: SNS drops them and nothing on the app side notices.
  local attrs
  attrs=$(mktemp)
  cat > "$attrs" <<EOF
{
  "VisibilityTimeout": "${VISIBILITY_TIMEOUT}",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"${dlq_arn}\",\"maxReceiveCount\":\"${MAX_RECEIVES}\"}",
  "Policy": "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"FromEventsTopic\",\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"sns.amazonaws.com\"},\"Action\":\"sqs:SendMessage\",\"Resource\":\"${arn}\",\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":\"${topic_arn}\"}}}]}"
}
EOF
  aws sqs set-queue-attributes --region "$REGION" --queue-url "$url" --attributes "file://$attrs"
  rm -f "$attrs"

  # Raw delivery: the queue receives the published JSON as is, not wrapped in
  # an SNS envelope. The filter is what replaced the RabbitMQ binding.
  local sub
  sub=$(mktemp)
  cat > "$sub" <<EOF
{"RawMessageDelivery": "true", "FilterPolicy": "{\"eventType\":[\"${event_type}\"]}"}
EOF
  aws sns subscribe --region "$REGION" --topic-arn "$topic_arn" \
    --protocol sqs --notification-endpoint "$arn" \
    --attributes "file://$sub" --return-subscription-arn > /dev/null
  rm -f "$sub"

  QUEUE_URLS[$1]="$url"
  echo "queue ready: $name <- $event_type (dlq: ${name}-dlq, max receives: $MAX_RECEIVES)" >&2
}

create_consumer_queue email-send email.send.requested
create_consumer_queue analytics-events analytics.event.recorded

cat <<EOF

Set these as variables of the GitHub "${ENV_NAME}" environment:

EVENTS_TOPIC_ARN=${topic_arn}
EMAIL_SEND_QUEUE_URL=${QUEUE_URLS[email-send]}
ANALYTICS_EVENTS_QUEUE_URL=${QUEUE_URLS[analytics-events]}
EOF
