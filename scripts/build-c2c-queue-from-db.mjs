import fs from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  SELECT
    to_jsonb(j) AS job,
    COALESCE(c.name, '') AS company,
    to_jsonb(ja) AS analysis
  FROM jobs j
  LEFT JOIN companies c
    ON c.id = j.company_id
  LEFT JOIN job_analysis ja
    ON ja.job_id = j.id
  ORDER BY
    COALESCE(j.posted_at, j.discovered_at) DESC NULLS LAST
  LIMIT 5000
`;

function str(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalize(value) {
  return str(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bool(value) {
  return (
    value === true ||
    String(value).toLowerCase() === "true"
  );
}

function canonicalUrl(value) {
  const raw = str(value);

  if (!raw) return "";

  try {
    const url = new URL(raw);

    url.hash = "";

    const remove = [];

    for (const key of url.searchParams.keys()) {
      const lower = key.toLowerCase();

      if (
        lower.startsWith("utm_") ||
        [
          "src",
          "source",
          "ref",
          "referrer",
          "tracking",
          "trk",
          "campaign"
        ].includes(lower)
      ) {
        remove.push(key);
      }
    }

    for (const key of remove) {
      url.searchParams.delete(key);
    }

    return url
      .toString()
      .replace(/\/$/, "");
  } catch {
    return raw;
  }
}

function hostname(url) {
  try {
    return new URL(url)
      .hostname
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function getAgeHours(job) {
  const value =
    job.posted_at ||
    job.discovered_at ||
    job.updated_at;

  if (!value) return 9999;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 9999;
  }

  return Math.max(
    0,
    (Date.now() - date.getTime()) /
      (1000 * 60 * 60)
  );
}

function extractMinYears(job, text) {
  const direct =
    job.years_experience_min ??
    job.minimum_years ??
    job.min_years ??
    null;

  if (
    direct !== null &&
    direct !== undefined &&
    direct !== ""
  ) {
    return str(direct);
  }

  const patterns = [
    /(\d+)\s*\+\s*years?/i,
    /minimum\s+of\s+(\d+)\s+years?/i,
    /at\s+least\s+(\d+)\s+years?/i,
    /(\d+)\s*-\s*\d+\s+years?/i,
    /(\d+)\s+years?\s+of\s+experience/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      return match[1];
    }
  }

  return "";
}

function visaLabel(job, text) {
  const values = [];

  if (bool(job.h1b_supported)) {
    values.push("h1b");
  }

  if (
    bool(job.stem_opt_supported) ||
    bool(job.opt_supported)
  ) {
    values.push("opt");
  }

  if (bool(job.cpt_supported)) {
    values.push("cpt");
  }

  if (
    values.length === 0 &&
    /\bh-?1b\b/i.test(text)
  ) {
    values.push("h1b");
  }

  if (
    values.length === 0 &&
    /\bstem opt\b|\bopt\b/i.test(text)
  ) {
    values.push("opt");
  }

  if (values.length) {
    return [...new Set(values)].join(", ");
  }

  return (
    str(job.sponsorship_status) ||
    "Ask recruiter"
  );
}

function roleRelevance(title, analysis) {
  const family = normalize(
    analysis?.primary_role_family ||
    analysis?.role_family ||
    ""
  );

  const targetFamilies = [
    "data bi analytics reporting",
    "database sql dba",
    "business systems functional analysis",
    "qa testing validation",
    "project management pmo coordination",
    "networking infrastructure",
    "systems administration it operations",
    "data center infrastructure controls commissioning",
    "cloud devops platform",
    "product management product operations"
  ];

  let score = 0;

  if (
    targetFamilies.some(
      familyName =>
        family.includes(familyName)
    )
  ) {
    score += 50;
  }

  const titleText = normalize(title);

  const strong = [
    "data analyst",
    "data engineer",
    "database",
    "sql developer",
    "sql analyst",
    "power bi",
    "business intelligence",
    "bi developer",
    "snowflake",
    "etl",
    "reporting analyst",
    "business analyst",
    "systems analyst",
    "qa analyst",
    "qa engineer",
    "quality analyst",
    "project manager",
    "project coordinator",
    "network engineer",
    "network analyst",
    "infrastructure engineer",
    "systems administrator",
    "systems engineer",
    "controls engineer",
    "commissioning",
    "data center",
    "product owner",
    "product analyst"
  ];

  for (const keyword of strong) {
    if (titleText.includes(keyword)) {
      score += 20;
    }
  }

  return score;
}

const queue = [];

for (const row of rows) {
  const job = row.job || {};
  const analysis = row.analysis || {};

  const title = str(job.title);

  if (!title) continue;

  const company =
    str(row.company) ||
    str(job.company) ||
    str(job.company_name);

  const location =
    str(job.location) ||
    str(job.job_location);

  const url = canonicalUrl(
    job.job_url ||
    job.absolute_url ||
    job.apply_url ||
    job.url
  );

  if (!url) continue;

  const description =
    str(job.description);

  const rawText = [
    title,
    description,
    job.employment_type,
    job.contract_type,
    job.remote_type,
    JSON.stringify(job.raw_data || {})
  ]
    .filter(Boolean)
    .join(" ");

  const text = rawText.toLowerCase();

  const source =
    str(job.source) ||
    str(job.source_name) ||
    hostname(url);

  const explicitNoC2C =
    /\bno\s+c2c\b|\bno\s+corp[- ]?to[- ]?corp\b|\bw-?2\s+only\b/i
      .test(text.replace(/\s+/g, " "));

  const explicitC2C =
    !explicitNoC2C &&
    (
      bool(job.c2c_supported) ||
      /\bc2c\b/i.test(text) ||
      /\bcorp[- ]?to[- ]?corp\b/i.test(text) ||
      /\bcorp\s+to\s+corp\b/i.test(text) ||
      /\b1099\b/i.test(text) ||
      source.includes("corptocorp")
    );

  const explicitW2 =
    bool(job.w2_supported) ||
    /\bw-?2\b/i.test(text);

  const contract =
    bool(job.contract_supported) ||
    explicitC2C ||
    /\bcontract\b/i.test(text) ||
    /\bcontract[- ]?to[- ]?hire\b/i.test(text) ||
    /\bc2h\b/i.test(text) ||
    /\btemporary\b/i.test(text);

  const fullTime =
    /\bfull[- ]?time\b/i.test(text) ||
    /\bpermanent\b/i.test(text) ||
    /\bdirect hire\b/i.test(text);

  let type = "";

  if (explicitC2C) {
    type = "c2c";
  } else if (contract && explicitW2) {
    type = "w2-contract";
  } else if (contract) {
    type = "contract";
  } else if (fullTime) {
    type = "full-time";
  } else {
    continue;
  }

  const ageHours = getAgeHours(job);

  // Keep current/recent opportunities.
  // Older jobs can still remain in the normal HirePilot dashboard.
  if (ageHours > 14 * 24) {
    continue;
  }

  const relevance =
    roleRelevance(title, analysis);

  // Special Apply Queue should stay useful.
  if (relevance <= 0) {
    continue;
  }

  let c2cLabel = "Ask recruiter";
  let action = "RECRUITER_FIRST";

  if (type === "c2c") {
    c2cLabel = "c2c, corp to corp";
    action = "FAST_APPLY";
  } else if (type === "w2-contract") {
    c2cLabel = "W2 contract";
    action = "RECRUITER_FIRST";
  } else if (type === "contract") {
    c2cLabel = "contract — ask C2C";
    action = "RECRUITER_FIRST";
  } else {
    c2cLabel = "full-time";
    action = "RECRUITER_FIRST";
  }

  const typeRank = {
    c2c: 1,
    "w2-contract": 2,
    contract: 3,
    "full-time": 4
  }[type];

  queue.push({
    action,
    role: title,
    title,
    company,
    location,
    min_years: extractMinYears(
      job,
      rawText
    ),
    c2c: c2cLabel,
    visa: visaLabel(
      job,
      rawText
    ),
    source,
    job_url: url,
    type,
    age_hours: ageHours,
    relevance
  });
}


// ============================================================
// REMOVE DUPLICATES
// ============================================================

const unique = [];
const seenUrls = new Set();
const seenSignatures = new Set();

queue
  .sort((a, b) => {
    const rank = {
      c2c: 1,
      "w2-contract": 2,
      contract: 3,
      "full-time": 4
    };

    return (
      rank[a.type] - rank[b.type] ||
      b.relevance - a.relevance ||
      a.age_hours - b.age_hours
    );
  })
  .forEach(job => {
    const urlKey =
      normalize(job.job_url);

    const signature = [
      normalize(job.role),
      normalize(job.company),
      normalize(job.location)
    ].join("|");

    if (
      seenUrls.has(urlKey) ||
      seenSignatures.has(signature)
    ) {
      return;
    }

    seenUrls.add(urlKey);
    seenSignatures.add(signature);

    unique.push(job);
  });


// Keep the fast queue manageable.
const finalQueue =
  unique.slice(0, 300);

await fs.mkdir("data", {
  recursive: true
});

await fs.writeFile(
  "data/c2c-verified-apply-queue.json",
  JSON.stringify(
    finalQueue,
    null,
    2
  )
);

console.log(
  "===== FREE HIREPILOT APPLY QUEUE ====="
);

console.log(
  "Database jobs checked:",
  rows.length
);

console.log(
  "Unique relevant jobs:",
  finalQueue.length
);

console.log(
  "C2C:",
  finalQueue.filter(
    j => j.type === "c2c"
  ).length
);

console.log(
  "W2 contract:",
  finalQueue.filter(
    j => j.type === "w2-contract"
  ).length
);

console.log(
  "Other contract:",
  finalQueue.filter(
    j => j.type === "contract"
  ).length
);

console.log(
  "Full-time:",
  finalQueue.filter(
    j => j.type === "full-time"
  ).length
);

console.log(
  "Saved: data/c2c-verified-apply-queue.json"
);
