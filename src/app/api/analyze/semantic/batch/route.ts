import {
  NextRequest,
  NextResponse,
} from "next/server";

import { sql } from "@/lib/db";

import {
  analyzeAndSaveSemanticJob,
} from "@/lib/intelligence/semantic-job-service";

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.min(
    max,
    Math.max(
      min,
      value
    )
  );
}

export async function POST(
  request: NextRequest
) {
  try {
    const params =
      request.nextUrl.searchParams;

    const rawLimit =
      Number(
        params.get("limit") ??
          "3"
      );

    const rawDays =
      Number(
        params.get("days") ??
          "7"
      );

    const limit =
      clamp(
        Number.isFinite(
          rawLimit
        )
          ? Math.floor(
              rawLimit
            )
          : 3,
        1,
        5
      );

    const days =
      clamp(
        Number.isFinite(
          rawDays
        )
          ? Math.floor(
              rawDays
            )
          : 7,
        1,
        30
      );

    const dryRun =
      params.get(
        "dryRun"
      ) === "true";

    const company =
      (
        params.get(
          "company"
        ) ?? ""
      ).trim();

    const candidates =
      await sql`
        SELECT
          j.id,
          j.title,
          j.posted_at,
          c.name AS company_name,

          COALESCE(
            ja.semantic_attempts,
            0
          ) AS attempts

        FROM job_analysis ja

        JOIN jobs j
          ON j.id =
            ja.job_id

        JOIN companies c
          ON c.id =
            j.company_id

        WHERE
          j.active = TRUE

          AND ja.semantic_status
            IN (
              'pending',
              'error'
            )

          AND COALESCE(
            ja.semantic_attempts,
            0
          ) < 3

          AND j.description
            IS NOT NULL

          AND LENGTH(
            TRIM(
              j.description
            )
          ) >= 200

          AND j.posted_at >=
            NOW() -
            (
              ${days} *
              INTERVAL '1 day'
            )

          AND (
            ${company} = ''
            OR LOWER(
              c.name
            ) =
            LOWER(
              ${company}
            )
          )

        ORDER BY
          j.posted_at DESC,
          j.discovered_at DESC

        LIMIT ${limit}
      `;

    if (dryRun) {
      return NextResponse.json({
        success: true,

        dryRun: true,

        days,

        limit,

        company:
          company || null,

        candidatesFound:
          candidates.length,

        candidates:
          candidates.map(
            (row) => ({
              jobId:
                String(row.id),

              title:
                String(
                  row.title
                ),

              company:
                String(
                  row.company_name
                ),

              postedAt:
                row.posted_at,

              attempts:
                Number(
                  row.attempts ??
                    0
                ),
            })
          ),
      });
    }

    const results:
      Array<
        Record<
          string,
          unknown
        >
      > = [];

    let completed = 0;
    let failed = 0;
    let skipped = 0;

    for (
      const row of
      candidates
    ) {
      const jobId =
        String(row.id);

      const claimed =
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

          WHERE
            job_id =
              ${jobId}

            AND semantic_status
              IN (
                'pending',
                'error'
              )

            AND COALESCE(
              semantic_attempts,
              0
            ) < 3

          RETURNING job_id
        `;

      if (
        claimed.length === 0
      ) {
        skipped++;

        results.push({
          jobId,

          title:
            String(
              row.title
            ),

          status:
            "skipped",

          reason:
            "Job was already claimed or reached maximum attempts",
        });

        continue;
      }

      try {
        const result =
          await analyzeAndSaveSemanticJob(
            jobId,
            {
              alreadyClaimed:
                true,
            }
          );

        completed++;

        results.push({
          jobId,

          title:
            result.job.title,

          company:
            result.job.company,

          status:
            "completed",

          primaryRoleFamily:
            result.analysis
              .primaryRoleFamily,

          confidence:
            result.analysis
              .confidence,
        });
      } catch (error) {
        failed++;

        results.push({
          jobId,

          title:
            String(
              row.title
            ),

          company:
            String(
              row.company_name
            ),

          status:
            "error",

          error:
            error instanceof Error
              ? error.message
              : "Semantic analysis failed",
        });
      }
    }

    return NextResponse.json({
      success:
        failed === 0,

      dryRun: false,

      days,

      limit,

      company:
        company || null,

      candidatesFound:
        candidates.length,

      completed,

      failed,

      skipped,

      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Semantic batch failed",
      },
      {
        status: 500,
      }
    );
  }
}
