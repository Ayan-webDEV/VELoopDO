import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import Company from "../models/Company.js";

const JWT_SECRET = process.env.JWT_SECRET;

function getBearerToken(req) {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

export async function authenticate(req, res, next) {
  try {
    if (!JWT_SECRET || JWT_SECRET.length < 32) {
      return res.status(500).json({
        success: false,
        message: "Authentication is not configured correctly.",
      });
    }

    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in.",
      });
    }

    let payload;

    try {
      payload = jwt.verify(token, JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: "veloopdo-api",
        audience: "veloopdo-client",
      });
    } catch {
      return res.status(401).json({
        success: false,
        message: "Your session is invalid or has expired. Please log in again.",
      });
    }

    if (
      !payload ||
      typeof payload.sub !== "string" ||
      !mongoose.isValidObjectId(payload.sub) ||
      typeof payload.companyId !== "string" ||
      !mongoose.isValidObjectId(payload.companyId)
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    const user = await User.findOne({
      _id: payload.sub,
      company: payload.companyId,
      status: "active",
      archivedAt: null,
    }).select("+passwordChangedAt");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "This account is no longer authorised.",
      });
    }

    const company = await Company.findOne({
      _id: user.company,
      status: "active",
      archivedAt: null,
    });

    if (!company) {
      return res.status(403).json({
        success: false,
        message: "This company workspace is unavailable.",
      });
    }

    // Invalidate existing tokens when a password is changed
    // after the token was issued.
    const issuedAt = Number(payload.iat);

    if (
      !Number.isFinite(issuedAt) ||
      issuedAt * 1000 < new Date(user.passwordChangedAt).getTime() - 1000
    ) {
      return res.status(401).json({
        success: false,
        message: "Your session is no longer valid. Please log in again.",
      });
    }

    req.user = user;
    req.company = company;
    req.auth = {
      userId: user._id,
      companyId: company._id,
      tokenId: payload.jti || null,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRoles(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action.",
      });
    }

    return next();
  };
}

export function requirePermission(permission) {
  return function permissionGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const elevatedRoles = ["owner", "ceo"];

    if (
      elevatedRoles.includes(req.user.role) ||
      req.user.permissions?.[permission] === true
    ) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "You do not have permission to perform this action.",
    });
  };
}

export function requireCompanyMembership(req, res, next) {
  if (!req.user || !req.company) {
    return res.status(401).json({
      success: false,
      message: "An authenticated company membership is required.",
    });
  }

  if (String(req.user.company) !== String(req.company._id)) {
    return res.status(403).json({
      success: false,
      message: "You cannot access another company's workspace.",
    });
  }

  return next();
}

export default authenticate;
