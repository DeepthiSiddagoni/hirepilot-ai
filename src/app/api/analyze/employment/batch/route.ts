import {
  NextRequest,
  NextResponse,
} from "next/server";

import { sql } from "@/lib/db";

import {
  analyzeEmploymentModel,
} from "@/lib/intelligence/employment-model";

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.min(
    max,
    Math.max(min, value)
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
          "20"
      );

    const limit =
      clamp(
        Number.isFinite(rawLimit)
          ? Math.floor(rawLimit)
          : 20,
        1,
        500
      );

    const dryRun =
      params.get("dryRun") ===
      "true";

    const company =
      (
        params.get("company") ??
        ""
      ).trim();

    const jobs =
      await sql`
        SELECT
          j.id,
          j.title,
          j.description,
          j.employment_type,
          c.name AS company_name

        FROM job_analysis ja

        JOIN jobs j
          ON j.id =
            ja.job_id

        JOIN companies c
          ON c.id =
            j.company_id

        WHERE
          j.active = TRUE

          AND (
            ja.employment_analysis_data
            IS NULL
          )

          AND (
            ${company} = ''
            OR LOWER(c.name) =
              LOWER(${company})
          )

        ORDER BY
          j.posted_at DESC NULLS LAST,
          j.discovered_at DESC

        LIMIT ${limit}
      `;

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        limit,
        company:
          company || null,
        candidatesFound:
          jobs.length,

        candidates:
          jobs.map(
            (job) => ({
              jobId:
                String(job.id),

              title:
                String(job.title),

              company:
                String(
                  job.company_name
                ),

              employmentType:
                job.employment_type,
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

    let analyzed = 0;

    for (const job of jobs) {
      const jobId =
        String(job.id);

      const analysis =
        analyzeEmploymentModel({
          title:
            job.title
              ? String(job.title)
              : null,

          company:
            job.company_name
              ? String(
                  job.company_name
                )
              : null,

          description:
            job.description
              ? String(
                  job.description
                )
              : null,

          employmentType:
            job.employment_type
              ? String(
                  job.employment_type
                )
              : null,
        });

      const c2cEvidenceJson =
        JSON.stringify(
          analysis.c2cEvidence
        );

      const analysisJson =
        JSON.stringify(
          analysis
        );

      await sql`
        UPDATE job_analysis

        SET
          employment_model =
            ${analysis.employmentModel},

          c2c_probability =
            ${analysis.c2cProbability},

          c2c_confidence =
            ${analysis.c2cConfidence},

          c2c_evidence =
            ARRAY(
              SELECT
                jsonb_array_elements_text(
                  CAST(
                    ${c2cEvidenceJson}
                    AS jsonb
                  )
                )
            ),

          w2_probability =
            ${analysis.w2Probability},

          contract_probability =
            ${analysis.contractProbability},

          contract_to_hire_probability =
            ${analysis.contractToHireProbability},

          staffing_vendor_signal =
            ${analysis.staffingVendorSignal},

          employment_analysis_data =
            CAST(
              ${analysisJson}
              AS jsonb
            ),

          updated_at =
            NOW()

        WHERE job_id =
          ${jobId}
      `;

      analyzed++;

      results.push({
        jobId,

        title:
          String(job.title),

        company:
          String(
            job.company_name
          ),

        employmentModel:
          analysis.employmentModel,

        c2cProbability:
          analysis.c2cProbability,

        c2cConfidence:
          analysis.c2cConfidence,

        w2Probability:
          analysis.w2Probability,

        contractProbability:
          analysis.contractProbability,

        staffingVendorSignal:
          analysis.staffingVendorSignal,
      });
    }

    return NextResponse.json({
      success: true,
      dryRun: false,
      limit,
      company:
        company || null,
      candidatesFound:
        jobs.length,
      analyzed,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Employment analysis failed",
      },
      {
        status: 500,
      }
    );
  }
}
