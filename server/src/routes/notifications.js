import { isIP } from "node:net";
import { Router } from "express";

import authenticate from "../middleware/auth.js";
import PushSubscription from "../models/PushSubscription.js";

const router = Router();

router.use(authenticate);

// Retrieve the public key needed by the browser.
router.get("/vapid-public-key", (_req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;

  if (!publicKey) {
    return res.status(503).json({
      success: false,
      message: "Push notifications are not configured on the server yet.",
    });
  }

  return res.json({
    success: true,
    publicKey,
  });
});

// Save or update the authenticated user's push subscription.
router.post("/subscribe", async (req, res, next) => {
  try {
    const subscription = req.body?.subscription;

    if (
      !subscription?.endpoint ||
      typeof subscription.endpoint !== "string" ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid push subscription.",
      });
    }

    let endpointUrl;

    try {
      endpointUrl = new URL(subscription.endpoint);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Invalid push endpoint.",
      });
    }

    if (
      endpointUrl.protocol !== "https:" ||
      isIP(endpointUrl.hostname) ||
      endpointUrl.hostname === "localhost" ||
      endpointUrl.hostname.endsWith(".local")
    ) {
      return res.status(400).json({
        success: false,
        message: "Push endpoints must use a public HTTPS address.",
      });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          company: req.company._id,
          user: req.user._id,
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          expirationTime: subscription.expirationTime || null,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    return res.status(201).json({
      success: true,
      message: "Alarm notifications enabled.",
    });
  } catch (error) {
    return next(error);
  }
});

// Remove a subscription belonging to the authenticated user.
router.delete("/subscribe", async (req, res, next) => {
  try {
    const endpoint = req.body?.endpoint;

    if (!endpoint || typeof endpoint !== "string") {
      return res.status(400).json({
        success: false,
        message: "Subscription endpoint is required.",
      });
    }

    await PushSubscription.deleteOne({
      company: req.company._id,
      user: req.user._id,
      endpoint,
    });

    return res.json({
      success: true,
      message: "Alarm notifications disabled.",
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
