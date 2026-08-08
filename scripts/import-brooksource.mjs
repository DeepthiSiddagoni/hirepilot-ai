import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const sql = neon(process.env.DATABASE_URL);

const BASE = "https://jobs.brooksource.com";
const JOBS_PAGE = `${BASE}/jobs/`;

const headers = {
  "User-Agent":
    "Mozilla/5.0 (compatible; HirePilot/1.0; job aggregation)",
  Accept: "text/html,application/xhtml+xml,application/json"
};

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function tableColumns(table) {
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

async function fetchPage(url, timeout = 15000) {
  const response = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(timeout)
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  return response;
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function stripHtml(value = "") {
  return decodeHtml(
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
      const found = findJobPosting(item);
      if (found) return found;
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const type = value["@type"];

  if (
    type === "JobPosting" ||
    (Array.isArray(type) && type.includes("JobPosting"))
  ) {
    return value;
  }

  if (value["@graph"]) {
    const found = findJobPosting(value["@graph"]);
    if (found) return found;
  }

  for (const child of Object.values(value)) {
    if (typeof child === "object") {
      const found = findJobPosting(child);
      if (found) return found;
    }
  }

  return null;
}

function parseJsonLd(html) {
  const regex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(regex)) {
    try {
      const json = JSON.parse(
        decodeHtml(match[1]).trim()
      );

      const posting = findJobPosting(json);

      if (posting) return posting;
    } catch {
      // Ignore malformed JSON-LD.
    }
  }

  return null;
}

function extractCanonical(html, fallback) {
  const match = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
  );

  return absoluteUrl(match?.[1]) ?? fallback;
}

function extractTitle(html, posting) {
  if (posting?.title) {
    return stripHtml(posting.title);
  }

  const h3 = html.match(
    /<h3[^>]*>([\s\S]*?)<\/h3>/i
  );

  if (h3?.[1]) {
    return stripHtml(h3[1]);
  }

  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );

  return og?.[1] ? decodeHtml(og[1]).trim() : null;
}

