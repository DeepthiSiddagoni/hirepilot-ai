import { sql } from "@/lib/db";

import {
  analyzeJobSemantically,
} from "@/lib/intelligence/semantic-job-analyzer";

type SemanticJobOptions = {
  alreadyClaimed?: boolean;
};

export async function analyzeAndSaveSemanticJob(
  jobId: string,
  options: SemanticJobOptions = {}
) {
  const cleanJobId =
    jobId.trim();

  if (!cleanJobId) {
    throw new Error(
      "jobId is required"
    );
  }

  const jobs =
    await sql`
      SELECT
        j.id,
        j.title,
        j.description,
        j.location,
        j.employment_type,
        c.name AS company_name
      FROM jobs j
      JOIN companies c
        ON c.id =
          j.company_id
      WHERE j.id =
        ${cleanJobId}
      LIMIT 1
    `;

  if (jobs.length === 0) {
    throw new Error(
      "Job not found"
    );
  }

  const job =
    jobs[0];

  if (
    !options.alreadyClaimed
  ) {
    await sql`
      UPDATE job_analysis
      SET
        semantic_status =
          'processing',

        semantic_attempts =
          COALESCE(
            semantic_attempts,
            0
          ) + 1,

        semantic_last_attempt_at =
          NOW(),

        semantic_error =
          NULL,

        updated_at =
          NOW()

      WHERE job_id =
        ${cleanJobId}
    `;
  }

  try {
    const roleFamilyRows =
      await sql`
        SELECT name
        FROM role_families
        WHERE name <>
          'Career Transition & Training Friendly'
        ORDER BY name
      `;

    const analysis =
      await analyzeJobSemantically({
        title:
          String(job.title),

        company:
          String(
            job.company_name
          ),

        description:
          job.description
            ? String(
                job.description
              )
            : "",

        location:
          job.location
            ? String(
                job.location
              )
            : null,

        employmentType:
          job.employment_type
            ? String(
                job.employment_type
              )
            : null,

        knownRoleFamilies:
          roleFamilyRows.map(
            (row) =>
              String(row.name)
          ),
      });

    const normalizedConfidence =
      Math.max(
        0,
        Math.min(
          100,
          Math.round(
            analysis.confidence <= 1
              ? analysis.confidence *
                  100
              : analysis.confidence
          )
        )
      );

    const normalizeScore = (
      value: number
    ) =>
      Math.max(
        0,
        Math.min(
          100,
          Math.round(
            value <= 1
              ? value * 100
              : value
          )
        )
      );

    const normalizedRelatedRoles =
      analysis.relatedRoles.map(
        (role) => ({
          ...role,
          score:
            normalizeScore(
              role.score
            ),
        })
      );

    const normalizedAnalysis = {
      ...analysis,

      relatedRoles:
        normalizedRelatedRoles,

      trainingLikelihood:
        normalizeScore(
          analysis.trainingLikelihood
        ),

      transitionFriendliness:
        normalizeScore(
          analysis.transitionFriendliness
        ),

      confidence:
        normalizedConfidence,
    };

    const extractedSkills =
      Array.from(
        new Set([
          ...analysis.requiredSkills,
          ...analysis.preferredSkills,
          ...analysis.toolsAndTechnologies,
        ])
      );

    const relatedRolesJson =
      JSON.stringify(
        normalizedRelatedRoles
      );

    const roleDomainsJson =
      JSON.stringify(
        analysis.roleDomains
      );

    const responsibilitiesJson =
      JSON.stringify(
        analysis.responsibilities
      );

    const skillsJson =
      JSON.stringify(
        extractedSkills
      );

    const transferableJson =
      JSON.stringify(
        analysis.transferableSkills
      );

    const adjacentRolesJson =
      JSON.stringify(
        analysis.adjacentRoleTitles
      );

    const semanticDataJson =
      JSON.stringify(
        normalizedAnalysis
      );

    await sql`
      INSERT INTO job_analysis (
        job_id,

        semantic_summary,

        semantic_primary_role_family,

        semantic_role_matches,

        role_domain_tags,

        extracted_responsibilities,

        extracted_skills,

        transferable_skills,

        adjacent_role_titles,

        seniority_level,

        years_experience_min,

        years_experience_max,

        semantic_confidence,

        semantic_data,

        semantic_status,

        semantic_error,

        semantic_analyzed_at,

        updated_at
      )

      VALUES (
        ${cleanJobId},

        ${analysis.semanticSummary},

        ${analysis.primaryRoleFamily},

        CAST(
          ${relatedRolesJson}
          AS jsonb
        ),

        ARRAY(
          SELECT
            jsonb_array_elements_text(
              CAST(
                ${roleDomainsJson}
                AS jsonb
              )
            )
        ),

        ARRAY(
          SELECT
            jsonb_array_elements_text(
              CAST(
                ${responsibilitiesJson}
                AS jsonb
              )
            )
        ),

        ARRAY(
          SELECT
            jsonb_array_elements_text(
              CAST(
                ${skillsJson}
                AS jsonb
              )
            )
        ),

        ARRAY(
          SELECT
            jsonb_array_elements_text(
              CAST(
                ${transferableJson}
                AS jsonb
              )
            )
        ),

        ARRAY(
          SELECT
            jsonb_array_elements_text(
              CAST(
                ${adjacentRolesJson}
                AS jsonb
              )
            )
        ),

        ${analysis.seniorityLevel},

        ${analysis.yearsExperienceMin},

        ${analysis.yearsExperienceMax},

        ${normalizedConfidence},

        CAST(
          ${semanticDataJson}
          AS jsonb
        ),

        'completed',

        NULL,

        NOW(),

        NOW()
      )

      ON CONFLICT (
        job_id
      )

      DO UPDATE SET
        semantic_summary =
          EXCLUDED.semantic_summary,

        semantic_primary_role_family =
          EXCLUDED.semantic_primary_role_family,

        semantic_role_matches =
          EXCLUDED.semantic_role_matches,

        role_domain_tags =
          EXCLUDED.role_domain_tags,

        extracted_responsibilities =
          EXCLUDED.extracted_responsibilities,

        extracted_skills =
          EXCLUDED.extracted_skills,

        transferable_skills =
          EXCLUDED.transferable_skills,

        adjacent_role_titles =
          EXCLUDED.adjacent_role_titles,

        seniority_level =
          EXCLUDED.seniority_level,

        years_experience_min =
          EXCLUDED.years_experience_min,

        years_experience_max =
          EXCLUDED.years_experience_max,

        semantic_confidence =
          EXCLUDED.semantic_confidence,

        semantic_data =
          EXCLUDED.semantic_data,

        semantic_status =
          'completed',

        semantic_error =
          NULL,

        semantic_analyzed_at =
          NOW(),

        updated_at =
          NOW()
    `;

    return {
      job: {
        id:
          String(job.id),

        title:
          String(job.title),

        company:
          String(
            job.company_name
          ),
      },

      analysis:
        normalizedAnalysis,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Semantic analysis failed";

    await sql`
      UPDATE job_analysis

      SET
        semantic_status =
          'error',

        semantic_error =
          ${message},

        semantic_last_attempt_at =
          NOW(),

        updated_at =
          NOW()

      WHERE job_id =
        ${cleanJobId}
    `;

    throw error;
  }
}
