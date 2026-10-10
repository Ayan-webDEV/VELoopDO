import { Router } from "express";
import mongoose from "mongoose";

import authenticate from "../middleware/auth.js";
import Task from "../models/Task.js";
import User from "../models/User.js";

const router = Router();

router.use(authenticate);

const VALID_RANGES = ["week", "month", "3m", "6m", "12m"];
const CATEGORIES = ["daily", "fixed", "future"];

function fail(res, status, message) {
  return res.status(status).json({
    success: false,
    message,
  });
}

function getRange(range) {
  const now = new Date();
  const start = new Date(now);

  switch (range) {
    case "week":
      start.setDate(start.getDate() - 6);
      break;
    case "month":
      start.setDate(start.getDate() - 29);
      break;
    case "3m":
      start.setMonth(start.getMonth() - 3);
      break;
    case "6m":
      start.setMonth(start.getMonth() - 6);
      break;
    case "12m":
      start.setMonth(start.getMonth() - 12);
      break;
    default:
      return null;
  }

  start.setHours(0, 0, 0, 0);

  return { start, end: now };
}

function localDateKey(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function monthKey(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}`;
}

function weekKey(date, timezone) {
  const key = localDateKey(date, timezone);
  const local = new Date(`${key}T12:00:00`);
  const day = local.getDay();
  local.setDate(local.getDate() - ((day + 6) % 7));

  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const dateOfMonth = String(local.getDate()).padStart(2, "0");

  return `${year}-${month}-${dateOfMonth}`;
}

function getBucketKey(date, range, timezone) {
  if (range === "week" || range === "month") {
    return localDateKey(date, timezone);
  }

  if (range === "3m" || range === "6m" || range === "12m") {
    return monthKey(date, timezone);
  }

  return weekKey(date, timezone);
}

function getBucketLabel(key, range) {
  if (range === "week" || range === "month") {
    const date = new Date(`${key}T12:00:00Z`);

    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }

  if (range === "3m" || range === "6m" || range === "12m") {
    const date = new Date(`${key}-01T12:00:00Z`);

    return date.toLocaleDateString("en-IN", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
  }

  return key;
}

function createBucketMap(range, start, end, timezone) {
  const buckets = new Map();
  const cursor = new Date(start);

  if (range === "week" || range === "month") {
    while (cursor <= end) {
      const key = localDateKey(cursor, timezone);

      buckets.set(key, {
        key,
        label: getBucketLabel(key, range),
        completed: 0,
        failed: 0,
      });

      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    cursor.setDate(1);

    while (cursor <= end) {
      const key = monthKey(cursor, timezone);

      buckets.set(key, {
        key,
        label: getBucketLabel(key, range),
        completed: 0,
        failed: 0,
      });

      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return buckets;
}

function incrementBucket(buckets, date, range, timezone, type) {
  if (!date) return;

  const key = getBucketKey(new Date(date), range, timezone);
  const bucket = buckets.get(key);

  if (bucket) {
    bucket[type] += 1;
  }
}

// GET /api/analytics/overview?range=week|month|3m|6m|12m
router.get("/overview", async (req, res, next) => {
  try {
    const range = req.query.range || "month";

    if (!VALID_RANGES.includes(range)) {
      return fail(res, 400, "Range must be week, month, 3m, 6m, or 12m.");
    }

    const companyId = new mongoose.Types.ObjectId(String(req.company._id));

    const timezone = req.company.settings?.timezone || "Asia/Kolkata";

    const period = getRange(range);
    const { start, end } = period;

    // Recurring templates describe rules, not completed occurrences.
    const baseMatch = {
      company: companyId,
      isRecurringTemplate: { $ne: true },
    };

    const [overall, categoryStats, memberStats, periodTasks, members] =
      await Promise.all([
        Task.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ]),

        Task.aggregate([
          {
            $match: {
              ...baseMatch,
              status: { $in: ["pending", "completed", "failed"] },
            },
          },
          {
            $group: {
              _id: {
                category: "$category",
                status: "$status",
              },
              count: { $sum: 1 },
            },
          },
        ]),

        Task.aggregate([
          {
            $match: {
              ...baseMatch,
              completedAt: { $gte: start, $lte: end },
              completedBy: { $ne: null },
            },
          },
          {
            $group: {
              _id: "$completedBy",
              completed: { $sum: 1 },
            },
          },
        ]),

        Task.find({
          ...baseMatch,
          $or: [
            { completedAt: { $gte: start, $lte: end } },
            { failedAt: { $gte: start, $lte: end } },
          ],
        })
          .select(
            "category status completedAt completedBy failedAt failedBy createdBy assignedTo",
          )
          .lean(),

        User.find({
          company: companyId,
          status: "active",
          archivedAt: null,
        })
          .select("name email role designation")
          .sort({ createdAt: 1 })
          .lean(),
      ]);

    const totals = {
      pending: 0,
      completed: 0,
      failed: 0,
      deleted: 0,
    };

    for (const item of overall) {
      if (Object.hasOwn(totals, item._id)) {
        totals[item._id] = item.count;
      }
    }

    const categories = Object.fromEntries(
      CATEGORIES.map((category) => [
        category,
        { pending: 0, completed: 0, failed: 0 },
      ]),
    );

    for (const item of categoryStats) {
      const category = item._id.category;
      const status = item._id.status;

      if (categories[category] && Object.hasOwn(categories[category], status)) {
        categories[category][status] = item.count;
      }
    }

    const totalTracked = totals.pending + totals.completed + totals.failed;

    const completionRate =
      totalTracked > 0
        ? Math.round((totals.completed / totalTracked) * 1000) / 10
        : 0;

    const failureRate =
      totalTracked > 0
        ? Math.round((totals.failed / totalTracked) * 1000) / 10
        : 0;

    const buckets = createBucketMap(range, start, end, timezone);

    const performanceByMember = new Map();

    for (const member of members) {
      performanceByMember.set(String(member._id), {
        userId: String(member._id),
        name: member.name,
        email: member.email,
        role: member.role,
        designation: member.designation,
        completed: 0,
        failed: 0,
      });
    }

    for (const task of periodTasks) {
      if (
        task.completedAt &&
        task.completedAt >= start &&
        task.completedAt <= end
      ) {
        incrementBucket(
          buckets,
          task.completedAt,
          range,
          timezone,
          "completed",
        );

        const memberId = String(task.completedBy || "");

        if (performanceByMember.has(memberId)) {
          performanceByMember.get(memberId).completed += 1;
        }
      }

      if (task.failedAt && task.failedAt >= start && task.failedAt <= end) {
        incrementBucket(buckets, task.failedAt, range, timezone, "failed");

        const memberId = String(task.failedBy || "");

        if (performanceByMember.has(memberId)) {
          performanceByMember.get(memberId).failed += 1;
        }
      }
    }

    // Keep zero-activity members visible so comparisons remain fair.
    const performance = Array.from(performanceByMember.values()).sort(
      (a, b) => b.completed - a.completed || a.name.localeCompare(b.name),
    );

    const periodCompleted = periodTasks.filter(
      (task) =>
        task.completedAt &&
        task.completedAt >= start &&
        task.completedAt <= end,
    ).length;

    const periodFailed = periodTasks.filter(
      (task) => task.failedAt && task.failedAt >= start && task.failedAt <= end,
    ).length;

    return res.json({
      success: true,
      range,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
        timezone,
      },
      totals,
      completionRate,
      failureRate,
      categories,
      periodSummary: {
        completed: periodCompleted,
        failed: periodFailed,
      },
      performance,
      chart: Array.from(buckets.values()),
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/analytics/members
// Returns task completion and failure counts by member.
router.get("/members", async (req, res, next) => {
  try {
    const range = req.query.range || "month";

    if (!VALID_RANGES.includes(range)) {
      return fail(res, 400, "Invalid reporting range.");
    }

    const { start, end } = getRange(range);
    const companyId = new mongoose.Types.ObjectId(String(req.company._id));

    const [members, completed, failed] = await Promise.all([
      User.find({
        company: companyId,
        status: "active",
        archivedAt: null,
      })
        .select("name email role designation")
        .sort({ createdAt: 1 })
        .lean(),

      Task.aggregate([
        {
          $match: {
            company: companyId,
            isRecurringTemplate: { $ne: true },
            completedAt: { $gte: start, $lte: end },
            completedBy: { $ne: null },
          },
        },
        {
          $group: {
            _id: "$completedBy",
            count: { $sum: 1 },
          },
        },
      ]),

      Task.aggregate([
        {
          $match: {
            company: companyId,
            isRecurringTemplate: { $ne: true },
            failedAt: { $gte: start, $lte: end },
            failedBy: { $ne: null },
          },
        },
        {
          $group: {
            _id: "$failedBy",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const completedMap = new Map(
      completed.map((item) => [String(item._id), item.count]),
    );

    const failedMap = new Map(
      failed.map((item) => [String(item._id), item.count]),
    );

    const results = members.map((member) => ({
      userId: String(member._id),
      name: member.name,
      email: member.email,
      role: member.role,
      designation: member.designation,
      completed: completedMap.get(String(member._id)) || 0,
      failed: failedMap.get(String(member._id)) || 0,
    }));

    return res.json({
      success: true,
      range,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      members: results,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
