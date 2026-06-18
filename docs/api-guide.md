# 🔌 API Guide

Reference documentation for building and consuming the REST API.

---

## Base URL

```
http://localhost:3002/api
```

All endpoints are prefixed with `/api/v1` except health checks.

---

## Authentication

This API uses **JWT Bearer tokens**.

### Register / Login Flow

```
POST /api/v1/auth/register   → returns { accessToken, refreshToken }
POST /api/v1/auth/login      → returns { accessToken, refreshToken }
POST /api/v1/auth/refresh    → exchange refreshToken for a new accessToken
POST /api/v1/auth/logout     → invalidate tokens
```

### Using the Token

Add the access token to every authenticated request:

```
Authorization: Bearer <accessToken>
```

Tokens expire after `1d` by default (`ACCESS_TOKEN_EXPIRY` in `.env`).

---

## Response Format

All responses follow a consistent envelope.

### Success — Single Resource

```json
{
  "status": "success",
  "statusCode": 200,
  "data": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "message": "Optional message"
}
```

### Success — Paginated List

```json
{
  "status": "success",
  "statusCode": 200,
  "data": {
    "items": [ ... ],
    "total": 87,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

### Error

```json
{
  "status": "error",
  "statusCode": 404,
  "message": "User not found",
  "code": "USER_NOT_FOUND",
  "details": {}
}
```

---

## Pagination

All list endpoints support these query parameters:

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Items per page (max 100) |
| `sortBy` | string | — | Field to sort by |
| `sortOrder` | `asc` \| `desc` | — | Sort direction |
| `search` | string | — | Search term |

**Example:**

```
GET /api/v1/users?page=2&limit=10&sortBy=createdAt&sortOrder=desc
```

---

## Tracing Headers

Every response includes tracing headers for debugging:

| Header | Description |
|---|---|
| `x-request-id` | Unique ID for this specific HTTP call |
| `x-correlation-id` | Business operation ID — same across all services |

Pass your own `x-correlation-id` to trace a request end-to-end:

```
x-correlation-id: my-trace-id-12345
```

---

## Endpoints

### Health

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health/live` | ❌ | Process liveness check |
| `GET` | `/api/health/ready` | ❌ | Infrastructure readiness check |

**Liveness response:**
```json
{ "status": "ok", "timestamp": "...", "uptime": 3600 }
```

**Readiness response:**
```json
{
  "status": "ready",
  "timestamp": "...",
  "uptime": 3600,
  "services": { "database": "up", "redis": "up", "rabbitmq": "up" }
}
```

---

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | ❌ | Create account |
| `POST` | `/api/v1/auth/login` | ❌ | Sign in |
| `POST` | `/api/v1/auth/refresh` | ❌ | Refresh access token |
| `POST` | `/api/v1/auth/logout` | ✅ | Sign out |

**Register request:**
```json
{
  "email": "user@example.com",
  "password": "MySecureP@ssw0rd!"
}
```

**Login response:**
```json
{
  "status": "success",
  "statusCode": 200,
  "data": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc..."
  }
}
```

---

### Users

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/users/me` | ✅ | Get authenticated user's profile |
| `GET` | `/api/v1/users` | ✅ | List all users (paginated) |
| `POST` | `/api/v1/users` | ✅ | Create a new user |

---

### File Uploads

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/file-uploads` | ✅ | Upload a file (multipart/form-data) |

---

## Error Codes Reference

| HTTP Status | Meaning |
|---|---|
| `400` | Bad Request — invalid input or validation failure |
| `401` | Unauthorized — missing or invalid token |
| `403` | Forbidden — authenticated but insufficient permissions |
| `404` | Not Found — resource doesn't exist |
| `409` | Conflict — duplicate resource (e.g., email already taken) |
| `422` | Unprocessable Entity — valid format but business rule violation |
| `429` | Too Many Requests — rate limit exceeded |
| `500` | Internal Server Error — unexpected server failure |

---

## Rate Limiting

In production, the API is rate-limited to **100 requests per 15 minutes per IP**.

Rate limiting is disabled in `development` mode.

---

## Interactive Docs

Open [http://localhost:3002/api/docs](http://localhost:3002/api/docs) in your browser for the full Swagger UI with request/response examples and a built-in API tester.

> Available in development mode only.

---

## Adding API Documentation to a Route

Use JSDoc annotations in your controller or route file:

```typescript
/**
 * @swagger
 * /v1/users:
 *   get:
 *     summary: List all users
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated list of users
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
```
