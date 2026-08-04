import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { classifyJob } from "@/lib/intelligence/job-classifier";

export async function POST() {
  try {
    const roleFamilies = await sql`
      SELECT id, name, keywords
      FROM role_families
    `;

    const jobs = await sql`
  SELECT
    j.id,
    j.title,
    j.description,
    j.remote_type,
    j.posted_at,
    j.discovered_at
  FROM jobs j
  LEFT JOIN job_analysis ja
    ON ja.job_id = j.id
  WHERE
    j.active = TRUE
    AND (
      ja.job_id IS NULL
      OR ja.analyzed_at IS NULL
      OR COALESCE(
        j.updated_at,
        j.discovered_at
      ) > ja.analyzed_at
    )
  ORDER BY j.discovered_at DESC
`;

    let analyzed = 0;

    for (const job of jobs) {
      const analysis = classifyJob({
        title: String(job.title),
        description: job.description
          ? String(job.description)
          : null,

        remoteType: job.remote_type
          ? String(job.remote_type)
          : null,

        postedAt: job.posted_at
          ? String(job.posted_at)
          : null,

        discoveredAt: job.discovered_at
          ? String(job.discovered_at)
          : null,

        roleFamilies: roleFamilies.map((family) => ({
          id: String(family.id),
          name: String(family.name),
          keywords: Array.isArray(family.keywords)
            ? family.keywords.map(String)
            : [],
        })),
      });

      const domainJson = JSON.stringify(
        analysis.domainTags
      );

      const toolsJson = JSON.stringify(
        analysis.extractedTools
      );

      const trainingJson = JSON.stringify(
        analysis.trainingEvidence
      );

      const transitionJson = JSON.stringify(
        analysis.transitionEvidence
      );

      const explanationJson = JSON.stringify(
        analysis.roleMatches
      );

      await sql`
        INSERT INTO job_analysis (
          job_id,
          role_family,
          primary_role_family,

          classification_confidence,

          domain_tags,
          extracted_tools,

          work_arrangement,
          remote_score,

          training_likelihood,
          transition_friendliness,

          training_evidence,
          transition_evidence,

          job_freshness_score,

          role_match_explanation,

          updated_at
        )

        VALUES (
          ${String(job.id)},

          ${analysis.primaryRoleFamily},
          ${analysis.primaryRoleFamily},

          ${analysis.classificationConfidence},

          ARRAY(
            SELECT jsonb_array_elements_text(
              CAST(${domainJson} AS jsonb)
            )
          ),

          ARRAY(
            SELECT jsonb_array_elements_text(
              CAST(${toolsJson} AS jsonb)
            )
          ),

          ${analysis.workArrangement},
          ${analysis.remoteScore},

          ${analysis.trainingLikelihood},
          ${analysis.transitionFriendliness},

          ARRAY(
            SELECT jsonb_array_elements_text(
              CAST(${trainingJson} AS jsonb)
            )
          ),

          ARRAY(
            SELECT jsonb_array_elements_text(
              CAST(${transitionJson} AS jsonb)
            )
          ),

          ${analysis.jobFreshnessScore},

          CAST(${explanationJson} AS jsonb),

          NOW()
        )

        ON CONFLICT (job_id)

        DO UPDATE SET
          role_family =
            EXCLUDED.role_family,

          primary_role_family =
            EXCLUDED.primary_role_family,

          classification_confidence =
            EXCLUDED.classification_confidence,

          domain_tags =
            EXCLUDED.domain_tags,

          extracted_tools =
            EXCLUDED.extracted_tools,

          work_arrangement =
            EXCLUDED.work_arrangement,

          remote_score =
            EXCLUDED.remote_score,

          training_likelihood =
            EXCLUDED.training_likelihood,

          transition_friendliness =
            EXCLUDED.transition_friendliness,

          training_evidence =
            EXCLUDED.training_evidence,

          transition_evidence =
            EXCLUDED.transition_evidence,

          job_freshness_score =
            EXCLUDED.job_freshness_score,

          role_match_explanation =
  EXCLUDED.role_match_explanation,

analyzed_at = NOW(),

updated_at = NOW()
      `;

      await sql`
        DELETE FROM job_role_matches
        WHERE job_id = ${String(job.id)}
      `;

      for (const match of analysis.roleMatches.slice(0, 5)) {
        await sql`
          INSERT INTO job_role_matches (
            job_id,
            role_family_id,
            match_score
          )

          VALUES (
            ${String(job.id)},
            ${match.id},
            ${match.score}
          )

          ON CONFLICT (
            job_id,
            role_family_id
          )

          DO UPDATE SET
            match_score =
              EXCLUDED.match_score
        `;
      }

      analyzed++;
    }
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
      jobsFound: jobs.length,
      jobsAnalyzed: analyzed,
    });
  } catch (error) {
    console.error(
      "Job intelligence analysis failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Job analysis failed",
      },
      { status: 500 }
    );
  }
}