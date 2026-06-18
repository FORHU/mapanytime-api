import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import router from "./routes";
import { isDev } from "./config";
import setup from "./setup";
import cors from "cors";
import { errorHandler } from "./middleware/error.middleware";
import { correlationMiddleware } from "./middleware/correlation.middleware";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./utils/swagger";

const app = express();

app.set("trust proxy", 1);

// Assign correlationId + requestId to every request (must be first)
app.use(correlationMiddleware);

app.use(
  cors({
    origin: "*",
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

if (!isDev) app.use(limiter);

// Set up security headers
app.use(helmet());
app.disable("x-powered-by");

// API Routes
app.use("/api", router);

// Swagger UI — available at http://localhost:PORT/api/docs (dev only)
if (isDev) {
  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: "Node.js API Docs",
      customCss: ".swagger-ui .topbar { display: none }",
    }),
  );
}

// Error Handling
app.use(errorHandler);

// Run setup
setup().catch((err) => {
  console.log("Setup failed:", err);
});

export default app;
