# 📘 Beginner Guide

New to the template? This guide explains how everything fits together — no prior knowledge of RabbitMQ, Redis, or advanced Node.js patterns required.

---

## The Big Picture

Most Express tutorials show you this:

```
Client → Route → Controller → Database → Response
```

This template adds two more layers:

```
Client → Route → Controller → Service → Repository → Database
                                    ↓
                               RabbitMQ (events)
                                    ↓
                         Worker Process (background jobs)
```

Don't worry — you don't need to use all of this on day one. Start with the basics and add complexity when you need it.

---

## Where Does My Code Go?

### If you're adding a new feature (e.g., "Products"):

| File to create                           | Purpose              |
| ---------------------------------------- | -------------------- |
| `src/controllers/product.controller.ts`  | Handle HTTP requests |
| `src/services/product.service.ts`        | Business logic       |
| `src/repositories/product.repository.ts` | Database queries     |
| `src/routes/product.route.ts`            | URL routing          |

Then register the route in `src/routes/index.ts`:

```typescript
import productRoute from './product.route';
router.use('/v1/products', productRoute);
```

### If you need a route, a Controller, and a Service:

Follow the `user` pattern exactly — it's already set up as the reference implementation:

- [`src/controllers/user.controller.ts`](../src/controllers/user.controller.ts)
- [`src/services/user.service.ts`](../src/services/user.service.ts)
- [`src/repositories/user.repository.ts`](../src/repositories/user.repository.ts)
- [`src/routes/user.route.ts`](../src/routes/user.route.ts)

---

## Understanding the Layer Rules

### Controllers — keep them thin

❌ Don't do this:

```typescript
// BAD: business logic in controller
static async create(req, res) {
  const existingUser = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (existingUser) return res.status(409).json({ error: "exists" });
  const user = await prisma.user.create({ data: req.body });
  res.json(user);
}
```

✅ Do this instead:

```typescript
// GOOD: controller just calls service and returns response
static async create(req: Request, res: Response, next: NextFunction) {
  try {
    const newUser = await UserService.createUser(req.body);
    return responseSuccess(res, 201, newUser, "User created");
  } catch (error) {
    next(error); // global error middleware handles the rest
  }
}
```

### Services — where decisions live

```typescript
// service.ts
static async createUser(data: CreateUserDto) {
  // ✅ Business rule: no duplicate emails
  const existing = await UserRepository.findByEmail(data.email);
  if (existing) throwResponse(409, "Email already taken");

  // ✅ Business rule: hash password before storing
  data.password = await hashPassword(data.password);

  const user = await UserRepository.create(data);

  // ✅ Business rule: notify other systems about new user
  await rabbitmq.publish(ROUTING_KEYS.USER_CREATED, { userId: user.id, email: user.email });

  return user;
}
```

### Repositories — only Prisma, nothing else

```typescript
// repository.ts
static async findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

static async create(data: CreateUserDto) {
  return prisma.user.create({ data });
}
```

---

## Returning Responses

Always use the response helpers — never call `res.json()` directly.

```typescript
import { responseSuccess, responseError } from '../helpers/response.helper';

// Success
return responseSuccess(res, 200, user); // 200 with data
return responseSuccess(res, 201, newUser, 'Done'); // 201 with message
return responseSuccess(res, 200, buildPage(items, total, { page, limit })); // paginated

// Error
return responseError(res, 400, 'Validation failed');
return responseError(res, 404, 'User not found');
return responseError(res, 409, 'Email taken', { code: 'EMAIL_CONFLICT' });
```

---

## Throwing Errors from Services

```typescript
import { throwResponse } from '../utils/throw-response';

// The global error middleware catches this and formats it as JSON automatically
throwResponse(404, 'User not found');
throwResponse(403, "You don't have permission");
```

---

## Pagination

Add pagination to any list endpoint in 3 lines:

```typescript
import { parsePagination, buildPage } from '../helpers/pagination.helper';

const { page, limit, skip } = parsePagination(req.query);
const [items, total] = await Promise.all([
  prisma.product.findMany({ skip, take: limit }),
  prisma.product.count(),
]);
return responseSuccess(res, 200, buildPage(items, total, { page, limit }));
```

Clients can pass `?page=2&limit=10&sortBy=createdAt&sortOrder=desc&search=shoe` automatically.

---

## Caching

Wrap any slow database call with `CacheUtil.remember()`:

```typescript
import CacheUtil from '../utils/cache.util';

// Checks Redis first. If miss, runs the function and caches result for 5 minutes.
const user = await CacheUtil.remember(`user:${id}`, 300, () => UserRepository.findById(id));
```

If Redis is down, the function still runs normally — the cache never blocks you.

---

## Authentication

The `authMiddleware` is already set up. Protect a route like this:

```typescript
import { authMiddleware } from '../middleware/auth.middleware';

router.get('/me', authMiddleware, UserController.getMe);
```

Inside the controller, the authenticated user is available on `req.user`:

```typescript
const userId = (req as any).user?.id;
```

---

## Adding a New Schema (Database Table)

1. Edit `prisma/schema.prisma` and add your model
2. Run `npm run db:setup` to generate and migrate
3. Create your Repository, Service, Controller, and Route

---

## Running Tests

```bash
npm test              # all tests
npm run test:unit     # just unit tests (no infrastructure needed)
npm run test:coverage # generate coverage report
```

When you add a new utility or helper, add a corresponding test in `tests/unit/`.

---

## Frequently Asked Questions

**Q: Do I need RabbitMQ for basic CRUD?**
No. You can build a complete CRUD API without touching RabbitMQ. Add events when you need background processing.

**Q: What if Redis goes down?**
`CacheUtil.remember()` falls back to the database automatically. Health checks return `degraded` instead of `down`.

**Q: Where should I put shared types/interfaces?**
Create `src/types/` and define your DTOs and interfaces there.

**Q: How do I add a new environment variable?**

1. Add it to `.env.example` with a comment
2. Export it from `src/config.ts`
3. Import it where needed — never use `process.env` directly outside `config.ts`
