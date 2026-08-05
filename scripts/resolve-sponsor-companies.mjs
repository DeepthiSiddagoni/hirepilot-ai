import dotenv from "dotenv";
import pg from "pg";

dotenv.config({
  path: ".env.local",
  override: true,
});

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "llc",
  "ltd",
  "limited",
  "plc",
  "lp",
  "llp",
  "pc",
  "pbc",
  "company",
  "co",
]);

function words(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bn\.?\s*a\.?\b/g, " na ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function strictNormalize(value) {
  return words(value).join("");
}

function coreTokens(value) {
  const tokens = words(value);

  while (
    tokens.length > 1 &&
    LEGAL_SUFFIXES.has(
      tokens[tokens.length - 1]
    )
  ) {
    tokens.pop();
  }

  // Common legal banking suffix.
  if (
    tokens.length > 1 &&
    tokens[tokens.length - 1] === "na"
  ) {
    tokens.pop();
  }

  return tokens;
}

function coreNormalize(value) {
  return coreTokens(value).join("");
}

function similarity(a, b) {
  const aStrict = strictNormalize(a);
  const bStrict = strictNormalize(b);

  if (!aStrict || !bStrict) {
    return {
      score: 0,
      method: "none",
    };
  }

  if (aStrict === bStrict) {
    return {
      score: 100,
      method: "exact_normalized",
    };
  }

  const aCore = coreNormalize(a);
  const bCore = coreNormalize(b);

  if (
    aCore &&
    bCore &&
    aCore === bCore
  ) {
    return {
      score: 98,
      method: "exact_legal_core",
    };
  }

  const aTokens =
    new Set(coreTokens(a));

  const bTokens =
    new Set(coreTokens(b));

  let common = 0;

  for (const token of aTokens) {
    if (bTokens.has(token)) {
      common++;
    }
  }

  const smaller =
    Math.min(
      aTokens.size,
      bTokens.size
    );

  const union =
    new Set([
      ...aTokens,
      ...bTokens,
    ]).size;

  const containment =
    smaller > 0
      ? common / smaller
      : 0;

  const jaccard =
    union > 0
      ? common / union
      : 0;

  let tokenScore =
    Math.round(
      containment * 65 +
      jaccard * 35
    );

  let prefixScore = 0;

  if (
    aCore.length >= 4 &&
    bCore.length >= 4 &&
    (
      aCore.startsWith(bCore) ||
      bCore.startsWith(aCore)
    )
  ) {
    const ratio =
      Math.min(
        aCore.length,
        bCore.length
      ) /
      Math.max(
        aCore.length,
        bCore.length
      );

    prefixScore =
      Math.round(
        65 + ratio * 20
      );
  }

  const score =
    Math.max(
      tokenScore,
      prefixScore
    );

  return {
    score,
    method:
      prefixScore > tokenScore
        ? "prefix_candidate"
        : "token_candidate",
  };
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsor_alias_candidates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      company_id UUID NOT NULL
        REFERENCES companies(id)
        ON DELETE CASCADE,

      employer_name TEXT NOT NULL,
      employer_normalized TEXT NOT NULL,

      match_score INTEGER NOT NULL
        CHECK (
          match_score BETWEEN 0 AND 100
        ),

      match_method TEXT NOT NULL,

      status TEXT NOT NULL
        DEFAULT 'candidate'
        CHECK (
          status IN (
            'candidate',
            'auto_approved',
            'approved',
            'rejected'
          )
        ),

      lca_filings INTEGER NOT NULL
        DEFAULT 0,

      evidence JSONB,

      created_at TIMESTAMPTZ
        NOT NULL DEFAULT NOW(),

      updated_at TIMESTAMPTZ
        NOT NULL DEFAULT NOW(),

      UNIQUE (
        company_id,
        employer_normalized
      )
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      idx_sponsor_alias_candidates_company
    ON sponsor_alias_candidates(company_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      idx_sponsor_alias_candidates_status
    ON sponsor_alias_candidates(status);
  `);
}

await ensureTables();

const companiesResult =
  await pool.query(`
    SELECT
      c.id,
      c.name,
      COUNT(*)::int AS active_jobs
    FROM companies c
    JOIN jobs j
      ON j.company_id = c.id
    WHERE j.active = TRUE
    GROUP BY
      c.id,
      c.name
    ORDER BY
      active_jobs DESC,
      c.name
  `);

const catalogResult =
  await pool.query(`
    SELECT
      employer_name,
      employer_normalized,
      filings,
      fiscal_year
    FROM dol_employer_catalog
    WHERE visa_class = 'H-1B'
      AND fiscal_year = 2026
    ORDER BY filings DESC
  `);

const aliasesResult =
  await pool.query(`
    SELECT
      company_id,
      alias_name
    FROM sponsor_company_aliases
  `);

const companies =
  companiesResult.rows;

const catalog =
  catalogResult.rows;

const aliasesByCompany =
  new Map();

for (const alias of aliasesResult.rows) {
  const key =
    String(alias.company_id);

  if (!aliasesByCompany.has(key)) {
    aliasesByCompany.set(
      key,
      []
    );
  }

  aliasesByCompany
    .get(key)
    .push(
      String(alias.alias_name)
    );
}

console.log(
  `Active-job companies: ${companies.length}`
);

console.log(
  `DOL employer catalog: ${catalog.length}`
);

console.log();

// Regenerate automatic suggestions while preserving
// manually approved/rejected decisions.
await pool.query(`
  DELETE FROM sponsor_alias_candidates
  WHERE status IN (
    'candidate',
    'auto_approved'
  )
`);

let autoApprovedCompanies = 0;
let reviewCompanies = 0;
let unmatchedCompanies = 0;
let aliasesInserted = 0;

const reviewReport = [];

for (const company of companies) {
  const companyId =
    String(company.id);

  const existingAliases =
    aliasesByCompany.get(
      companyId
    ) ?? [];

  const seeds = [
    company.name,
    ...existingAliases,
  ];

  const scored = [];

  for (const employer of catalog) {
    let best = {
      score: 0,
      method: "none",
      seed: company.name,
    };

    for (const seed of seeds) {
      const result =
        similarity(
          seed,
          employer.employer_name
        );

      if (
        result.score >
        best.score
      ) {
        best = {
          ...result,
          seed,
        };
      }
    }

    if (best.score < 55) {
      continue;
    }

    scored.push({
      employerName:
        employer.employer_name,

      employerNormalized:
        employer.employer_normalized,

      filings:
        Number(
          employer.filings ?? 0
        ),

      score:
        best.score,

      method:
        best.method,

      seed:
        best.seed,
    });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.filings - a.filings
  );

  const safeMatches =
    scored.filter(
      (match) =>
        match.score >= 98 &&
        (
          match.method ===
            "exact_normalized" ||
          match.method ===
            "exact_legal_core"
        )
    );

  if (safeMatches.length > 0) {
    autoApprovedCompanies++;

    for (
      const match
      of safeMatches
    ) {
      await pool.query(
        `
        INSERT INTO
          sponsor_alias_candidates (
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
          $5,
          'auto_approved',
          $6,
          $7::jsonb
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
            EXCLUDED.match_method,
          status =
            'auto_approved',
          lca_filings =
            EXCLUDED.lca_filings,
          evidence =
            EXCLUDED.evidence,
          updated_at = NOW()
        `,
        [
          companyId,
          match.employerName,
          match.employerNormalized,
          match.score,
          match.method,
          match.filings,
          JSON.stringify({
            sourceSeed:
              match.seed,
            activeJobs:
              Number(
                company.active_jobs
              ),
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
            AND LOWER(alias_name)
                = LOWER($2)
          LIMIT 1
          `,
          [
            companyId,
            match.employerName,
          ]
        );

      if (
        aliasExists.rowCount === 0
      ) {
        await pool.query(
          `
          INSERT INTO
            sponsor_company_aliases (
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
            companyId,
            match.employerName,
            match.employerNormalized,
            match.score,
          ]
        );

        aliasesInserted++;
      }
    }

    console.log(
      `AUTO ✅ ${company.name} → ` +
      safeMatches
        .slice(0, 3)
        .map(
          (m) =>
            `${m.employerName} (${m.filings})`
        )
        .join(", ")
    );

    continue;
  }

  const candidates =
    scored.slice(0, 5);

  if (candidates.length > 0) {
    reviewCompanies++;

    for (
      const match
      of candidates
    ) {
      await pool.query(
        `
        INSERT INTO
          sponsor_alias_candidates (
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
          $5,
          'candidate',
          $6,
          $7::jsonb
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
            EXCLUDED.match_method,
          lca_filings =
            EXCLUDED.lca_filings,
          evidence =
            EXCLUDED.evidence,
          updated_at = NOW()
        `,
        [
          companyId,
          match.employerName,
          match.employerNormalized,
          match.score,
          match.method,
          match.filings,
          JSON.stringify({
            sourceSeed:
              match.seed,
            activeJobs:
              Number(
                company.active_jobs
              ),
            fiscalYear: 2026,
          }),
        ]
      );
    }

    reviewReport.push({
      company:
        company.name,

      activeJobs:
        Number(
          company.active_jobs
        ),

      candidates:
        candidates.map(
          (c) => ({
            employer:
              c.employerName,
            score:
              c.score,
            filings:
              c.filings,
            method:
              c.method,
          })
        ),
    });

    console.log(
      `REVIEW ⚠️ ${company.name} → ` +
      candidates
        .slice(0, 3)
        .map(
          (m) =>
            `${m.employerName} ` +
            `[${m.score}]`
        )
        .join(", ")
    );
  } else {
    unmatchedCompanies++;

    console.log(
      `NONE ❌ ${company.name}`
    );
  }
}

console.log();
console.log(
  "===== AUTOMATIC SPONSOR RESOLVER COMPLETE ====="
);

console.log(
  `Active-job companies: ${companies.length}`
);

console.log(
  `Auto-approved companies: ${autoApprovedCompanies}`
);

console.log(
  `Companies needing review: ${reviewCompanies}`
);

console.log(
  `Companies with no candidate: ${unmatchedCompanies}`
);

console.log(
  `New verified aliases inserted: ${aliasesInserted}`
);

if (reviewReport.length > 0) {
  console.log();
  console.log(
    "===== REVIEW QUEUE ====="
  );

  for (
    const item of reviewReport
  ) {
    console.log(
      `\n${item.company} (${item.activeJobs} active jobs)`
    );

    for (
      const candidate
      of item.candidates
    ) {
      console.log(
        `  ${candidate.score} | ` +
        `${candidate.filings} filings | ` +
        `${candidate.employer} | ` +
        `${candidate.method}`
      );
    }
  }
}

await pool.end();
