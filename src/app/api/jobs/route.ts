import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const q = (searchParams.get("q") ?? "").trim();
    const isRolePhrase = q.includes(" ");
    const location = (searchParams.get("location") ?? "").trim();
    const company = (searchParams.get("company") ?? "").trim();
    const roleFamily = (searchParams.get("roleFamily") ?? "").trim();
    const workArrangement = (
      searchParams.get("workArrangement") ?? ""
    ).trim();

    const employmentType = (
      searchParams.get("employmentType") ?? ""
    ).trim();

    const contractType = (
      searchParams.get("contractType") ?? ""
    ).trim();

    const h1bOnly = searchParams.get("h1b") === "true";
    const optOnly = searchParams.get("opt") === "true";
    const stemOptOnly = searchParams.get("stemOpt") === "true";
    const cptOnly = searchParams.get("cpt") === "true";
    const w2Only = searchParams.get("w2") === "true";
    const c2cOnly = searchParams.get("c2c") === "true";
    const contractOnly = searchParams.get("contract") === "true";

    const trainingFriendly =
      searchParams.get("trainingFriendly") === "true";

    const transitionFriendly =
      searchParams.get("transitionFriendly") === "true";

    const postedDaysRaw = Number(
      searchParams.get("postedDays") ?? "0"
    );

    const limitRaw = Number(
      searchParams.get("limit") ?? "50"
    );

    const offsetRaw = Number(
      searchParams.get("offset") ?? "0"
    );

    const postedDays =
      Number.isFinite(postedDaysRaw) && postedDaysRaw > 0
        ? postedDaysRaw
        : 0;

    const limit = Math.min(
      Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1),
      200
    );

    const offset = Math.max(
      Number.isFinite(offsetRaw) ? offsetRaw : 0,
      0
    );

    const searchPattern = `%${q}%`;
    const locationPattern = `%${location}%`;
    const companyPattern = `%${company}%`;
    const employmentPattern = `%${employmentType}%`;
    const contractPattern = `%${contractType}%`;

    const rows = await sql`
      SELECT
        j.id,
        j.external_job_id,

        j.title,
        j.description,
        j.location,

        j.remote_type,
        j.employment_type,
        j.contract_type,

        j.job_url,

        j.sponsorship_status,
        j.h1b_supported,
        j.opt_supported,
        j.stem_opt_supported,
        j.cpt_supported,

        j.w2_supported,
        j.c2c_supported,
        j.contract_supported,

        j.sponsorship_confidence,

        j.salary_min,
        j.salary_max,
        j.salary_currency,
        j.salary_period,

        j.match_score,
        j.skills,

        j.posted_at,
        j.discovered_at,
        j.expires_at,

        c.id AS company_id,
        c.name AS company_name,

        ja.role_family,
        ja.primary_role_family,
        ja.classification_confidence,

        ja.domain_tags,
        ja.extracted_tools,

        ja.work_arrangement,

        ja.training_likelihood,
        ja.transition_friendliness,

        ja.job_freshness_score,
        ja.opportunity_score,

        COUNT(*) OVER() AS total_count

      FROM jobs j

      JOIN companies c
        ON c.id = j.company_id

      LEFT JOIN job_analysis ja
        ON ja.job_id = j.id

      WHERE
        COALESCE(j.active, TRUE) = TRUE

        AND (
  ${q} = ''

  OR j.title ILIKE ${searchPattern}

  OR COALESCE(ja.primary_role_family, '')
     ILIKE ${searchPattern}

  OR COALESCE(ja.role_family, '')
     ILIKE ${searchPattern}

  OR array_to_string(
    COALESCE(j.skills, ARRAY[]::TEXT[]),
    ' '
  ) ILIKE ${searchPattern}

  OR array_to_string(
    COALESCE(ja.extracted_tools, ARRAY[]::TEXT[]),
    ' '
  ) ILIKE ${searchPattern}

  OR array_to_string(
    COALESCE(ja.domain_tags, ARRAY[]::TEXT[]),
    ' '
  ) ILIKE ${searchPattern}

  OR (
    ${isRolePhrase} = FALSE
    AND COALESCE(j.description, '')
        ILIKE ${searchPattern}
  )
)

        AND (
          ${location} = ''
          OR COALESCE(j.location, '') ILIKE ${locationPattern}
        )

        AND (
          ${company} = ''
          OR c.name ILIKE ${companyPattern}
        )

        AND (
          ${roleFamily} = ''
          OR ja.primary_role_family = ${roleFamily}
          OR ja.role_family = ${roleFamily}
        )

        AND (
          ${workArrangement} = ''
          OR LOWER(
            COALESCE(
              ja.work_arrangement,
              j.remote_type,
              ''
            )
          ) = LOWER(${workArrangement})
        )

        AND (
          ${employmentType} = ''
          OR COALESCE(j.employment_type, '')
             ILIKE ${employmentPattern}
        )

        AND (
          ${contractType} = ''
          OR COALESCE(j.contract_type, '')
             ILIKE ${contractPattern}
        )

        AND (
          ${h1bOnly} = FALSE
          OR COALESCE(j.h1b_supported, FALSE) = TRUE
        )

        AND (
          ${optOnly} = FALSE
          OR COALESCE(j.opt_supported, FALSE) = TRUE
        )

        AND (
          ${stemOptOnly} = FALSE
          OR COALESCE(j.stem_opt_supported, FALSE) = TRUE
        )

        AND (
          ${cptOnly} = FALSE
          OR COALESCE(j.cpt_supported, FALSE) = TRUE
        )

        AND (
          ${w2Only} = FALSE
          OR COALESCE(j.w2_supported, FALSE) = TRUE
        )

        AND (
          ${c2cOnly} = FALSE
          OR COALESCE(j.c2c_supported, FALSE) = TRUE
        )

        AND (
          ${contractOnly} = FALSE
          OR COALESCE(j.contract_supported, FALSE) = TRUE
        )

        AND (
          ${trainingFriendly} = FALSE
          OR COALESCE(ja.training_likelihood, 0) >= 50
        )

        AND (
          ${transitionFriendly} = FALSE
          OR COALESCE(ja.transition_friendliness, 0) >= 50
        )

        AND (
          ${postedDays} = 0
          OR COALESCE(
            j.posted_at,
            j.discovered_at
          ) >= NOW() - (${postedDays} * INTERVAL '1 day')
        )

    
       ORDER BY
  CASE
    WHEN ${q} <> ''
         AND j.title ILIKE ${searchPattern}
      THEN 100

    WHEN ${q} <> ''
         AND (
           COALESCE(ja.primary_role_family, '')
             ILIKE ${searchPattern}
           OR COALESCE(ja.role_family, '')
             ILIKE ${searchPattern}
         )
      THEN 80

    WHEN ${q} <> ''
         AND array_to_string(
           COALESCE(j.skills, ARRAY[]::TEXT[]),
           ' '
         ) ILIKE ${searchPattern}
      THEN 60

    WHEN ${q} <> ''
         AND array_to_string(
           COALESCE(ja.extracted_tools, ARRAY[]::TEXT[]),
           ' '
         ) ILIKE ${searchPattern}
      THEN 50

    WHEN ${q} <> ''
      THEN 20

    ELSE 0
  END DESC,

  COALESCE(ja.opportunity_score, 0) DESC,
  COALESCE(j.match_score, 0) DESC,
  COALESCE(ja.job_freshness_score, 0) DESC,
  j.discovered_at DESC

      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const totalMatching =
      rows.length > 0
        ? Number(rows[0].total_count)
        : 0;

    const jobs = rows.map(({ total_count, ...job }) => job);
const statsResult = await sql`
  SELECT
    COUNT(*) FILTER (
      WHERE COALESCE(h1b_supported, FALSE) = TRUE
    )::INTEGER AS h1b_count,

    COUNT(*) FILTER (
      WHERE
        COALESCE(contract_supported, FALSE) = TRUE
        OR COALESCE(contract_type, '') <> ''
        OR COALESCE(employment_type, '') ILIKE '%contract%'
    )::INTEGER AS contract_count,

    COUNT(*) FILTER (
      WHERE COALESCE(match_score, 0) >= 90
    )::INTEGER AS high_match_count

  FROM jobs
  WHERE COALESCE(active, TRUE) = TRUE
`;

const stats = {
  h1bFriendly: Number(statsResult[0]?.h1b_count ?? 0),
  contractJobs: Number(statsResult[0]?.contract_count ?? 0),
  highMatches: Number(statsResult[0]?.high_match_count ?? 0),
};
    return NextResponse.json({
  success: true,

  stats,

  pagination: {
    limit,
    offset,
    returned: jobs.length,
    totalMatching,
  },

  jobs,
});
  } catch (error) {
    console.error("Jobs API error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load jobs",
      },
      { status: 500 }
    );
  }
}