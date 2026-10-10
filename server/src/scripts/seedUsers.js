import "dotenv/config";

import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import Company from "../models/Company.js";
import User from "../models/User.js";

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value || value.startsWith("replace_with_")) {
    throw new Error(`${name} is missing or still contains a placeholder.`);
  }

  return value;
}

function validatePassword(password, variableName) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  ) {
    throw new Error(
      `${variableName} must contain between 12 and 128 characters.`,
    );
  }

  return password;
}

async function createOrUpdateUser({
  name,
  email,
  password,
  role,
  designation,
  companyId,
  permissions,
}) {
  let user = await User.findOne({ email }).select(
    "+passwordHash +passwordChangedAt",
  );

  if (user && String(user.company) !== String(companyId)) {
    throw new Error(
      `Account ${email} already belongs to another company. Resolve this conflict manually.`,
    );
  }

  if (!user) {
    const passwordHash = await bcrypt.hash(password, 12);

    user = await User.create({
      name,
      email,
      passwordHash,
      company: companyId,
      role,
      designation,
      permissions,
      status: "active",
      createdBy: null,
      passwordChangedAt: new Date(),
    });

    console.log(`Created account: ${email}`);
    return user;
  }

  // Keep account identity and role aligned with the configured bootstrap.
  // Existing passwords are preserved unless an explicit reset is requested.
  user.name = name;
  user.role = role;
  user.designation = designation;
  user.status = "active";
  user.archivedAt = null;
  user.permissions = permissions;

  if (process.env.RESET_SEED_PASSWORD === "true") {
    user.passwordHash = await bcrypt.hash(password, 12);
    user.passwordChangedAt = new Date();
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;

    console.log(`Reset password for: ${email}`);
  }

  await user.save();

  console.log(`Updated account configuration: ${email}`);
  return user;
}

async function seed() {
  const founderName = process.env.USER1_NAME || "Founder & CEO";
  const founderEmail = requiredEnv("USER1_EMAIL").toLowerCase();
  const founderPassword = validatePassword(
    requiredEnv("USER1_PASSWORD"),
    "USER1_PASSWORD",
  );

  const directorName = process.env.USER2_NAME || "Marketing Director";
  const directorEmail = requiredEnv("USER2_EMAIL").toLowerCase();
  const directorPassword = validatePassword(
    requiredEnv("USER2_PASSWORD"),
    "USER2_PASSWORD",
  );

  if (founderEmail === directorEmail) {
    throw new Error("USER1_EMAIL and USER2_EMAIL must be different.");
  }

  if (founderPassword === directorPassword) {
    throw new Error("Use different passwords for the two accounts.");
  }

  const companyName = process.env.BOOTSTRAP_COMPANY_NAME || "VELoop";
  const companySlug = (
    process.env.BOOTSTRAP_COMPANY_SLUG || "veloop"
  ).toLowerCase();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(companySlug)) {
    throw new Error("BOOTSTRAP_COMPANY_SLUG is invalid.");
  }

  await mongoose.connect(requiredEnv("MONGODB_URI"), {
    serverSelectionTimeoutMS: 10000,
  });

  console.log("Connected to MongoDB.");

  let company = await Company.findOne({ slug: companySlug });

  if (!company) {
    company = await Company.create({
      name: companyName,
      slug: companySlug,
      status: "active",
      plan: "free",
      settings: {
        timezone: process.env.APP_TIMEZONE || "Asia/Kolkata",
        weekStartsOn: 1,
        allowMemberTaskCreation: true,
        deletionRequiresPassword: true,
      },
    });

    console.log(`Created company workspace: ${company.name}`);
  } else {
    company.name = companyName;
    company.status = "active";
    company.archivedAt = null;
    company.settings.timezone = process.env.APP_TIMEZONE || "Asia/Kolkata";

    await company.save();

    console.log(`Using company workspace: ${company.name}`);
  }

  const founder = await createOrUpdateUser({
    name: founderName,
    email: founderEmail,
    password: founderPassword,
    role: "owner",
    designation: "Founder & CEO",
    companyId: company._id,
    permissions: {
      createTasks: true,
      editOwnTasks: true,
      editAllTasks: true,
      deleteTasks: true,
      viewAnalytics: true,
      manageMembers: true,
      manageBilling: true,
    },
  });

  await createOrUpdateUser({
    name: directorName,
    email: directorEmail,
    password: directorPassword,
    role: "director",
    designation: "Marketing Director",
    companyId: company._id,
    permissions: {
      createTasks: true,
      editOwnTasks: true,
      editAllTasks: true,
      deleteTasks: true,
      viewAnalytics: true,
      manageMembers: false,
      manageBilling: false,
    },
  });

  if (!company.createdBy) {
    company.createdBy = founder._id;
    await company.save();
  }

  const activeAccounts = await User.countDocuments({
    company: company._id,
    status: "active",
    archivedAt: null,
  });

  if (activeAccounts !== 2) {
    console.warn(
      `Warning: ${activeAccounts} active accounts exist in this workspace. Review membership before using the private two-account version.`,
    );
  }

  console.log("");
  console.log("VELoopDO bootstrap completed.");
  console.log(`Workspace: ${company.name}`);
  console.log(`Founder account: ${founderEmail}`);
  console.log(`Marketing Director account: ${directorEmail}`);
  console.log(`Active accounts: ${activeAccounts}`);
  console.log("");
  console.log("No passwords have been printed.");
}

seed()
  .catch((error) => {
    console.error("VELoopDO bootstrap failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
