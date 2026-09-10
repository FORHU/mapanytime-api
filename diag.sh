#!/usr/bin/env bash
set -uo pipefail
echo "--- identity resolved by default credential chain ---"
aws sts get-caller-identity --region ap-southeast-1 || echo "get-caller-identity FAILED"
echo
echo "--- IMDS: role attached to this instance ---"
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/ || echo "no IMDS role name found"
echo
echo
echo "--- AWS_* env vars in this shell ---"
env | grep -i '^AWS_' || echo "none set"
echo
echo "--- root's ~/.aws (static profile config, if any) ---"
if [ -d /root/.aws ]; then
  ls -la /root/.aws
  sed -E 's/(aws_secret_access_key|aws_access_key_id)[[:space:]]*=.*/\1 = [REDACTED]/' /root/.aws/credentials 2>/dev/null
else
  echo "no /root/.aws directory"
fi
echo
echo "--- /etc/environment ---"
grep -i AWS /etc/environment 2>/dev/null || echo "none"
echo
echo "--- /etc/profile.d/*.sh referencing AWS ---"
grep -ril AWS /etc/profile.d 2>/dev/null || echo "none"
echo
echo "--- live ECR login test ---"
aws ecr get-login-password --region ap-southeast-1 >/dev/null 2>&1 && echo "ECR login: OK" || echo "ECR login: FAILED"
