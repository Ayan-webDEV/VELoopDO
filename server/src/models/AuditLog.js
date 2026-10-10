import mongoose from "mongoose";

const { Schema } = mongoose;

const auditLogSchema = new Schema(
  {
    company: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    actor: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    task: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      default: null,
      index: true,
    },

    action: {
      type: String,
      enum: [
        "task.created",
        "task.updated",
        "task.completed",
        "task.failed",
        "task.deleted",
        "task.restored",
        "task.reopened",
        "task.assigned",
        "task.rescheduled",
        "task.occurrence_generated",
        "task.occurrence_skipped",
        "auth.login",
        "auth.logout",
        "auth.password_changed",
        "member.created",
        "member.updated",
        "member.suspended",
        "company.updated",
        "subscription.updated",
      ],
      required: true,
      index: true,
    },

    entityType: {
      type: String,
      enum: ["task", "user", "company", "subscription", "auth"],
      default: "task",
      index: true,
    },

    entityId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    summary: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    changes: {
      type: [
        {
          _id: false,
          field: {
            type: String,
            required: true,
            maxlength: 100,
          },
          before: {
            type: Schema.Types.Mixed,
            default: null,
          },
          after: {
            type: Schema.Types.Mixed,
            default: null,
          },
        },
      ],
      default: [],
      validate: {
        validator(changes) {
          return changes.length <= 50;
        },
        message: "An audit event cannot contain more than 50 changes.",
      },
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    requestId: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },

    occurredAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Company-scoped activity feed, newest first.
auditLogSchema.index({
  company: 1,
  occurredAt: -1,
});

// Member-specific performance reporting.
auditLogSchema.index({
  company: 1,
  actor: 1,
  action: 1,
  occurredAt: -1,
});

// Task history.
auditLogSchema.index({
  company: 1,
  task: 1,
  occurredAt: -1,
});

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

export default AuditLog;
