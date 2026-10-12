import webpush from "web-push";

import Task from "../models/Task.js";
import PushSubscription from "../models/PushSubscription.js";

const POLL_MS = 30_000;

let timer = null;
let running = false;

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDateKey(date, timezone) {
  const parts = localParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localTimeKey(date, timezone) {
  const parts = localParts(date, timezone);
  return `${parts.hour}:${parts.minute}`;
}

function configureWebPush() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return false;
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT || "mailto:admin@veloopdo.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );

  return true;
}

async function generateDailyOccurrences(now) {
  const templates = await Task.find({
    category: "daily",
    isRecurringTemplate: true,
    "recurrence.enabled": true,
    status: "pending",
    workingStartTime: { $ne: null },
    workingEndTime: { $ne: null },
  }).lean();

  for (const template of templates) {
    const timezone =
      template.alarmTimezone || template.recurrence?.timezone || "Asia/Kolkata";

    const today = localDateKey(now, timezone);
    const startDate = template.recurrence?.startDate;
    const endDate = template.recurrence?.endDate;

    if (startDate && localDateKey(new Date(startDate), timezone) > today) {
      continue;
    }

    if (endDate && localDateKey(new Date(endDate), timezone) < today) {
      continue;
    }

    try {
      await Task.updateOne(
        {
          company: template.company,
          recurringTemplate: template._id,
          occurrenceDate: today,
        },
        {
          $setOnInsert: {
            company: template.company,
            title: template.title,
            description: template.description,
            label: template.label,
            links: template.links || [],
            category: "daily",
            priority: template.priority,
            createdBy: template.createdBy,
            assignedTo: template.assignedTo || null,
            status: "pending",
            priorityOrder: template.priorityOrder,
            isRecurringTemplate: false,
            recurringTemplate: template._id,
            occurrenceDate: today,
            dueAt: template.dueAt || null,
            workingDate: today,
            workingStartTime: template.workingStartTime,
            workingEndTime: template.workingEndTime,
            alarmTimezone: timezone,
            alarm: {
              lastReminderAt: null,
              nextReminderAt: null,
              workingStartedAt: null,
              acknowledgedAt: null,
              reminderCount: 0,
            },
            recurrence: {
              enabled: false,
              frequency: "daily",
              timezone,
            },
          },
        },
        {
          upsert: true,
          runValidators: true,
        },
      );
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }
    }
  }
}

async function deliverTaskReminder(task, now) {
  const recipientId = task.assignedTo || task.createdBy;

  if (!recipientId) {
    return false;
  }

  const subscriptions = await PushSubscription.find({
    company: task.company,
    user: recipientId,
  }).lean();

  if (!subscriptions.length) {
    return false;
  }

  const payload = JSON.stringify({
    title: "VELoopDO · Task reminder",
    body: `${task.title} · ${task.workingStartTime}–${task.workingEndTime}`,
    taskId: String(task._id),
    url: "/",
    actions: [
      {
        action: "working",
        title: "I'm working",
      },
      {
        action: "snooze",
        title: "Remind me in 7 min",
      },
    ],
    timestamp: now.toISOString(),
  });

  let delivered = false;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        payload,
        {
          TTL: 300,
          urgency: "high",
        },
      );

      delivered = true;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await PushSubscription.deleteOne({
          _id: subscription._id,
        });
      } else {
        console.error(
          "Task push notification failed:",
          error.statusCode || error.message,
        );
      }
    }
  }

  if (delivered) {
    await Task.updateOne(
      {
        _id: task._id,
        status: "pending",
        "alarm.acknowledgedAt": null,
        "alarm.workingStartedAt": null,
      },
      {
        $set: {
          "alarm.lastReminderAt": now,
          "alarm.nextReminderAt": new Date(now.getTime() + 10 * 60 * 1000),
        },
        $inc: {
          "alarm.reminderCount": 1,
        },
      },
    );
  }

  return delivered;
}

async function pollReminders() {
  if (running || !configureWebPush()) {
    return;
  }

  running = true;

  try {
    const now = new Date();

    await generateDailyOccurrences(now);

    const tasks = await Task.find({
      status: "pending",
      isRecurringTemplate: false,
      workingStartTime: { $ne: null },
      workingEndTime: { $ne: null },
      "alarm.acknowledgedAt": null,
      "alarm.workingStartedAt": null,
      $or: [
        { "alarm.nextReminderAt": null },
        { "alarm.nextReminderAt": { $lte: now } },
      ],
    })
      .limit(500)
      .lean();

    for (const task of tasks) {
      const timezone = task.alarmTimezone || "Asia/Kolkata";
      const today = localDateKey(now, timezone);

      const scheduledDate =
        task.category === "daily" ? task.occurrenceDate : task.workingDate;

      if (scheduledDate !== today) {
        continue;
      }

      const currentTime = localTimeKey(now, timezone);

      if (
        currentTime < task.workingStartTime ||
        currentTime > task.workingEndTime
      ) {
        continue;
      }

      await deliverTaskReminder(task, now);
    }
  } catch (error) {
    console.error("Reminder scheduler failed:", error.message);
  } finally {
    running = false;
  }
}

export function startReminderScheduler() {
  if (timer) {
    return;
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn(
      "Web Push is disabled: configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable closed-browser reminders.",
    );
  }

  timer = setInterval(pollReminders, POLL_MS);
  timer.unref?.();

  void pollReminders();
}

export function stopReminderScheduler() {
  if (timer) {
    clearInterval(timer);
  }

  timer = null;
}
