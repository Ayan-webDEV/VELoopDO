import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";

import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import authenticate from "../middleware/auth.js";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_WINDOW_MINUTES || 15) * 60 * 1000,
  limit: Number(process.env.LOGIN_MAX_ATTEMPTS || 10),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
});

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    message,
  });
}

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    designation: user.designation,
    company: String(user.company),
    permissions: user.permissions,
    status: user.status,
  };
}

function signAccessToken(user) {
  return jwt.sign(
    {
      companyId: String(user.company),
      role: user.role,
    },
    JWT_SECRET,
    {
      algorithm: "HS256",
      subject: String(user._id),
      issuer: "veloopdo-api",
      audience: "veloopdo-client",
      expiresIn: JWT_EXPIRES_IN,
      jwtid: randomUUID(),
    },
  );
}

async function writeAuthAudit(user, action, summary) {
  try {
    await AuditLog.create({
      company: user.company,
      actor: user._id,
      action,
      entityType: "auth",
      entityId: user._id,
      summary,
      occurredAt: new Date(),
    });
  } catch (error) {
    // Never log passwords, access tokens, or request credentials.
    console.error("Authentication audit write failed:", error.message);
  }
}

// POST /api/auth/login
router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    if (!JWT_SECRET || JWT_SECRET.length < 32) {
      return sendError(res, 500, "Authentication is not configured correctly.");
    }

    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body?.password === "string" ? req.body.password : "";

    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password ||
      password.length > 128
    ) {
      return sendError(res, 400, "Enter a valid email and password.");
    }

    const user = await User.findOne({
      email,
      status: "active",
      archivedAt: null,
    }).select(
      "+passwordHash +failedLoginAttempts +lockedUntil +passwordChangedAt",
    );

    if (!user) {
      return sendError(res, 401, "Invalid email or password.");
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return sendError(
        res,
        423,
        "This account is temporarily locked. Please try again later.",
      );
    }

    const passwordMatches = await user.comparePassword(password);

    if (!passwordMatches) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

      if (user.failedLoginAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        user.failedLoginAttempts = 0;
      }

      await user.save();

      return sendError(res, 401, "Invalid email or password.");
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();

    await user.save();

    const token = signAccessToken(user);

    await writeAuthAudit(user, "auth.login", "Member signed in.");

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      user: publicUser(user),
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/auth/me
router.get("/me", authenticate, (req, res) => {
  return res.status(200).json({
    success: true,
    user: publicUser(req.user),
    company: {
      id: String(req.company._id),
      name: req.company.name,
      slug: req.company.slug,
      plan: req.company.plan,
      timezone: req.company.settings?.timezone || "Asia/Kolkata",
    },
  });
});

// POST /api/auth/logout
// JWT access tokens are stateless. The client must discard its token.
// A server-side revocation store can be added before production deployment.
router.post("/logout", authenticate, async (req, res, next) => {
  try {
    await writeAuthAudit(req.user, "auth.logout", "Member signed out.");

    return res.status(200).json({
      success: true,
      message: "Logged out. Please discard the access token.",
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/auth/verify-password
// Used before sensitive actions, such as soft-deleting a task.
router.post("/verify-password", authenticate, async (req, res, next) => {
  try {
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";

    if (!password || password.length > 128) {
      return sendError(res, 400, "Enter your account password.");
    }

    const user = await User.findById(req.user._id).select("+passwordHash");

    if (!user || !(await user.comparePassword(password))) {
      return sendError(res, 403, "Password verification failed.");
    }

    return res.status(200).json({
      success: true,
      verified: true,
      message: "Password verified.",
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/auth/change-password
router.post("/change-password", authenticate, async (req, res, next) => {
  try {
    const currentPassword =
      typeof req.body?.currentPassword === "string"
        ? req.body.currentPassword
        : "";

    const newPassword =
      typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

    if (
      !currentPassword ||
      !newPassword ||
      newPassword.length < 12 ||
      newPassword.length > 128
    ) {
      return sendError(
        res,
        400,
        "Provide your current password and a new password of 12–128 characters.",
      );
    }

    const user = await User.findById(req.user._id).select(
      "+passwordHash +passwordChangedAt",
    );

    if (!user || !(await user.comparePassword(currentPassword))) {
      return sendError(res, 403, "Current password is incorrect.");
    }

    if (currentPassword === newPassword) {
      return sendError(
        res,
        400,
        "Your new password must be different from your current password.",
      );
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.passwordChangedAt = new Date();
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;

    await user.save();

    await writeAuthAudit(
      user,
      "auth.password_changed",
      "Member changed their password.",
    );

    return res.status(200).json({
      success: true,
      message: "Password changed. Sign in again with your new password.",
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
