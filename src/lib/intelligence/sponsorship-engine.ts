import { sql } from "@/lib/db";

const MODEL_VERSION = "lca-sponsorship-v1";

const STOP_WORDS = new Set([
  "senior",
  "sr",
  "junior",
  "jr",
  "principal",
  "staff",
  "lead",
  "manager",
  "director",
  "associate",
  "i",
  "ii",
  "iii",
  "iv",
  "the",
  "and",
  "or",
  "of",
  "for",
  "to",
  "a",
  "an",
  "in",
  "with",
]);

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE",
  "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);

function clamp(
  value: number,
  min = 0,
  max = 100
) {
  return Math.min(
    max,
    Math.max(min, Math.round(value))
  );
}

function normalizeText(
  value: string | null | undefined
) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(
  value: string | null | undefined
) {
  return normalizeText(value)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 2 &&
        !STOP_WORDS.has(token)
    );
}

function titleSimilarity(
  a: string,
  b: string
) {
  const aTokens = new Set(
    titleTokens(a)
  );

  const bTokens = new Set(
    titleTokens(b)
  );

  if (
    aTokens.size === 0 ||
    bTokens.size === 0
  ) {
    return 0;
  }

  let common = 0;

  for (const token of aTokens) {
    if (bTokens.has(token)) {
      common++;
    }
  }

  // Dice similarity works better for job titles where
  // one title contains extra specialization words.
  //
  // Example:
  // "Senior Data Scientist - Media Analytics"
  // vs "Data Scientist"
  // should still be treated as strongly related.
  const dice =
    (2 * common) /
    (aTokens.size + bTokens.size);

  // Also reward containment. If nearly every token from
  // the shorter title appears in the longer title, this
  // is usually a meaningful historical title match.
  const containment =
    common /
    Math.min(
      aTokens.size,
      bTokens.size
    );

  return Math.max(
    dice,
    containment * 0.9
  );
}

