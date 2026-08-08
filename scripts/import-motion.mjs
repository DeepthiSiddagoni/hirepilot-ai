import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const sql = neon(process.env.DATABASE_URL);

const BASE = "https://motionrecruitment.com";
const LISTING = `${BASE}/tech-jobs`;

const headers = {
  "User-Agent":
    "Mozilla/5.0 (compatible; HirePilot/1.0; job discovery)",
  Accept: "text/html,application/xhtml+xml"
};

function qi(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function columns(table) {
  return sql`
    SELECT
      column_name,
      data_type,
      is_nullable,
      column_default,
      is_identity
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
    ORDER BY ordinal_position
  `;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  return response.text();
}

function decode(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function strip(value = "") {
  return decode(
    String(value)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function absoluteUrl(value) {
  if (!value) return null;

  try {
    return new URL(value, BASE).toString();
  } catch {
    return null;
  }
}

function findJobPosting(value) {
  if (!value) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findJobPosting(item);
      if (result) return result;
    }
    return null;
  }

  if (typeof value !== "object") return null;

  const type = value["@type"];

  if (
    type === "JobPosting" ||
    (Array.isArray(type) && type.includes("JobPosting"))
  ) {
    return value;
  }

  for (const child of Object.values(value)) {
    if (typeof child === "object") {
      const result = findJobPosting(child);
      if (result) return result;
    }
  }

  return null;
}

function jsonLd(html) {
  const regex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(regex)) {
    try {
      const value = JSON.parse(
        decode(match[1]).trim()
      );

      const posting = findJobPosting(value);

      if (posting) return posting;
    } catch {}
  }

  return null;
}

function getTitle(html, posting) {
  if (posting?.title) {
    return strip(posting.title);
  }

  const m = html.match(
    /<h1[^>]*>([\s\S]*?)<\/h1>/i
  );

  return m ? strip(m[1]) : null;
}

function getLocation(posting, text) {
  const locations = Array.isArray(posting?.jobLocation)
    ? posting.jobLocation
    : posting?.jobLocation
      ? [posting.jobLocation]
      : [];

  for (const item of locations) {
    const a = item?.address ?? {};

    const pieces = [
      a.addressLocality,
      a.addressRegion,
      a.addressCountry
    ].filter(Boolean);

    if (pieces.length) {
      return pieces.join(", ");
    }
  }

  const match = text.match(
    /\b([A-Za-z .'-]+,\s*(?:Texas|TX|Arizona|AZ|North Carolina|NC|Georgia|GA|California|CA|Florida|FL|New York|NY|New Jersey|NJ|Illinois|IL|Ohio|OH|Minnesota|MN|Pennsylvania|PA|Maryland|MD|Virginia|VA|Washington|WA|Colorado|CO|Massachusetts|MA|Michigan|MI|Oregon|OR|Alabama|AL|Iowa|IA))\b/i
  );

  return match?.[1]?.trim() ?? null;
}

function remoteType(text, posting) {
  const t = text.slice(0, 6000);

  if (
    String(posting?.jobLocationType ?? "")
      .toUpperCase()
      .includes("TELECOMMUTE") ||
    /100%\s*Remote|Open to Remote/i.test(t)
  ) {
    return "remote";
  }

  if (/\bHybrid\b/i.test(t)) {
    return "hybrid";
  }

  if (/\bOnsite\b|\bOn-site\b|Local Only/i.test(t)) {
    return "onsite";
  }

  return null;
}

function employmentType(text) {
  const t = text.slice(0, 8000);

  if (
    /contract[\s-]*to[\s-]*hire/i.test(t)
  ) {
    return "contract-to-hire";
  }

  return "contract";
}

function salary(text, posting) {
  let min = null;
  let max = null;
  let currency = "USD";
  let period = "hour";

  const s = posting?.baseSalary;

  if (s) {
    currency = s.currency ?? currency;

    const value = s.value ?? s;

    if (value?.minValue != null) {
      min = Number(value.minValue);
    }

    if (value?.maxValue != null) {
      max = Number(value.maxValue);
    }

    if (value?.unitText) {
      period = String(value.unitText).toLowerCase();
    }
  }

  if (min == null && max == null) {
    const m = text.match(
      /\$(\d+(?:\.\d+)?)\s*\/?\s*hr\s*-\s*\$(\d+(?:\.\d+)?)\s*\/?\s*hr/i
    );

    if (m) {
      min = Number(m[1]);
      max = Number(m[2]);
    }
  }

  return {
    salary_min: Number.isFinite(min) ? min : null,
    salary_max: Number.isFinite(max) ? max : null,
    salary_currency: currency,
    salary_period: period
  };
}

function externalId(url) {
  const match = url.match(/\/(\d+)\/?$/);
  return match?.[1] ?? url;
}

async function ensureCompany() {
  const found = await sql`
    SELECT id
    FROM companies
    WHERE LOWER(name) = LOWER('Motion Recruitment')
    LIMIT 1
  `;

  if (found.length) return found[0].id;

  const schema = await columns("companies");
  const names = new Set(
    schema.map(x => x.column_name)
  );

  const data = {};

  if (names.has("name")) {
    data.name = "Motion Recruitment";
  }

  if (names.has("domain")) {
    data.domain = "motionrecruitment.com";
  }

  if (names.has("website")) {
    data.website = BASE;
  }

  if (names.has("website_url")) {
    data.website_url = BASE;
  }

  if (names.has("careers_url")) {
    data.careers_url =
      `${LISTING}?start=0&types=contract`;
  }

  if (names.has("active")) {
    data.active = true;
  }

  if (names.has("created_at")) {
    data.created_at = new Date();
  }

  if (names.has("updated_at")) {
    data.updated_at = new Date();
  }

  const cols = Object.keys(data);
  const vals = Object.values(data);

  const query = `
    INSERT INTO companies (
      ${cols.map(qi).join(",")}
    )
    VALUES (
      ${cols.map((_, i) => `$${i + 1}`).join(",")}
    )
    RETURNING id
  `;

  const rows = await sql.query(query, vals);

  return rows[0].id;
}

async function ensureSource(companyId) {
  const schema = await columns("job_sources");

  if (!schema.length) return null;

  const names = new Set(
    schema.map(x => x.column_name)
  );

  for (const field of [
    "source_key",
    "slug",
    "name",
    "source_name"
  ]) {
    if (!names.has(field)) continue;

    const target =
      field === "name" ||
      field === "source_name"
        ? "Motion Recruitment"
        : "motion";

    const rows = await sql.query(
      `SELECT id
       FROM job_sources
       WHERE LOWER(${qi(field)}::text) = LOWER($1)
       LIMIT 1`,
      [target]
    );

    if (rows.length) {
      return rows[0].id;
    }
  }

  const data = {};

  const set = (name, value) => {
    if (names.has(name)) {
      data[name] = value;
    }
  };

  set("name", "Motion Recruitment");
  set("source_name", "Motion Recruitment");
  set("source_type", "motion");
  set("source_key", "motion");
  set("slug", "motion");
  set("provider", "motion");

  set(
    "base_url",
    `${LISTING}?start=0&types=contract`
  );

  set(
    "url",
    `${LISTING}?start=0&types=contract`
  );

  set("company_id", companyId);
  set("active", true);
  set("is_active", true);
  set("created_at", new Date());
  set("updated_at", new Date());

  const cols = Object.keys(data);
  const vals = Object.values(data);

  const query = `
    INSERT INTO job_sources (
      ${cols.map(qi).join(",")}
    )
    VALUES (
      ${cols.map((_, i) => `$${i + 1}`).join(",")}
    )
    RETURNING id
  `;

  const rows = await sql.query(query, vals);

  return rows[0]?.id ?? null;
}

async function discoverJobs() {
  const urls = new Set();

  for (
    let start = 0;
    start <= 500;
    start += 20
  ) {
    const url =
      `${LISTING}?start=${start}&types=contract`;

    console.log("Scanning:", url);

    const html = await fetchHtml(url);

    const before = urls.size;

    const regex =
      /href=["']([^"']*\/tech-jobs\/[^"']+\/contract\/[^"']+\/\d+\/?)["']/gi;

    for (const match of html.matchAll(regex)) {
      const u = absoluteUrl(match[1]);

      if (u) {
        urls.add(
          u.split("?")[0].split("#")[0]
        );
      }
    }

    const added = urls.size - before;

    console.log(
      `  New URLs: ${added} | Total: ${urls.size}`
    );

    if (start > 0 && added === 0) {
      break;
    }
  }

  return [...urls];
}

async function saveJob(
  url,
  companyId,
  sourceId,
  jobColumns
) {
  const html = await fetchHtml(url);

  const posting = jsonLd(html);
  const text = strip(html);

  const title = getTitle(html, posting);

  if (!title) {
    return {
      status: "skip",
      reason: "title"
    };
  }

  const type = employmentType(text);
  const location = getLocation(posting, text);
  const remote = remoteType(text, posting);
  const pay = salary(text, posting);

  const description = strip(
    posting?.description ?? text
  ).slice(0, 50000);

  const explicitW2 =
    /\bw[\s-]?2\b|\bw2 only\b/i.test(
      description
    );

  const explicitC2C =
    /\bc2c\b|corp[\s-]*to[\s-]*corp/i.test(
      description
    );

  const noSponsorship =
    /no sponsorship is currently available|no sponsorship available/i.test(
      description
    );

  const row = {
    company_id: companyId,
    source_id: sourceId,

    external_job_id: externalId(url),

    title,
    description,
    location,

    remote_type: remote,
    employment_type: type,

    job_url: url,

    salary_min: pay.salary_min,
    salary_max: pay.salary_max,
    salary_currency: pay.salary_currency,
    salary_period: pay.salary_period,

    posted_at:
      posting?.datePosted ?? null,

    discovered_at: new Date(),

    active: true,

    contract_supported: true,

    contract_type: type,

    w2_supported: explicitW2,

    /*
     * IMPORTANT:
     * Contract does NOT automatically mean C2C.
     */
    c2c_supported: explicitC2C,

    h1b_supported:
      noSponsorship ? false : null,

    sponsorship_status:
      noSponsorship
        ? "No Sponsorship"
        : null,

    last_seen_at: new Date(),
    updated_at: new Date(),

    raw_data: JSON.stringify({
      source: "motion_recruitment",
      explicit_w2: explicitW2,
      explicit_c2c: explicitC2C,
      no_sponsorship: noSponsorship,
      jobPosting: posting,
      url
    })
  };

  const allowed = Object.entries(row)
    .filter(([column]) =>
      jobColumns.has(column)
    );

  const cols = allowed.map(([c]) => c);
  const vals = allowed.map(([, v]) => v);

  const placeholders = cols.map(
    (column, i) =>
      column === "raw_data"
        ? `$${i + 1}::jsonb`
        : `$${i + 1}`
  );

  const updates = cols.filter(
    c =>
      ![
        "company_id",
        "source_id",
        "job_url",
        "discovered_at"
      ].includes(c)
  );

  const query = `
    INSERT INTO jobs (
      ${cols.map(qi).join(",")}
    )
    VALUES (
      ${placeholders.join(",")}
    )

    ON CONFLICT (job_url)

    DO UPDATE SET
      ${updates
        .map(
          c =>
            `${qi(c)} = EXCLUDED.${qi(c)}`
        )
        .join(",")}

    RETURNING id
  `;

  await sql.query(query, vals);

  return {
    status: "saved",
    title,
    type,
    location,
    w2: explicitW2,
    c2c: explicitC2C,
    sponsorship:
      noSponsorship ? "NO" : "unknown"
  };
}

console.log(
  "\n===== MOTION RECRUITMENT IMPORT ====="
);

const companyId = await ensureCompany();
const sourceId = await ensureSource(companyId);

console.log("Company ID:", companyId);
console.log("Source ID:", sourceId);

const jobSchema = await columns("jobs");

const jobColumns = new Set(
  jobSchema.map(x => x.column_name)
);

console.log(
  "\n===== DISCOVER CONTRACT JOBS ====="
);

const urls = await discoverJobs();

console.log(
  "\nUnique Motion contract URLs:",
  urls.length
);

let saved = 0;
let failed = 0;
let skipped = 0;
let w2 = 0;
let c2c = 0;
let noSponsor = 0;

const samples = [];

const concurrency = 6;

for (
  let i = 0;
  i < urls.length;
  i += concurrency
) {
  const batch = urls.slice(
    i,
    i + concurrency
  );

  const results =
    await Promise.allSettled(
      batch.map(url =>
        saveJob(
          url,
          companyId,
          sourceId,
          jobColumns
        )
      )
    );

  for (const result of results) {
    if (result.status === "rejected") {
      failed++;
      continue;
    }

    const job = result.value;

    if (job.status === "saved") {
      saved++;

      if (job.w2) w2++;
      if (job.c2c) c2c++;
      if (job.sponsorship === "NO") {
        noSponsor++;
      }

      if (samples.length < 20) {
        samples.push(job);
      }
    } else {
      skipped++;
    }
  }

  console.log(
    `Processed ${Math.min(
      i + concurrency,
      urls.length
    )}/${urls.length}`
  );
}

console.log(
  "\n===== MOTION RESULT ====="
);

console.log(
  "Contract jobs saved/updated:",
  saved
);

console.log(
  "Explicit W2:",
  w2
);

console.log(
  "Explicit C2C:",
  c2c
);

console.log(
  "Explicit no sponsorship:",
  noSponsor
);

console.log(
  "Skipped:",
  skipped
);

console.log(
  "Failed:",
  failed
);

console.log(
  "\n===== SAMPLE JOBS ====="
);

for (const job of samples) {
  console.log(
    "•",
    job.title,
    "|",
    job.location ?? "unknown",
    "|",
    job.type,
    "| W2:",
    job.w2,
    "| C2C:",
    job.c2c
  );
}

const count = await sql`
  SELECT
    COUNT(*)::integer AS total
  FROM jobs j
  JOIN companies c
    ON c.id = j.company_id
  WHERE LOWER(c.name) =
        LOWER('Motion Recruitment')
    AND COALESCE(j.active, TRUE) = TRUE
`;

console.log(
  "\nMotion jobs now in HirePilot:",
  count[0]?.total ?? 0
);
