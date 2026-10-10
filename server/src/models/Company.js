import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Company name is required."],
      trim: true,
      maxlength: 120,
    },

    slug: {
      type: String,
      required: [true, "Company slug is required."],
      trim: true,
      lowercase: true,
      unique: true,
      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Company slug must contain lowercase letters, numbers, and hyphens.",
      ],
      maxlength: 80,
    },

    status: {
      type: String,
      enum: ["active", "suspended", "archived"],
      default: "active",
      index: true,
    },

    plan: {
      type: String,
      enum: ["free", "pro", "business", "enterprise"],
      default: "free",
      index: true,
    },

    subscription: {
      status: {
        type: String,
        enum: [
          "none",
          "trialing",
          "active",
          "past_due",
          "cancelled",
          "expired",
        ],
        default: "none",
      },

      provider: {
        type: String,
        enum: ["none", "stripe", "razorpay"],
        default: "none",
      },

      customerId: {
        type: String,
        default: null,
        select: false,
      },

      subscriptionId: {
        type: String,
        default: null,
        select: false,
      },

      currentPeriodEnd: {
        type: Date,
        default: null,
      },
    },

    settings: {
      timezone: {
        type: String,
        default: "Asia/Kolkata",
        trim: true,
      },

      weekStartsOn: {
        type: Number,
        min: 0,
        max: 6,
        default: 1,
      },

      allowMemberTaskCreation: {
        type: Boolean,
        default: true,
      },

      deletionRequiresPassword: {
        type: Boolean,
        default: true,
      },
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    archivedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

companySchema.index({ status: 1, createdAt: -1 });
companySchema.index({ plan: 1, "subscription.status": 1 });

const Company = mongoose.model("Company", companySchema);

export default Company;
