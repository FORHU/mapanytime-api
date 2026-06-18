import express from "express";
import { liveness, readiness } from "../controllers/health.controller";

const healthRouter = express.Router();

// Liveness: is the process alive?
healthRouter.get("/live", liveness);

// Readiness: are all dependencies up?
healthRouter.get("/ready", readiness);

export default healthRouter;
