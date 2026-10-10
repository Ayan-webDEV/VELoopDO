import { Router } from "express";
import mongoose from "mongoose";
import authenticate from "../middleware/auth.js";
import Task from "../models/Task.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";

const router = Router();

router.use(authenticate);

const PRIORITY_RANK = {
  high: 0,
  medium: 1,
  low: 2,
};

const TASK_CATEGORIES = ["daily", "fixed", "future"];
const TASK_STATUSES = ["pending", "completed", "failed"];

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function objectId(value) {
  return mongoose.isValidObjectId(value);
}

function validDate(value) {
  if (value === null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function localDateKey(date, timezone = "Asia/Kolkata") {
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

function audit(task, actor, action, summary, changes = []) {
  return AuditLog.create({
    company: task.company,
    actor,
    task: task._id,
    entityType: "task",
    entityId: task._id,
    action,
    summary,
    changes,
    occurredAt: new Date(),
  });
}

function taskPayload(task) {
  return task;
}

function sortTasks(tasks) {
  return tasks.sort((a, b) => {
    const priorityDifference =
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

    if (priorityDifference !== 0) return priorityDifference;

    // Keep earlier-created tasks above later tasks at equal priority.
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

async function ensureDailyOccurrences(company, timezone) {
  const today = localDateKey(new Date(), timezone);

  const templates = await Task.find({
    company,
    category: "daily",
    isRecurringTemplate: true,
    "recurrence.enabled": true,
    status: "pending",
    $or: [
      { "recurrence.startDate": null },
      { "recurrence.startDate": { $lte: new Date() } },
    ],
    $and: [
      {
        $or: [
          { "recurrence.endDate": null },
          { "recurrence.endDate": { $gte: new Date() } },
        ],
      },
    ],
  }).lean();

  for (const template of templates) {
    try {
      await Task.updateOne(
        {
          _id: template._id,
          company,
          "recurrence.lastGeneratedDate": { $ne: today },
        },
        {
          $set: {
            "recurrence.lastGeneratedDate": today,
            "recurrence.nextOccurrenceAt": new Date(Date.now() + 86400000),
          },
        },
      );

      await Task.updateOne(
        {
          company,
          recurringTemplate: template._id,
          occurrenceDate: today,
        },
        {
          $setOnInsert: {
            company,
            title: template.title,
            description: template.description,
            label: template.label,
            links: template.links,
            category: "daily",
            priority: template.priority,
            createdBy: template.createdBy,
            assignedTo: template.assignedTo,
            status: "pending",
            priorityOrder: template.priorityOrder,
            isRecurringTemplate: false,
            recurringTemplate: template._id,
            occurrenceDate: today,
            dueAt: template.dueAt,
            recurrence: {
              enabled: false,
              frequency: "daily",
              timezone,
            },
          },
        },
        { upsert: true, runValidators: true },
      );
    } catch (error) {
      // Duplicate occurrence attempts are harmless because of the
      // unique (template, date) index. Surface other failures.
      if (error.code !== 11000) throw error;
    }
  }
}

async function findTask(company, id) {
  if (!objectId(id)) return null;

  return Task.findOne({
    _id: id,
    company,
  });
}

async function validateAssignee(company, assignedTo) {
  if (!assignedTo) return null;
  if (!objectId(assignedTo)) return undefined;

  const member = await User.findOne({
    _id: assignedTo,
    company,
    status: "active",
    archivedAt: null,
  }).select("_id");

  return member ? member._id : undefined;
}

// GET /api/tasks
// Supports ?category=daily|fixed|future and ?status=pending|completed|failed.
// Deleted tasks are available through GET /history.
router.get("/", async (req, res, next) => {
  try {
    const { category, status, assignedTo, search } = req.query;

    if (category && !TASK_CATEGORIES.includes(category)) {
      return fail(res, 400, "Invalid task category.");
    }

    if (status && !TASK_STATUSES.includes(status)) {
      return fail(res, 400, "Invalid task status.");
    }

    if (assignedTo && assignedTo !== "me" && !objectId(assignedTo)) {
      return fail(res, 400, "Invalid assignee.");
    }

    await ensureDailyOccurrences(
      req.company._id,
      req.company.settings?.timezone || "Asia/Kolkata",
    );

    const filter = {
      company: req.company._id,
      status: status || "pending",
      isRecurringTemplate: false,
    };

    if (category) filter.category = category;

    if (assignedTo === "me") {
      filter.assignedTo = req.user._id;
    } else if (assignedTo) {
      filter.assignedTo = assignedTo;
    }

    if (search) {
      const escaped = String(search)
        .slice(0, 100)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      filter.$or = [
        { title: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
        { label: { $regex: escaped, $options: "i" } },
      ];
    }

    const tasks = await Task.find(filter)
      .populate("createdBy", "name email role designation")
      .populate("assignedTo", "name email role designation")
      .populate("completedBy", "name email role")
      .populate("failedBy", "name email role")
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();

    return res.json({
      success: true,
      tasks: sortTasks(tasks).map(taskPayload),
      count: tasks.length,
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/tasks/history
// Shows completed, failed, and soft-deleted tasks.
router.get("/history", async (req, res, next) => {
  try {
    const status = req.query.status;

    const filter = {
      company: req.company._id,
      status: { $in: ["completed", "failed", "deleted"] },
      isRecurringTemplate: false,
    };

    if (status && !["completed", "failed", "deleted"].includes(status)) {
      return fail(res, 400, "Invalid history status.");
    }

    if (status) filter.status = status;

    const tasks = await Task.find(filter)
      .populate("createdBy", "name email role designation")
      .populate("assignedTo", "name email role designation")
      .populate("completedBy", "name email role")
      .populate("failedBy", "name email role")
      .populate("deletedBy", "name email role")
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean();

    return res.json({
      success: true,
      tasks,
      count: tasks.length,
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/tasks/:id/activity
router.get("/:id/activity", async (req, res, next) => {
  try {
    if (!objectId(req.params.id)) {
      return fail(res, 400, "Invalid task ID.");
    }

    const task = await findTask(req.company._id, req.params.id);

    if (!task) return fail(res, 404, "Task not found.");

    const events = await AuditLog.find({
      company: req.company._id,
      task: task._id,
    })
      .populate("actor", "name email role")
      .sort({ occurredAt: -1 })
      .limit(200)
      .lean();

    return res.json({ success: true, events });
  } catch (error) {
    return next(error);
  }
});

// POST /api/tasks
router.post("/", async (req, res, next) => {
  try {
    const {
      title,
      description = "",
      label = "",
      links = [],
      category,
      priority = "medium",
      assignedTo = null,
      dueAt: rawDueAt = null,
      scheduledFor: rawScheduledFor = null,
      recurrenceEndDate: rawRecurrenceEndDate = null,
    } = req.body || {};

    if (typeof title !== "string" || !title.trim() || title.length > 200) {
      return fail(
        res,
        400,
        "A task title of up to 200 characters is required.",
      );
    }

    if (typeof description !== "string" || description.length > 10000) {
      return fail(res, 400, "Description must be 10,000 characters or fewer.");
    }

    if (typeof label !== "string" || label.length > 80) {
      return fail(res, 400, "Label must be 80 characters or fewer.");
    }

    if (!TASK_CATEGORIES.includes(category)) {
      return fail(res, 400, "Choose daily, fixed, or future work.");
    }

    if (!Object.hasOwn(PRIORITY_RANK, priority)) {
      return fail(res, 400, "Choose high, medium, or low priority.");
    }

    if (!Array.isArray(links) || links.length > 20) {
      return fail(res, 400, "A maximum of 20 links is allowed.");
    }

    const dueAt = validDate(rawDueAt);
    const scheduledFor = validDate(rawScheduledFor);
    const recurrenceEndDate = validDate(rawRecurrenceEndDate);

    if (
      dueAt === undefined ||
      scheduledFor === undefined ||
      recurrenceEndDate === undefined
    ) {
      return fail(res, 400, "One or more dates are invalid.");
    }

    const assignee = await validateAssignee(req.company._id, assignedTo);

    if (assignee === undefined) {
      return fail(
        res,
        400,
        "The selected assignee is not an active company member.",
      );
    }

    if (category === "future" && !scheduledFor) {
      return fail(res, 400, "Future work requires a scheduled date.");
    }

    const timezone = req.company.settings?.timezone || "Asia/Kolkata";

    const task = await Task.create({
      company: req.company._id,
      title: title.trim(),
      description: description.trim(),
      label: label.trim(),
      links,
      category,
      priority,
      createdBy: req.user._id,
      assignedTo: assignee,
      dueAt,
      scheduledFor,
      priorityOrder: Date.now(),
      recurrence:
        category === "daily"
          ? {
              enabled: true,
              frequency: "daily",
              timezone,
              startDate: new Date(),
              endDate: recurrenceEndDate,
              nextOccurrenceAt: new Date(),
            }
          : {
              enabled: false,
              frequency: "daily",
              timezone,
            },
    });

    await audit(
      task,
      req.user._id,
      "task.created",
      `Created task: ${task.title}`,
    );

    return res.status(201).json({
      success: true,
      message: "Task created successfully.",
      task,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return fail(res, 400, error.message);
    }

    return next(error);
  }
});

// PATCH /api/tasks/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const task = await findTask(req.company._id, req.params.id);

    if (!task) return fail(res, 404, "Task not found.");

    if (task.status === "deleted") {
      return fail(res, 409, "Restore this task before editing it.");
    }

    const allowedFields = [
      "title",
      "description",
      "label",
      "links",
      "category",
      "priority",
      "assignedTo",
      "dueAt",
      "scheduledFor",
    ];

    const changes = [];

    for (const field of allowedFields) {
      if (!Object.hasOwn(req.body || {}, field)) continue;

      let value = req.body[field];

      if (field === "assignedTo") {
        value = await validateAssignee(req.company._id, value);

        if (value === undefined) {
          return fail(res, 400, "Invalid or inactive assignee.");
        }
      }

      if (["dueAt", "scheduledFor"].includes(field)) {
        value = validDate(value);

        if (value === undefined) {
          return fail(res, 400, `Invalid ${field} date.`);
        }
      }

      if (field === "title") {
        if (typeof value !== "string" || !value.trim() || value.length > 200) {
          return fail(res, 400, "Invalid task title.");
        }
        value = value.trim();
      }

      if (field === "description") {
        if (typeof value !== "string" || value.length > 10000) {
          return fail(res, 400, "Invalid description.");
        }
      }

      if (field === "label") {
        if (typeof value !== "string" || value.length > 80) {
          return fail(res, 400, "Invalid label.");
        }
      }

      if (field === "category" && !TASK_CATEGORIES.includes(value)) {
        return fail(res, 400, "Invalid task category.");
      }

      if (field === "priority" && !Object.hasOwn(PRIORITY_RANK, value)) {
        return fail(res, 400, "Invalid priority.");
      }

      if (field === "links" && (!Array.isArray(value) || value.length > 20)) {
        return fail(res, 400, "Invalid task links.");
      }

      const before = task.get(field);

      changes.push({
        field,
        before: before ?? null,
        after: value ?? null,
      });

      task.set(field, value);
    }

    if (!changes.length) {
      return fail(res, 400, "No editable task fields were provided.");
    }

    if (task.category === "daily") {
      task.isRecurringTemplate = true;
      task.recurrence.enabled = true;
      task.recurrence.frequency = "daily";
    } else {
      task.isRecurringTemplate = false;
      task.recurrence.enabled = false;
    }

    task.revision += 1;

    await task.save();

    await audit(
      task,
      req.user._id,
      "task.updated",
      `Updated task: ${task.title}`,
      changes,
    );

    return res.json({
      success: true,
      message: "Task updated successfully.",
      task,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return fail(res, 400, error.message);
    }

    return next(error);
  }
});

// POST /api/tasks/:id/complete
router.post("/:id/complete", async (req, res, next) => {
  try {
    const task = await findTask(req.company._id, req.params.id);

    if (!task) return fail(res, 404, "Task not found.");

    if (task.status !== "pending" || task.isRecurringTemplate) {
      return fail(res, 409, "Only active task occurrences can be completed.");
    }

    task.status = "completed";
    task.completedAt = new Date();
    task.completedBy = req.user._id;
    task.failedAt = null;
    task.failedBy = null;
    task.failureReason = "";
    task.revision += 1;

    await task.save();

    await audit(
      task,
      req.user._id,
      "task.completed",
      `Completed task: ${task.title}`,
      [{ field: "status", before: "pending", after: "completed" }],
    );

    return res.json({
      success: true,
      message: "Task marked as completed.",
      task,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return fail(res, 400, error.message);
    }
    return next(error);
  }
});

// POST /api/tasks/:id/fail
router.post("/:id/fail", async (req, res, next) => {
  try {
    const task = await findTask(req.company._id, req.params.id);

    if (!task) return fail(res, 404, "Task not found.");

    if (task.status !== "pending" || task.isRecurringTemplate) {
      return fail(res, 409, "Only active task occurrences can be failed.");
    }

    const reason =
      typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    if (reason.length > 2000) {
      return fail(res, 400, "Failure reason is too long.");
    }

    task.status = "failed";
    task.failedAt = new Date();
    task.failedBy = req.user._id;
    task.failureReason = reason;
    task.completedAt = null;
    task.completedBy = null;
    task.revision += 1;

    await task.save();

    await audit(
      task,
      req.user._id,
      "task.failed",
      `Failed task: ${task.title}`,
      [
        { field: "status", before: "pending", after: "failed" },
        { field: "failureReason", before: "", after: reason },
      ],
    );

    return res.json({
      success: true,
      message: "Task marked as failed.",
      task,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return fail(res, 400, error.message);
    }
    return next(error);
  }
});

// DELETE /api/tasks/:id
// Requires the acting member's current account password.
router.delete("/:id", async (req, res, next) => {
  try {
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";

    if (!password || password.length > 128) {
      return fail(res, 400, "Enter your account password to delete this task.");
    }

    const user = await User.findById(req.user._id).select("+passwordHash");

    if (!user || !(await user.comparePassword(password))) {
      return fail(res, 403, "Password verification failed. Task not deleted.");
    }

    const task = await findTask(req.company._id, req.params.id);

    if (!task) return fail(res, 404, "Task not found.");

    if (task.status === "deleted") {
      return fail(res, 409, "This task is already deleted.");
    }

    const previousStatus = task.status;

    task.statusBeforeDeletion = previousStatus;
    task.status = "deleted";
    task.deletedAt = new Date();
    task.deletedBy = req.user._id;
    task.revision += 1;

    await task.save();

    await audit(
      task,
      req.user._id,
      "task.deleted",
      `Deleted task: ${task.title}`,
      [{ field: "status", before: previousStatus, after: "deleted" }],
    );

    return res.json({
      success: true,
      message: "Task deleted and retained in history.",
      task,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return fail(res, 400, error.message);
    }
    return next(error);
  }
});

// POST /api/tasks/:id/restore
router.post("/:id/restore", async (req, res, next) => {
  try {
    const task = await findTask(req.company._id, req.params.id);

    if (!task) return fail(res, 404, "Task not found.");

    if (task.status !== "deleted") {
      return fail(res, 409, "Only deleted tasks can be restored.");
    }

    const previousStatus = task.statusBeforeDeletion || "pending";

    task.status = previousStatus;
    task.statusBeforeDeletion = null;
    task.deletedAt = null;
    task.deletedBy = null;
    task.deletionReason = "";
    task.revision += 1;

    await task.save();

    await audit(
      task,
      req.user._id,
      "task.restored",
      `Restored task: ${task.title}`,
      [{ field: "status", before: "deleted", after: previousStatus }],
    );

    return res.json({
      success: true,
      message: "Task restored successfully.",
      task,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return fail(res, 400, error.message);
    }
    return next(error);
  }
});

// POST /api/tasks/:id/reopen
router.post("/:id/reopen", async (req, res, next) => {
  try {
    const task = await findTask(req.company._id, req.params.id);

    if (!task) return fail(res, 404, "Task not found.");

    if (!["completed", "failed"].includes(task.status)) {
      return fail(res, 409, "Only completed or failed tasks can be reopened.");
    }

    const previousStatus = task.status;

    task.status = "pending";
    task.completedAt = null;
    task.completedBy = null;
    task.failedAt = null;
    task.failedBy = null;
    task.failureReason = "";
    task.revision += 1;

    await task.save();

    await audit(
      task,
      req.user._id,
      "task.reopened",
      `Reopened task: ${task.title}`,
      [{ field: "status", before: previousStatus, after: "pending" }],
    );

    return res.json({
      success: true,
      message: "Task reopened successfully.",
      task,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return fail(res, 400, error.message);
    }
    return next(error);
  }
});

export default router;
