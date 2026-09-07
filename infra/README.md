# MapAnytime AWS — roles and what is actually connected

Everything below was read out of the working tree: the deploy workflows, `config.ts`,
`s3.util.ts`, and the policy files beside this one. Where something is aspirational
rather than live, it says so.

Region is `ap-southeast-1` throughout.

---

## 1. What is actually connected to AWS

| Service              | Used for                                                          | How it is reached                                              | Live?           |
| :------------------- | :---------------------------------------------------------------- | :------------------------------------------------------------- | :-------------- |
| **S3**               | All user uploads — avatars, product images, seller ID documents   | `@aws-sdk/client-s3`, presigned `PutObject`/`GetObject` only   | Yes             |
| **ECR**              | Docker images for api, web, admin                                 | `aws-actions/amazon-ecr-login` in CI; `docker pull` on the box | Yes             |
| **EC2**              | Runs the API, web and admin containers                            | Staging: `ssm:SendCommand` (§4). Production: still SSH         | Yes             |
| **SSM**              | Deploy transport, and the env file as a SecureString parameter    | `SendCommand` from CI, `GetParameter` on the box               | Staging only    |
| **RDS (PostgreSQL)** | The application database                                          | `DATABASE_URL`, `sslmode=require`                              | Yes             |
| **CloudWatch Logs**  | Container logs under `/mapanytime-api/*`                          | EC2 instance profile                                           | Yes             |
| **IAM**              | Production CI self-grants the EC2 role its ECR policy each deploy | `aws iam put-role-policy` — see §5, this should go             | Production only |

**Not AWS, despite looking like it:**

- **Redis** — `REDIS_HOST` defaults to `localhost` in both workflows and in the
  staging `.env`. Self-hosted on the EC2 box, not ElastiCache. The TLS flag and
  the ElastiCache mentions in the README and handbook are forward-looking only.
- **RabbitMQ** — `RABBITMQ_URL` likewise defaults to `amqp://…@localhost:5672`.
  Self-hosted, not Amazon MQ.
- **Mail** — `smtp.ethereal.email`. Not SES.
- **CDN** — `S3_CDN_URL` exists and is empty. No CloudFront distribution is
  configured from this repo.
- **ECS / Lambda / EKS** — referenced only in documentation prose. Nothing deploys
  to them.

---

## 2. The roles

Three distinct identities, and the thing that keeps going wrong is people reaching
for the wrong one. The comment in `mapanytime-market-web/.github/workflows/deploy-production.yml`
exists because of exactly that.

### A. EC2 instance profile — what the running box may do

`mapanytime-role` (production) · `forhu-staging-mapanytime-api-role` (staging)

Attach:

| Policy                            | Source                             | Grants                                        |
| :-------------------------------- | :--------------------------------- | :-------------------------------------------- |
| `AmazonSSMManagedInstanceCore`    | **AWS managed** — do not hand-roll | Session Manager, SendCommand target, patching |
| `ec2-ecr-pull-policy.json`        | this directory                     | Pull images from `mapanytime*` repos          |
| `ec2-cloudwatch-logs-policy.json` | this directory                     | Write to `/mapanytime-api/*` log groups       |
| `ec2-app-runtime-policy.json`     | this directory — **new**           | S3 uploads, and Parameter Store reads         |

`AmazonSSMManagedInstanceCore` is the one that makes the box a valid SSM target.
Without it the instance never registers and `SendCommand` has nothing to talk to.
The SSM Agent is preinstalled on Amazon Linux 2/2023 and recent Ubuntu AMIs; the
instance also needs egress to the SSM endpoints (a NAT route, or VPC endpoints for
`ssm`, `ssmmessages` and `ec2messages` if the subnet is private).

### B. CI/CD deploy identity — what GitHub Actions may do

An **OIDC role** assumed by GitHub Actions — no static keys, matching how
gc3-client-web already deploys.

- Trust policy: `aws-oidc-trust-policy.json`. It is scoped by `sub` to this
  repo's `staging` and `production` environments specifically, not
  `repo:FORHU/mapanytime-api:*` — the environment-scoped form means a workflow
  on a random branch cannot assume it, and both deploy workflows already declare
  `environment:`.
- Permissions: `cicd-deploy-policy.json` — ECR push, plus `ssm:SendCommand`
  against instances tagged `Project=mapanytime`, which is what replaces SSH.
- ARN goes in the **`AWS_DEPLOY_ROLE_ARN`** secret.

**Staging uses this. Production does not yet** — it is still on the static
`AWS_ACCESS_KEY` / `AWS_SECRET_ACCESS_KEY` pair shared with the web repo. Those
two secrets can only be deleted once production is converted as well, and the
same role covers it (the trust policy already lists the production environment).

### C. Application runtime user — what the app code may do

`style-mirror-s3-dev`, a static key pair in the API's `.env` and in workflow
secrets. **S3 only.** It cannot push to ECR and cannot touch IAM.

**This user should stop existing.** The API runs on EC2, so it should read S3
through the instance profile (option A above, via `ec2-app-runtime-policy.json`)
and drop the credentials entirely — `s3.util.ts` currently hardcodes a
`credentials:` block, which is what forces the key pair. Removing that block lets
the SDK fall back to the instance profile with no other change.

