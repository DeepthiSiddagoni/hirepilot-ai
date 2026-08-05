import dotenv from "dotenv";
import OpenAI from "openai";
import pg from "pg";

dotenv.config({
  path: ".env.local",
  override: true,
});

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not configured");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL =
  process.env.SPONSOR_RESOLVER_MODEL ||
  "gpt-5";

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function extractJson(text) {
  const cleaned = String(text ?? "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error(
      `No JSON object returned: ${cleaned}`
    );
  }

  return JSON.parse(
    cleaned.slice(start, end + 1)
  );
}

function collectUrls(response) {
  const urls = new Set();

  for (const item of response.output ?? []) {
    const action = item?.action;

    for (const source of action?.sources ?? []) {
      if (source?.url) {
        urls.add(source.url);
      }
    }

    for (const content of item?.content ?? []) {
      for (
        const annotation
        of content?.annotations ?? []
      ) {
        if (annotation?.url) {
          urls.add(annotation.url);
        }
      }
    }
  }

  return [...urls].slice(0, 10);
}

async function getUnresolvedCompanies() {
  const result = await pool.query(`
    SELECT
      c.id,
      c.name,
      COUNT(j.id)::int AS active_jobs
    FROM companies c
    JOIN jobs j
      ON j.company_id = c.id
     AND j.active = TRUE
    WHERE NOT EXISTS (
      SELECT 1
      FROM sponsor_alias_candidates sac
      WHERE sac.company_id = c.id
        AND sac.status IN (
          'auto_approved',
          'approved'
        )
    )
    GROUP BY
      c.id,
      c.name
    ORDER BY
      active_jobs DESC,
      c.name
  `);

  return result.rows;
}

async function getCandidates(companyId) {
  const result = await pool.query(
    `
    SELECT
      employer_name,
      employer_normalized,
      match_score,
      match_method,
      lca_filings
    FROM sponsor_alias_candidates
    WHERE company_id = $1
      AND status = 'candidate'
    ORDER BY
      match_score DESC,
      lca_filings DESC
    LIMIT 10
    `,
    [companyId]
  );

  return result.rows;
}

async function getSampleJobs(companyId) {
  const result = await pool.query(
    `
    SELECT
      title,
      location,
      job_url
    FROM jobs
    WHERE company_id = $1
      AND active = TRUE
    ORDER BY
      posted_at DESC NULLS LAST,
      created_at DESC
    LIMIT 5
    `,
    [companyId]
  );

  return result.rows;
}

async function findCatalogEmployer(name) {
  const target = normalize(name);

  if (!target) {
    return null;
  }

  const exact = await pool.query(
    `
    SELECT
      employer_name,
      employer_normalized,
      filings
    FROM dol_employer_catalog
    WHERE fiscal_year = 2026
      AND visa_class = 'H-1B'
      AND employer_normalized = $1
    ORDER BY filings DESC
    LIMIT 1
    `,
    [target]
  );

  return exact.rows[0] ?? null;
}

async function saveApprovedMatch({
  company,
  employer,
  confidence,
  reason,
  urls,
  sampleJobs,
}) {
  const normalized =
    employer.employer_normalized ||
    normalize(employer.employer_name);

  const filings =
    Number(employer.filings ?? 0);

  await pool.query(
    `
    INSERT INTO sponsor_alias_candidates (
      company_id,
      employer_name,
      employer_normalized,
      match_score,
      match_method,
      status,
      lca_filings,
      evidence
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      'web_verified',
      'approved',
      $5,
      $6::jsonb
    )
    ON CONFLICT (
      company_id,
      employer_normalized
    )
    DO UPDATE SET
      employer_name =
        EXCLUDED.employer_name,
      match_score =
        EXCLUDED.match_score,
      match_method =
        'web_verified',
      status =
        'approved',
      lca_filings =
        EXCLUDED.lca_filings,
      evidence =
        EXCLUDED.evidence,
      updated_at = NOW()
    `,
    [
      company.id,
      employer.employer_name,
      normalized,
      confidence,
      filings,
      JSON.stringify({
        resolver: "web_verified_v1",
        model: MODEL,
        reason,
        sources: urls,
        sampleJobs,
        fiscalYear: 2026,
      }),
    ]
  );

  const aliasExists =
    await pool.query(
      `
      SELECT 1
      FROM sponsor_company_aliases
      WHERE company_id = $1
        AND LOWER(alias_name) =
            LOWER($2)
      LIMIT 1
      `,
      [
        company.id,
        employer.employer_name,
      ]
    );

  if (aliasExists.rowCount === 0) {
    await pool.query(
      `
      INSERT INTO sponsor_company_aliases (
        company_id,
        alias_name,
        alias_normalized,
        confidence
      )
      VALUES (
        $1,
        $2,
        $3,
        $4
      )
      `,
      [
        company.id,
        employer.employer_name,
        normalized,
        confidence,
      ]
    );
  }
}