function extractState(
  location: string | null
) {
  if (!location) {
    return null;
  }

  const candidates =
    location
      .toUpperCase()
      .split(/[^A-Z]+/)
      .filter(Boolean);

  for (
    const candidate of candidates
  ) {
    if (
      US_STATES.has(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

type PostingSignal =
  | "explicit-positive"
  | "explicit-negative"
  | "not-mentioned";

function detectPostingSignal(
  description: string | null
): {
  signal: PostingSignal;
  evidence: string[];
} {
  const text =
    normalizeText(description);

  const evidence: string[] = [];

  const negativePatterns = [
    "will not sponsor",
    "does not sponsor",
    "do not sponsor",
    "no sponsorship",
    "unable to sponsor",
    "cannot sponsor",
    "not eligible for sponsorship",
    "without employer sponsorship",
    "without company sponsorship",
    "without visa sponsorship",
    "now or in the future without sponsorship",
  ];

  for (
    const pattern of negativePatterns
  ) {
    if (text.includes(pattern)) {
      evidence.push(
        `Posting contains negative sponsorship language: "${pattern}".`
      );
    }
  }

  if (evidence.length > 0) {
    return {
      signal: "explicit-negative",
      evidence,
    };
  }

  const positivePatterns = [
    "visa sponsorship is available",
    "sponsorship is available",
    "sponsorship available",
    "will sponsor",
    "h 1b sponsorship",
    "h1b sponsorship",
    "h-1b sponsorship",
    "immigration sponsorship",
    "eligible for sponsorship",
  ];

  for (
    const pattern of positivePatterns
  ) {
    if (text.includes(pattern)) {
      evidence.push(
        `Posting contains positive sponsorship language: "${pattern}".`
      );
    }
  }

  if (evidence.length > 0) {
    return {
      signal: "explicit-positive",
      evidence,
    };
  }

  return {
    signal: "not-mentioned",
    evidence: [
      "The posting does not clearly state whether visa sponsorship is supported.",
    ],
  };
}

function volumeScore(
  filings: number
) {
  if (filings >= 1000) return 45;
  if (filings >= 250) return 40;
  if (filings >= 100) return 35;
  if (filings >= 50) return 30;
  if (filings >= 20) return 24;
  if (filings >= 5) return 15;
  if (filings >= 1) return 8;

  return 0;
}

function similarTitleScore(
  count: number
) {
  if (count >= 25) return 25;
  if (count >= 10) return 22;
  if (count >= 5) return 18;
  if (count >= 2) return 12;
  if (count >= 1) return 8;

  return 0;
}

function stateScore(
  count: number
) {
  if (count >= 50) return 12;
  if (count >= 10) return 10;
  if (count >= 3) return 7;
  if (count >= 1) return 4;

  return 0;
}

export async function analyzeSponsorshipForJob(
  jobId: string
) {
  const jobs = await sql`
    SELECT
      j.id,
      j.title,
      j.description,
      j.location,
      j.company_id,
      c.name AS company
    FROM jobs j
    JOIN companies c
      ON c.id = j.company_id
    WHERE j.id = ${jobId}
    LIMIT 1
  `;

  const job = jobs[0];

  if (!job) {
    throw new Error(
      `Job not found: ${jobId}`
    );
  }

  const lcas = await sql`
    SELECT
      case_number,
      case_status,
      job_title,
      soc_code,
      soc_title,
      worksite_city,
      worksite_state,
      fiscal_year
    FROM sponsor_lca_history
    WHERE company_id = ${job.company_id}
      AND visa_class = 'H-1B'
    ORDER BY fiscal_year DESC
  `;

  const posting =
    detectPostingSignal(
      job.description as string | null
    );

  const filingCount =
    lcas.length;

  const targetState =
    extractState(
      job.location as string | null
    );

  let certifiedCount = 0;
  let similarTitleCount = 0;
  let sameStateCount = 0;

  const similarTitles:
    {
      title: string;
      similarity: number;
    }[] = [];

  for (const lca of lcas) {
    const status =
      String(
        lca.case_status ?? ""
      ).toUpperCase();

    if (
      status === "CERTIFIED" ||
      status ===
        "CERTIFIED-WITHDRAWN"
    ) {
      certifiedCount++;
    }

    const lcaTitle =
      String(
        lca.job_title ?? ""
      );

    const similarity =
      titleSimilarity(
        String(job.title),
        lcaTitle
      );

    if (similarity >= 0.5) {
      similarTitleCount++;

      similarTitles.push({
        title: lcaTitle,
        similarity,
      });
    }

    if (
      targetState &&
      String(
        lca.worksite_state ?? ""
      ).toUpperCase() ===
        targetState
    ) {
      sameStateCount++;
    }
  }

  const certificationRate =
    filingCount > 0
      ? certifiedCount /
        filingCount
      : 0;

  let probability = 10;

  probability +=
    volumeScore(
      filingCount
    );

  probability +=
    similarTitleScore(
      similarTitleCount
    );

  probability +=
    stateScore(
      sameStateCount
    );

  if (
    filingCount > 0 &&
    certificationRate >= 0.95
  ) {
    probability += 5;
  }

  let confidence = 20;

  if (filingCount >= 1000) {
    confidence += 30;
  } else if (
    filingCount >= 100
  ) {
    confidence += 25;
  } else if (
    filingCount >= 20
  ) {
    confidence += 18;
  } else if (
    filingCount >= 1
  ) {
    confidence += 10;
  }

  if (similarTitleCount >= 10) {
    confidence += 25;
  } else if (
    similarTitleCount >= 1
  ) {
    confidence += 15;
  }

  if (sameStateCount >= 1) {
    confidence += 10;
  }

  if (
    posting.signal ===
    "explicit-positive"
  ) {
    probability =
      Math.max(
        probability,
        95
      );

    confidence =
      Math.max(
        confidence,
        95
      );
  }

  if (
    posting.signal ===
    "explicit-negative"
  ) {
    probability = 2;
    confidence = 98;
  }

  probability =
    clamp(probability);

  confidence =
    clamp(confidence);

  const uniqueSimilarTitles =
    [
      ...new Map(
        similarTitles
          .sort(
            (a, b) =>
              b.similarity -
              a.similarity
          )
          .map(
            (item) => [
              item.title.toLowerCase(),
              item,
            ]
          )
      ).values(),
    ].slice(0, 10);

  const reasons: string[] = [
    ...posting.evidence,
  ];

  if (filingCount > 0) {
    reasons.push(
      `${job.company} has ${filingCount.toLocaleString()} matched FY2026 H-1B LCA records in HirePilot's imported DOL data.`
    );
  } else {
    reasons.push(
      `No matched H-1B LCA records are currently loaded for ${job.company}.`
    );
  }

  if (similarTitleCount > 0) {
    reasons.push(
      `${similarTitleCount.toLocaleString()} historical LCA records have job titles similar to "${job.title}".`
    );
  }

  if (
    targetState &&
    sameStateCount > 0
  ) {
    reasons.push(
      `${sameStateCount.toLocaleString()} company LCA records are associated with ${targetState}.`
    );
  }

  const evidence = {
    modelVersion:
      MODEL_VERSION,

    postingSignal:
      posting.signal,

    company:
      String(job.company),

    currentJobTitle:
      String(job.title),

    currentLocation:
      job.location,

    detectedState:
      targetState,

    lcaFilings:
      filingCount,

    lcaCertifiedOrCertifiedWithdrawn:
      certifiedCount,

    lcaCertificationRate:
      filingCount > 0
        ? Number(
            (
              certificationRate *
              100
            ).toFixed(1)
          )
        : 0,

    similarTitleFilings:
      similarTitleCount,

    sameStateFilings:
      sameStateCount,

    topSimilarHistoricalTitles:
      uniqueSimilarTitles,

    reasons,
  };

  await sql`
    UPDATE job_analysis
    SET
      sponsorship_probability =
        ${probability},
      sponsorship_confidence =
        ${confidence},
      sponsorship_evidence =
        ${JSON.stringify(evidence)}::jsonb,
      sponsorship_model_version =
        ${MODEL_VERSION},
      updated_at = NOW()
    WHERE job_id = ${jobId}
  `;

  return {
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
    },

    sponsorshipProbability:
      probability,

    sponsorshipConfidence:
      confidence,

    evidence,
  };
}
