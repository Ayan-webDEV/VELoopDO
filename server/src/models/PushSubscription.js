import mongoose from "mongoose";

const pushSubscriptionSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
    },
    keys: {
      p256dh: {
        type: String,
        required: true,
      },
      auth: {
        type: String,
        required: true,
      },
    },
    expirationTime: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

pushSubscriptionSchema.index({ company: 1, user: 1 });

export default mongoose.model("PushSubscription", pushSubscriptionSchema);