---

## 3. Presigned URLs — the S3 permission that surprises people

`s3.util.ts` issues presigned `PutObject` URLs and the **browser** uploads straight
to S3. Two consequences:

1. The presigning identity needs `s3:PutObject` even though the API never uploads
   bytes itself — the signature carries that identity's authority.
2. The bucket needs a **CORS configuration** allowing `PUT` from the web and admin
   origins. This is bucket configuration, not IAM, and no amount of policy fixing
   will surface a useful error when it is missing — the browser just fails.

---

## 4. SSM cutover — staging is converted, production is not

`deploy-staging.yml` no longer uses SSH. `appleboy/scp-action` and
`appleboy/ssh-action` are gone; the env file travels as a SecureString parameter
and the deploy runs through `ssm:SendCommand`. The script it runs is
`deploy-remote.sh` in this directory — same logic as before, lifted out of the
workflow so it can be diffed and shellchecked, and so staging and production
cannot drift apart by being edited separately.

`deploy-production.yml` is **deliberately untouched** and still on SSH. Prove the
staging path first, then port it.

It follows the same shape as `gc3-client-web`'s production deploy — OIDC role
assumption, tag-based SSM targeting, per-environment config in `vars` — so the
two repos can be read against each other. Two things are deliberately different,
and both are consequences of this being an API rather than a static front end;
see §4a.

**Nothing works until all of these are done. In order:**

1. **Create the GitHub deploy role.** Trust policy:
   `aws-oidc-trust-policy.json` (fill in the account id). Permissions:
   `cicd-deploy-policy.json`. Put its ARN in the **`AWS_DEPLOY_ROLE_ARN`**
   secret. This replaces the static `AWS_ACCESS_KEY` / `AWS_SECRET_ACCESS_KEY`
   pair the workflow used to authenticate with.
2. **Tag the staging instance**, and set the **`EC2_TARGET_TAG_KEY`** and
   **`EC2_TARGET_TAG_VALUE`** repository variables to match.
   `cicd-deploy-policy.json` also scopes `ssm:SendCommand` by
   `Project=mapanytime`, so the instance needs that tag too.
3. **Attach to the EC2 instance role** (`forhu-staging-mapanytime-api-role`):
   `AmazonSSMManagedInstanceCore`, `ec2-ecr-pull-policy.json`,
   `ec2-cloudwatch-logs-policy.json`, `ec2-app-runtime-policy.json`. The ECR one
   used to be self-granted on every deploy and is not any more — see §5.
4. **Confirm the instance is a managed node** — `aws ssm describe-instance-information`
   should list it. If it does not, the agent is not running or the subnet has no
   route to the SSM endpoints.

Optional: `AWS_REGION` and `ECR_REPOSITORY` are read from repository variables
but fall back to the values the workflow used before, so they can be set later
without breaking anything. The two tag variables have no sane default and the
workflow refuses to run without them.

### 4a. Where this differs from gc3-client-web, and why

**The env file goes through Parameter Store, not into the command.** gc3
base64s its env into the `commands[]` parameter, which is safe _there_ because
every value it sends is `NEXT_PUBLIC_*` — already public, already inlined into
the client bundle. This service's env file carries `DATABASE_URL`,
`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `PAYMONGO_SECRET_KEY` and the
mail credentials. SSM retains command text in Run Command history for 30 days,
readable by anyone holding `ssm:ListCommands`, and base64 is encoding rather
than encryption. Copying gc3's approach here would publish every one of those.
`deploy-remote.sh` says the same thing at the point where someone would be
tempted to change it.

**The on-box script is a file, not a heredoc.** It health-checks the container
and asserts a browser-shaped CORS preflight before reporting success — the F94
lesson, which a `docker run -d` alone does not catch, because that command
succeeds as long as the container is _created_. gc3 has no equivalent check and
removes its old container before starting the new one, so a crash-on-boot image
deploys green there. Worth porting back.

Only then does a deploy work. Once production is converted too, `EC2_HOST` and
`EC2_SSH_KEY` become dead secrets and should be deleted, and the security group
can stop allowing inbound 22 — which is most of the point of the exercise.

**Why the env file goes through Parameter Store rather than into the command:**
SSM keeps command text in Run Command history for 30 days, readable by anyone
with `ssm:ListCommands`. Pasting an env file full of database URLs and signing
secrets into `--parameters` would publish them there. The command carries only
non-secret config; `deploy-remote.sh` fetches the rest with
`ssm:GetParameter --with-decryption`.

---

## 5. Two things to fix while you are in here

**`iam:PutRolePolicy` in CI.** Production still runs
`aws iam put-role-policy --role-name mapanytime-role` on every deploy, to grant the
EC2 role its own ECR access. That hands the CI identity the ability to rewrite IAM
role policies — far more than a deploy needs, and it re-runs on every push to do
work that only needed doing once. Attach `ec2-ecr-pull-policy.json` to the role by
hand, delete the step, and drop the permission.

**The bucket is named `forhu-marketplace-dev`.** That is what the staging `.env`
points at. Confirm production uses a separate bucket before assuming the `dev`
suffix is cosmetic — the S3 user is named `style-mirror-s3-dev` too.
