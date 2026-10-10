import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "User name is required."],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    email: {
      type: String,
      required: [true, "Email is required."],
      trim: true,
      lowercase: true,
      unique: true,
      maxlength: 254,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Please provide a valid email address.",
      ],
    },

    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    role: {
      type: String,
      enum: ["owner", "ceo", "director", "manager", "hr", "member"],
      default: "member",
      index: true,
    },

    designation: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "Team Member",
    },

    permissions: {
      createTasks: {
        type: Boolean,
        default: true,
      },

      editOwnTasks: {
        type: Boolean,
        default: true,
      },

      editAllTasks: {
        type: Boolean,
        default: false,
      },

      deleteTasks: {
        type: Boolean,
        default: false,
      },

      viewAnalytics: {
        type: Boolean,
        default: false,
      },

      manageMembers: {
        type: Boolean,
        default: false,
      },

      manageBilling: {
        type: Boolean,
        default: false,
      },
    },

    status: {
      type: String,
      enum: ["active", "invited", "suspended"],
      default: "active",
      index: true,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    passwordChangedAt: {
      type: Date,
      default: Date.now,
    },

    failedLoginAttempts: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },

    lockedUntil: {
      type: Date,
      default: null,
      select: false,
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

// Always normalise email addresses before saving.
userSchema.pre("validate", function normalizeEmail() {
  if (this.email) {
    this.email = this.email.trim().toLowerCase();
  }
});

// Hash passwords when they are changed.
// The application should never save plaintext passwords.
userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("passwordHash")) {
    return;
  }

  const value = this.passwordHash;

  // Seed scripts and password-reset services should assign
  // an already bcrypt-hashed value to passwordHash.
  // Do not accept plaintext in this field.
  if (typeof value !== "string" || !/^\$2[aby]\$\d{2}\$/.test(value)) {
    throw new Error("passwordHash must contain a bcrypt-hashed password.");
  }

  // Re-hash only if a plaintext password is provided through
  // a separate, explicitly implemented password-setting service.
});

// Compare a login password against its stored bcrypt hash.
userSchema.methods.comparePassword = async function comparePassword(
  candidatePassword,
) {
  if (typeof candidatePassword !== "string" || !this.passwordHash) {
    return false;
  }

  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Never return credential or lockout fields in API responses.
userSchema.methods.toJSON = function toJSON() {
  const user = this.toObject();

  delete user.passwordHash;
  delete user.failedLoginAttempts;
  delete user.lockedUntil;
  delete user.__v;

  return user;
};

userSchema.index({ company: 1, status: 1, role: 1 });
userSchema.index({ company: 1, createdAt: -1 });

const User = mongoose.model("User", userSchema);

export default User;