function extractLocation(posting, text) {
  const locations = Array.isArray(posting?.jobLocation)
    ? posting.jobLocation
    : posting?.jobLocation
      ? [posting.jobLocation]
      : [];

  for (const location of locations) {
    const a = location?.address ?? {};

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
    /Job ID:[\s\S]{0,180}?\n?\s*([A-Za-z .'-]+,\s*(?:Texas|TX|Virginia|VA|Florida|FL|Georgia|GA|North Carolina|NC|South Carolina|SC|Tennessee|TN|Minnesota|MN|Michigan|MI|Missouri|MO|New York|NY|California|CA|Colorado|CO|Arizona|AZ|Indiana|IN|Ohio|OH|Wisconsin|WI|Maryland|MD|Pennsylvania|PA|Washington|DC))/i
  );

  return match?.[1]?.trim() ?? null;
}

function detectEmploymentType(text, posting) {
  const top = text.slice(0, 4500);

  if (
    /Contract\s*(?:to|-to-)\s*Hire/i.test(top) ||
    /Contract-to-Hire/i.test(top)
  ) {
    return "contract-to-hire";
  }

  if (
    /\bContract\b/i.test(top) ||
    String(posting?.employmentType ?? "")
      .toLowerCase()
      .includes("contract")
  ) {
    return "contract";
  }

  if (/Direct Hire/i.test(top)) {
    return "direct-hire";
  }

  return null;
}

function detectRemote(text, posting) {
  if (
    String(posting?.jobLocationType ?? "")
      .toUpperCase()
      .includes("TELECOMMUTE")
  ) {
    return "remote";
  }

  const top = text.slice(0, 3000);

  if (/\bRemote\b/i.test(top)) {
    return "remote";
  }

  if (/\bHybrid\b/i.test(top)) {
    return "hybrid";
  }

  if (
    /Physical Location|On[- ]?Site|Onsite/i.test(top)
  ) {
    return "onsite";
  }

  return null;
}

function salaryInfo(posting, text) {
  let min = null;
  let max = null;
  let currency = "USD";
  let period = "hour";

  const salary = posting?.baseSalary;

  if (salary) {
    currency =
      salary.currency ??
      salary.value?.currency ??
      currency;

    const value = salary.value ?? salary;

    if (typeof value === "number") {
      min = Number(value);
      max = Number(value);
    } else {
      if (value?.minValue != null) {
        min = Number(value.minValue);
      }

      if (value?.maxValue != null) {
        max = Number(value.maxValue);
      }

      if (
        value?.value != null &&
        typeof value.value === "number"
      ) {
        min ??= Number(value.value);
        max ??= Number(value.value);
      }

      if (value?.unitText) {
        period = String(value.unitText).toLowerCase();
      }
    }
  }

  if (min == null && max == null) {
    const match = text
      .slice(0, 4500)
      .match(
        /\$(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*\$(?:(\d+(?:\.\d+)?))\s*\/?\s*(hr|hour|year|yr)?/i
      );

    if (match) {
      min = Number(match[1]);
      max = Number(match[2]);

      if (/year|yr/i.test(match[3] ?? "")) {
        period = "year";
      }
    }
  }

  return {
    salary_min:
      Number.isFinite(min) ? min : null,
    salary_max:
      Number.isFinite(max) ? max : null,
    salary_currency: currency,
    salary_period: period
  };
}

function externalId(posting, url, text) {
  const identifier = posting?.identifier;

  if (typeof identifier === "string") {
    return identifier;
  }

  if (identifier?.value) {
    return String(identifier.value);
  }

  const jobId = text.match(
    /Job ID:\s*([A-Z0-9 -]+)/i
  );

  if (jobId?.[1]) {
    return jobId[1].trim();
  }

  try {
    const path = new URL(url).pathname
      .split("/")
      .filter(Boolean);

    return path[path.length - 1] ?? url;
  } catch {
    return url;
  }
}

async function ensureCompany() {
  const existing = await sql`
    SELECT id
    FROM companies
    WHERE LOWER(name) = LOWER('Brooksource')
    LIMIT 1
  `;

  if (existing.length) {
    return existing[0].id;
  }

  const cols = await tableColumns("companies");
  const names = new Set(
    cols.map((x) => x.column_name)
  );

  const values = {};

  if (names.has("name")) {
    values.name = "Brooksource";
  }

  if (names.has("domain")) {
    values.domain = "brooksource.com";
  }

  if (names.has("website")) {
    values.website = "https://www.brooksource.com";
  }

  if (names.has("website_url")) {
    values.website_url =
      "https://www.brooksource.com";
  }

  if (names.has("careers_url")) {
    values.careers_url = JOBS_PAGE;
  }

  if (names.has("active")) {
    values.active = true;
  }

  if (names.has("created_at")) {
    values.created_at = new Date();
  }

  if (names.has("updated_at")) {
    values.updated_at = new Date();
  }

  const insertCols = Object.keys(values);

  const params = Object.values(values);

  const placeholders = insertCols.map(
    (_, i) => `$${i + 1}`
  );

  const query = `
    INSERT INTO companies (
      ${insertCols.map(quoteIdent).join(", ")}
    )
    VALUES (
      ${placeholders.join(", ")}
    )
    RETURNING id
  `;

  const result = await sql.query(query, params);

  return result[0].id;
}

async function ensureJobSource(companyId) {
  const sourceColumns =
    await tableColumns("job_sources");

  if (!sourceColumns.length) {
    return null;
  }

  const names = new Set(
    sourceColumns.map((x) => x.column_name)
  );

  const lookupCandidates = [
    "name",
    "source_name",
    "source_key",
    "slug"
  ];

  for (const field of lookupCandidates) {
    if (!names.has(field)) continue;

    const rows = await sql.query(
      `SELECT id
       FROM job_sources
       WHERE LOWER(${quoteIdent(field)}::text)
             = LOWER($1)
       LIMIT 1`,
      [
        field === "name" ||
        field === "source_name"
          ? "Brooksource"
          : "brooksource"
      ]
    );

    if (rows.length) {
      return rows[0].id;
    }
  }

  const data = {};

  const setIf = (column, value) => {
    if (names.has(column)) {
      data[column] = value;
    }
  };

  setIf("name", "Brooksource");
  setIf("source_name", "Brooksource");
  setIf("source_type", "brooksource");
  setIf("source_key", "brooksource");
  setIf("slug", "brooksource");
  setIf("provider", "brooksource");

  setIf("base_url", JOBS_PAGE);
  setIf("url", JOBS_PAGE);
  setIf("website_url", JOBS_PAGE);
  setIf("careers_url", JOBS_PAGE);

  setIf("company_id", companyId);

  setIf("active", true);
  setIf("is_active", true);

  setIf("created_at", new Date());
  setIf("updated_at", new Date());

  const requiredUnknown =
    sourceColumns.filter((column) => {
      if (column.column_name === "id") {
        return false;
      }

      return (
        column.is_nullable === "NO" &&
        column.column_default == null &&
        column.is_identity !== "YES" &&
        !(column.column_name in data)
      );
    });

  if (requiredUnknown.length) {
    console.log(
      "⚠️ Could not automatically create job_sources row."
    );

    console.log(
      "Required unknown columns:",
      requiredUnknown.map((x) => x.column_name)
    );

    return null;
  }

  const insertCols = Object.keys(data);

  const params = Object.values(data);

  const placeholders = insertCols.map(
    (_, i) => `$${i + 1}`
  );

  const query = `
    INSERT INTO job_sources (
      ${insertCols.map(quoteIdent).join(", ")}
    )
    VALUES (
      ${placeholders.join(", ")}
    )
    RETURNING id
  `;

  const result = await sql.query(query, params);

  return result[0]?.id ?? null;
}

async function collectFromSitemaps() {
  const urls = new Set();
  const sitemapQueue = [];
  const visited = new Set();

  try {
    const robots = await fetchPage(
      `${BASE}/robots.txt`
    );

    const text = await robots.text();

    for (const match of text.matchAll(
      /^Sitemap:\s*(https?:\/\/\S+)/gim
    )) {
      sitemapQueue.push(match[1].trim());
    }
  } catch {
    // Continue with standard sitemap URLs.
  }

  sitemapQueue.push(
    `${BASE}/wp-sitemap.xml`,
    `${BASE}/sitemap_index.xml`,
    `${BASE}/sitemap.xml`
  );

  while (
    sitemapQueue.length &&
    visited.size < 30
  ) {
    const sitemapUrl = sitemapQueue.shift();

    if (
      !sitemapUrl ||
      visited.has(sitemapUrl)
    ) {
      continue;
    }

    visited.add(sitemapUrl);

    try {
      const response = await fetchPage(
        sitemapUrl,
        10000
      );

      const xml = await response.text();

      const locs = [
        ...xml.matchAll(
          /<loc>([\s\S]*?)<\/loc>/gi
        )
      ].map((x) =>
        decodeHtml(x[1].trim())
      );

      for (const loc of locs) {
        if (/\.xml(?:\?|$)/i.test(loc)) {
          if (
            loc.includes("brooksource.com") &&
            !visited.has(loc)
          ) {
            sitemapQueue.push(loc);
          }

          continue;
        }

        if (
          /jobs\.brooksource\.com\/jobs\/job\//i.test(
            loc
          )
        ) {
          urls.add(loc);
        }
      }
    } catch {
      // Ignore unavailable sitemap.
    }
  }

  return urls;
}

async function collectFromWordPress() {
  const urls = new Set();

  try {
    const typesResponse = await fetchPage(
      `${BASE}/wp-json/wp/v2/types`,
      10000
    );

    const types = await typesResponse.json();

    for (const value of Object.values(types)) {
      const restBase = value?.rest_base;

      if (
        !restBase ||
        !/job/i.test(
          `${value?.name ?? ""} ${value?.slug ?? ""} ${restBase}`
        )
      ) {
        continue;
      }

      for (let page = 1; page <= 10; page++) {
        try {
          const response = await fetchPage(
            `${BASE}/wp-json/wp/v2/${restBase}?per_page=100&page=${page}&_fields=link`,
            10000
          );

          const rows = await response.json();

          if (!Array.isArray(rows) || !rows.length) {
            break;
          }

          for (const row of rows) {
            if (
              row?.link &&
              /\/jobs\/job\//i.test(row.link)
            ) {
              urls.add(row.link);
            }
          }

          if (rows.length < 100) {
            break;
          }
        } catch {
          break;
        }
      }
    }
  } catch {
    // REST API may not expose the custom job type.
  }

  return urls;
}

async function collectFromSearchPage() {
  const urls = new Set();

  try {
    const response = await fetchPage(JOBS_PAGE);

    const html = await response.text();

    const regex =
      /href=["']([^"']*\/jobs\/job\/[^"'?#]+\/?(?:\?[^"']*)?)["']/gi;

    for (const match of html.matchAll(regex)) {
      const url = absoluteUrl(match[1]);

      if (url) urls.add(url);
    }
  } catch {
    // Other discovery methods may still work.
  }

  return urls;
}

async function upsertJob(
  companyId,
  sourceId,
  url,
  html,
  jobColumns
) {
  const posting = parseJsonLd(html);

  const text = stripHtml(html);

  const canonical = extractCanonical(
    html,
    url
  );

  const title = extractTitle(
    html,
    posting
  );

  if (!title) {
    return {
      status: "skip",
      reason: "no-title"
    };
  }

  const employmentType =
    detectEmploymentType(text, posting);

  /*
   * Brooksource also publishes direct-hire jobs.
   * HirePilot's current priority is contract work.
   */
  if (
    employmentType !== "contract" &&
    employmentType !== "contract-to-hire"
  ) {
    return {
      status: "skip",
      reason: "not-contract"
    };
  }

  const description = stripHtml(
    posting?.description ??
    text
  ).slice(0, 50000);

  const location = extractLocation(
    posting,
    text
  );

  const remoteType = detectRemote(
    text,
    posting
  );

  const salary = salaryInfo(
    posting,
    text
  );

  const postedAt =
    posting?.datePosted ??
    null;

  const row = {
    company_id: companyId,
    source_id: sourceId,
    external_job_id: externalId(
      posting,
      canonical,
      text
    ),
    title,
    description,
    location,
    remote_type: remoteType,
    employment_type: employmentType,
    job_url: canonical,

    salary_min: salary.salary_min,
    salary_max: salary.salary_max,
    salary_currency:
      salary.salary_currency,
    salary_period:
      salary.salary_period,

    posted_at: postedAt,
    discovered_at: new Date(),
    raw_data: JSON.stringify({
      source: "brooksource",
      jobPosting: posting,
      url: canonical
    }),

    active: true,

    contract_supported: true,

    contract_type:
      employmentType === "contract-to-hire"
        ? "contract-to-hire"
        : "contract",

    w2_supported:
      /\bw[- ]?2\b/i.test(description),

    c2c_supported:
      /\bc2c\b|corp[- ]to[- ]corp/i.test(
        description
      ),

    updated_at: new Date(),
    last_seen_at: new Date()
  };

  const allowed = Object.entries(row)
    .filter(([column]) =>
      jobColumns.has(column)
    );

  const columns = allowed.map(
    ([column]) => column
  );

  const values = allowed.map(
    ([, value]) => value
  );

  const placeholders = columns.map(
    (column, index) => {
      const number = index + 1;

      if (column === "raw_data") {
        return `$${number}::jsonb`;
      }

      return `$${number}`;
    }
  );

  const updatable = columns.filter(
    (column) =>
      ![
        "company_id",
        "source_id",
        "job_url",
        "discovered_at"
      ].includes(column)
  );

  const query = `
    INSERT INTO jobs (
      ${columns.map(quoteIdent).join(", ")}
    )
    VALUES (
      ${placeholders.join(", ")}
    )
    ON CONFLICT (job_url)
    DO UPDATE SET
      ${updatable
        .map(
          (column) =>
            `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`
        )
        .join(", ")}
    RETURNING id
  `;

  await sql.query(query, values);

  return {
    status: "saved",
    title,
    employmentType,
    location,
    url: canonical
  };
}

console.log(
  "\n===== BROOKSOURCE IMPORT ====="
);

const companyId = await ensureCompany();

console.log(
  "Brooksource company ID:",
  companyId
);

const sourceId =
  await ensureJobSource(companyId);

console.log(
  "Brooksource job source ID:",
  sourceId ?? "NULL"
);

const jobSchema =
  await tableColumns("jobs");

const jobColumns = new Set(
  jobSchema.map((x) => x.column_name)
);

if (
  jobColumns.has("source_id") &&
  sourceId == null
) {
  const sourceColumn = jobSchema.find(
    (x) => x.column_name === "source_id"
  );

  if (sourceColumn?.is_nullable === "NO") {
    throw new Error(
      "jobs.source_id is required, but Brooksource job_sources row could not be created."
    );
  }
}

console.log(
  "\nDiscovering Brooksource jobs..."
);

const [
  sitemapUrls,
  wordpressUrls,
  searchUrls
] = await Promise.all([
  collectFromSitemaps(),
  collectFromWordPress(),
  collectFromSearchPage()
]);

const allUrls = new Set([
  ...sitemapUrls,
  ...wordpressUrls,
  ...searchUrls
]);

console.log(
  "From sitemap:",
  sitemapUrls.size
);

console.log(
  "From WordPress:",
  wordpressUrls.size
);

console.log(
  "From jobs page:",
  searchUrls.size
);

console.log(
  "Unique job URLs discovered:",
  allUrls.size
);

if (!allUrls.size) {
  throw new Error(
    "No Brooksource job URLs were discovered."
  );
}

const urls = [...allUrls].slice(0, 300);

let saved = 0;
let skipped = 0;
let failed = 0;

const samples = [];

const concurrency = 6;

for (
  let index = 0;
  index < urls.length;
  index += concurrency
) {
  const batch = urls.slice(
    index,
    index + concurrency
  );

  const results =
    await Promise.allSettled(
      batch.map(async (url) => {
        const response =
          await fetchPage(url);

        const html =
          await response.text();

        return upsertJob(
          companyId,
          sourceId,
          url,
          html,
          jobColumns
        );
      })
    );

  for (const result of results) {
    if (result.status === "rejected") {
      failed++;
      continue;
    }

    if (result.value.status === "saved") {
      saved++;

      if (samples.length < 15) {
        samples.push(result.value);
      }
    } else {
      skipped++;
    }
  }

  console.log(
    `Processed ${Math.min(
      index + concurrency,
      urls.length
    )}/${urls.length}`
  );
}

console.log(
  "\n===== BROOKSOURCE RESULT ====="
);

console.log(
  "Contract jobs saved/updated:",
  saved
);

console.log(
  "Non-contract/skipped:",
  skipped
);

console.log(
  "Failed pages:",
  failed
);

console.log(
  "\n===== SAMPLE IMPORTS ====="
);

for (const job of samples) {
  console.log(
    "•",
    job.title,
    "|",
    job.employmentType,
    "|",
    job.location ?? "location unavailable"
  );
}

const total = await sql`
  SELECT COUNT(*)::integer AS total
  FROM jobs j
  JOIN companies c
    ON c.id = j.company_id
  WHERE LOWER(c.name) = LOWER('Brooksource')
    AND COALESCE(j.active, TRUE) = TRUE
`;

console.log(
  "\nBrooksource jobs now in HirePilot:",
  total[0]?.total ?? 0
);
