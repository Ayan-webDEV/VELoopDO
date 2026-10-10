import mongoose from "mongoose";

const { Schema } = mongoose;

const taskSchema = new Schema(
  {
    // Company isolation: every task belongs to one workspace.
    company: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: [true, "Task title is required."],
      trim: true,
      minlength: 1,
      maxlength: 200,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 10000,
      default: "",
    },

    label: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },

    links: {
      type: [
        {
          _id: false,
          title: {
            type: String,
            trim: true,
            maxlength: 100,
            default: "",
          },
          url: {
            type: String,
            trim: true,
            maxlength: 2048,
          },
        },
      ],
      default: [],
      validate: {
        validator(links) {
          return (
            Array.isArray(links) &&
            links.length <= 20 &&
            links.every((link) => {
              try {
                const parsed = new URL(link.url);
                return ["http:", "https:"].includes(parsed.protocol);
              } catch {
                return false;
              }
            })
          );
        },
        message: "Task links must be valid HTTP or HTTPS URLs.",
      },
    },

    category: {
      type: String,
      enum: ["daily", "fixed", "future"],
      required: true,
      index: true,
    },

    priority: {
      type: String,
      enum: ["high", "medium", "low"],
      default: "medium",
      index: true,
    },

    // Tasks are shared within the company but attributed to a member.
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: ["pending", "completed", "failed", "deleted"],
      default: "pending",
      index: true,
    },

    // Preserve the status that existed before a soft deletion.
    statusBeforeDeletion: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
      index: true,
    },

    completedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    failedAt: {
      type: Date,
      default: null,
      index: true,
    },

    failedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    failureReason: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    deletionReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    // Optional deadline for fixed or future work.
    dueAt: {
      type: Date,
      default: null,
      index: true,
    },

    // Future work can be scheduled to enter the active workload.
    scheduledFor: {
      type: Date,
      default: null,
      index: true,
    },

    // Supports recurring daily responsibilities.
    recurrence: {
      enabled: {
        type: Boolean,
        default: false,
      },

      frequency: {
        type: String,
        enum: ["daily"],
        default: "daily",
      },

      timezone: {
        type: String,
        default: "Asia/Kolkata",
        trim: true,
      },

      startDate: {
        type: Date,
        default: null,
      },

      endDate: {
        type: Date,
        default: null,
      },

      nextOccurrenceAt: {
        type: Date,
        default: null,
        index: true,
      },

      lastGeneratedDate: {
        type: String,
        default: null,
      },
    },

    // Stable ordering: older tasks win ties at the same priority.
    priorityOrder: {
      type: Number,
      required: true,
      default: () => Date.now(),
      index: true,
    },

    // A daily template can generate individual task occurrences.
    isRecurringTemplate: {
      type: Boolean,
      default: false,
      index: true,
    },

    recurringTemplate: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      default: null,
      index: true,
    },

    occurrenceDate: {
      type: String,
      default: null,
    },

    // Optimistic concurrency/versioning for safer edits.
    revision: {
      type: Number,
      default: 0,
      min: 0,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Tasks are always queried within a company.
taskSchema.index({
  company: 1,
  category: 1,
  status: 1,
  priorityOrder: 1,
});

taskSchema.index({
  company: 1,
  assignedTo: 1,
  status: 1,
  createdAt: -1,
});

taskSchema.index({
  company: 1,
  createdBy: 1,
  status: 1,
  completedAt: -1,
});

taskSchema.index({
  company: 1,
  "recurrence.enabled": 1,
  "recurrence.nextOccurrenceAt": 1,
});

// A template may have only one occurrence per local calendar date.
taskSchema.index(
  {
    recurringTemplate: 1,
    occurrenceDate: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      recurringTemplate: { $type: "objectId" },
      occurrenceDate: { $type: "string" },
    },
  },
);

taskSchema.pre("validate", function validateTaskRules() {
  if (this.category === "daily") {
    if (this.isNew && !this.recurringTemplate) {
      this.isRecurringTemplate = true;
      this.recurrence.enabled = true;
    }

    if (this.recurrence.enabled) {
      this.recurrence.frequency = "daily";

      if (!this.recurrence.timezone) {
        this.invalidate(
          "recurrence.timezone",
          "A timezone is required for recurring tasks.",
        );
      }
    }
  } else if (this.recurrence.enabled || this.isRecurringTemplate) {
    this.invalidate(
      "recurrence.enabled",
      "Only daily tasks can use daily recurrence.",
    );
  }

  if (
    this.recurrence.startDate &&
    this.recurrence.endDate &&
    this.recurrence.endDate < this.recurrence.startDate
  ) {
    this.invalidate(
      "recurrence.endDate",
      "Recurrence end date cannot be before its start date.",
    );
  }

  if (this.status === "completed" && (!this.completedAt || !this.completedBy)) {
    this.invalidate(
      "completedAt",
      "Completed tasks must record their completion time and member.",
    );
  }

  if (this.status === "failed" && (!this.failedAt || !this.failedBy)) {
    this.invalidate(
      "failedAt",
      "Failed tasks must record their failure time and member.",
    );
  }

  if (this.status === "deleted" && (!this.deletedAt || !this.deletedBy)) {
    this.invalidate(
      "deletedAt",
      "Deleted tasks must record their deletion time and member.",
    );
  }
});

const Task = mongoose.model("Task", taskSchema);

export default Task;
