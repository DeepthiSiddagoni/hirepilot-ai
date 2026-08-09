import fs from "node:fs";
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const sql = neon(process.env.DATABASE_URL);

const FILE = "data/c2c-verified-apply-queue.json";

if (!fs.existsSync(FILE)) {
  throw new Error(`${FILE} does not exist`);
}

const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));

const jobs =
  Array.isArray(raw)
    ? raw
    : raw.jobs ??
      raw.queue ??
      raw.results ??
      raw.items ??
      [];

function text(value) {
  if (value === null || value === undefined) return "";

  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    return Object.values(value)
      .map(text)
      .filter(Boolean)
      .join(", ");
  }

  return String(value).trim();
}

function pick(job, keys) {
  for (const key of keys) {
    const value = text(job?.[key]);
    if (value) return value;
  }

  return "";
}

function canonicalizeUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value);

    url.hash = "";

    const remove = [];

    for (const key of url.searchParams.keys()) {
      const lower = key.toLowerCase();

      if (
        lower.startsWith("utm_") ||
        [
          "source",
          "src",
          "ref",
          "referrer",
          "trk",
          "tracking",
          "campaign",
        ].includes(lower)
      ) {
        remove.push(key);
      }
    }

    for (const key of remove) {
      url.searchParams.delete(key);
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

function hostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

await sql`
  CREATE TABLE IF NOT EXISTS c2c_apply_queue (
    job_key TEXT PRIMARY KEY,
    action TEXT,
    role TEXT NOT NULL,
    company TEXT,
    location TEXT,
    min_years TEXT,
    c2c TEXT,
    visa TEXT,
    source TEXT,
    job_url TEXT,
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS idx_c2c_apply_queue_active
  ON c2c_apply_queue(active, first_seen_at DESC)
`;

//
// Current verified queue becomes the active queue.
// Jobs absent from the latest verification are not shown.
//
await sql`
  UPDATE c2c_apply_queue
  SET active = FALSE,
      updated_at = NOW()
  WHERE active = TRUE
`;

let inserted = 0;

for (const job of jobs) {
  const role = pick(job, [
    "role",
    "title",
    "job_title",
    "jobTitle",
  ]);

  const company = pick(job, [
    "company",
    "company_name",
    "companyName",
    "employer",
  ]);

  const location = pick(job, [
    "location",
    "job_location",
    "jobLocation",
  ]);

  const minYears = pick(job, [
    "min_years",
    "minimum_years",
    "years_experience_min",
    "years",
    "experience",
  ]);

  const c2c = pick(job, [
    "c2c",
    "c2c_type",
    "contract_type",
    "c2c_status",
    "employment_type",
  ]);

  const visa = pick(job, [
    "visa",
    "visa_status",
    "work_authorization",
    "sponsorship",
  ]);

  const action =
    pick(job, [
      "action",
      "apply_action",
      "queue_action",
    ]) || "RECRUITER_FIRST";

  const rawUrl = pick(job, [
    "job_url",
    "apply_url",
    "url",
    "link",
    "jobUrl",
  ]);

  const jobUrl = canonicalizeUrl(rawUrl);

  const source =
    pick(job, [
      "source",
      "source_name",
      "job_source",
      "provider",
    ]) || hostname(jobUrl);

  if (!role || !jobUrl) {
    continue;
  }

  const keyBasis =
    jobUrl ||
    `${role.toLowerCase()}|${company.toLowerCase()}|${location.toLowerCase()}`;

  const jobKey = crypto
    .createHash("sha256")
    .update(keyBasis)
    .digest("hex");

  await sql`
    INSERT INTO c2c_apply_queue (
      job_key,
      action,
      role,
      company,
      location,
      min_years,
      c2c,
      visa,
      source,
      job_url,
      active,
      first_seen_at,
      last_seen_at,
      updated_at
    )
    VALUES (
      ${jobKey},
      ${action},
      ${role},
      ${company},
      ${location},
      ${minYears},
      ${c2c},
      ${visa},
      ${source},
      ${jobUrl},
      TRUE,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (job_key)
    DO UPDATE SET
      action = EXCLUDED.action,
      role = EXCLUDED.role,
      company = EXCLUDED.company,
      location = EXCLUDED.location,
      min_years = EXCLUDED.min_years,
      c2c = EXCLUDED.c2c,
      visa = EXCLUDED.visa,
      source = EXCLUDED.source,
      job_url = EXCLUDED.job_url,
      active = TRUE,
      last_seen_at = NOW(),
      updated_at = NOW()
  `;

  inserted++;
}

console.log("===== C2C QUEUE DATABASE SYNC =====");
console.log("Verified input jobs:", jobs.length);
console.log("Active unique jobs:", inserted);