const companies =
  await getUnresolvedCompanies();

console.log(
  `Unresolved active-job companies: ${companies.length}`
);

console.log(
  "Only unresolved companies will use web research."
);

console.log();

let webResolved = 0;
let noVerifiedMatch = 0;

for (const company of companies) {
  const candidates =
    await getCandidates(company.id);

  const jobs =
    await getSampleJobs(company.id);

  console.log(
    `Researching ${company.name}...`
  );

  const candidateText =
    candidates.length
      ? candidates
          .map(
            (c, i) =>
              `${i + 1}. ${c.employer_name} | ` +
              `${c.lca_filings} FY2026 H-1B LCA filings | ` +
              `name score ${c.match_score}`
          )
          .join("\n")
      : "No lexical DOL candidates were found.";

  const jobText =
    jobs
      .map(
        (j, i) =>
          `${i + 1}. ${j.title} | ` +
          `${j.location ?? "unknown location"} | ` +
          `${j.job_url ?? "no URL"}`
      )
      .join("\n");

  const response =
    await openai.responses.create({
      model: MODEL,

      tools: [
        {
          type: "web_search",
          search_context_size: "medium",
        },
      ],

      input: `
You are performing conservative corporate-identity verification
for an H-1B sponsorship evidence system.

HIRING COMPANY:
${company.name}

CURRENT JOBS FROM THAT COMPANY:
${jobText}

DOL H-1B EMPLOYER CANDIDATES:
${candidateText}

Research the public web.

Determine which DOL employer names, if any, are actually:
1. the same legal company,
2. an official legal entity of the hiring company, or
3. a controlled subsidiary whose employment filings are reasonably
   attributable to jobs advertised by this hiring company.

Do NOT approve a company merely because words look similar.

Examples of dangerous errors:
- Citi must not match Citizens Financial merely because both contain "citi".
- Flex must not match unrelated businesses containing the word Flex.
- Scale AI must not match Upscale AI.

Prefer authoritative evidence:
- official company pages,
- SEC filings,
- government sources,
- official legal disclosures.

Return ONLY valid JSON in this exact shape:

{
  "approvedEmployerNames": [],
  "additionalLegalEmployerNames": [],
  "confidence": 0,
  "reason": ""
}

Rules:
- approvedEmployerNames must contain only exact names from the supplied
  DOL candidate list.
- additionalLegalEmployerNames can contain legal employer names discovered
  through research that were not in the candidate list.
- confidence is 0-100.
- If evidence is insufficient, return empty arrays.
- Be conservative.
`,
    });

  const decision =
    extractJson(
      response.output_text
    );

  const urls =
    collectUrls(response);

  const confidence =
    Math.max(
      0,
      Math.min(
        100,
        Number(
          decision.confidence ?? 0
        )
      )
    );

  const approved = [];

  for (
    const name
    of decision.approvedEmployerNames ?? []
  ) {
    const candidate =
      candidates.find(
        (c) =>
          normalize(c.employer_name) ===
          normalize(name)
      );

    if (candidate) {
      approved.push({
        employer_name:
          candidate.employer_name,
        employer_normalized:
          candidate.employer_normalized,
        filings:
          candidate.lca_filings,
      });
    }
  }

  for (
    const name
    of decision.additionalLegalEmployerNames ?? []
  ) {
    const catalogMatch =
      await findCatalogEmployer(name);

    if (catalogMatch) {
      approved.push(catalogMatch);
    }
  }

  const uniqueApproved =
    [
      ...new Map(
        approved.map(
          (item) => [
            item.employer_normalized,
            item,
          ]
        )
      ).values(),
    ];

  // High threshold intentionally:
  // uncertain corporate relationships remain unmatched.
  if (
    confidence >= 90 &&
    uniqueApproved.length > 0
  ) {
    for (
      const employer
      of uniqueApproved
    ) {
      await saveApprovedMatch({
        company,
        employer,
        confidence,
        reason:
          decision.reason ?? "",
        urls,
        sampleJobs: jobs,
      });
    }

    webResolved++;

    console.log(
      `WEB ✅ ${company.name} → ` +
      uniqueApproved
        .map(
          (e) =>
            `${e.employer_name} (${e.filings})`
        )
        .join(", ")
    );
  } else {
    noVerifiedMatch++;

    console.log(
      `UNRESOLVED ⚪ ${company.name} | ` +
      `confidence ${confidence} | ` +
      `${decision.reason ?? "No verified relationship"}`
    );
  }
}

console.log();
console.log(
  "===== WEB SPONSOR RESOLVER COMPLETE ====="
);

console.log(
  `Companies researched: ${companies.length}`
);

console.log(
  `Web-verified companies: ${webResolved}`
);

console.log(
  `Still unresolved/no verified LCA evidence: ${noVerifiedMatch}`
);

await pool.end();
