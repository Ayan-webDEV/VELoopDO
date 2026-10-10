import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.js";
import taskRoutes from "./routes/tasks.js";
import analyticsRoutes from "./routes/analytics.js";

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(
  cors({
    origin(origin, callback) {
      // Permit requests without an Origin header, such as server-side health checks.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      message: "Too many requests. Please try again later.",
    },
  }),
);

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    name: "VELoopDO API",
    message: "Task management API is running.",
    environment: NODE_ENV,
  });
});

app.get("/api/health", (_req, res) => {
  const databaseState = mongoose.connection.readyState;

  res.status(databaseState === 1 ? 200 : 503).json({
    success: databaseState === 1,
    service: "VELoopDO API",
    database:
      databaseState === 1
        ? "connected"
        : databaseState === 2
          ? "connecting"
          : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// Feature routes
app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/analytics", analyticsRoutes);

// Unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Central error handler
app.use((err, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (err.message === "Origin not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "This origin is not permitted to access the API.",
    });
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON request body.",
    });
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Request body is too large.",
    });
  }

  if (NODE_ENV !== "production") {
    console.error(err);
  }

  return res.status(err.status || 500).json({
    success: false,
    message:
      NODE_ENV === "production"
        ? "An unexpected server error occurred."
        : err.message || "Internal server error.",
  });
});

async function startServer() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from server/.env");
  }

  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32 ||
    process.env.JWT_SECRET.startsWith("replace_with_")
  ) {
    throw new Error(
      "Configure a strong JWT_SECRET of at least 32 characters in server/.env",
    );
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  console.log("VELoopDO MongoDB connected.");

  const server = app.listen(PORT, () => {
    console.log(`VELoopDO API listening on http://localhost:${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
  });

  async function shutdown(signal) {
    console.log(`${signal} received. Shutting down VELoopDO...`);

    server.close(async () => {
      try {
        await mongoose.disconnect();
        process.exit(0);
      } catch (error) {
        console.error("Error disconnecting MongoDB:", error);
        process.exit(1);
      }
    });

    setTimeout(() => {
      console.error("Graceful shutdown timed out.");
      process.exit(1);
    }, 10000).unref();
  }

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

mongoose.connection.on("error", (error) => {
  console.error("MongoDB connection error:", error.message);
});

mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB disconnected.");
});

startServer().catch((error) => {
  console.error("Failed to start VELoopDO:", error.message);
  process.exit(1);
});

export default app;
