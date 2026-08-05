import {
  NextRequest,
  NextResponse,
} from "next/server";

import { sql } from "@/lib/db";

import {
  analyzeSponsorshipForJob,
} from "@/lib/intelligence/sponsorship-engine";

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

    const limit = clamp(
      Number(
        params.get("limit") ?? 20
      ),
      1,
      50
    );

    const company =
      params.get("company")
        ?.trim() || null;

    const jobs = company
      ? await sql`
          SELECT
            j.id,
            j.title,
            c.name AS company
          FROM jobs j
          JOIN companies c
            ON c.id = j.company_id
          JOIN job_analysis ja
            ON ja.job_id = j.id
          WHERE
            j.active = TRUE
            AND LOWER(c.name) =
                LOWER(${company})
            AND (
              ja.sponsorship_model_version
              IS NULL
              OR
              ja.sponsorship_model_version
              <> 'lca-sponsorship-v1'
            )
          ORDER BY
            j.posted_at DESC NULLS LAST,
            j.created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT
            j.id,
            j.title,
            c.name AS company
          FROM jobs j
          JOIN companies c
            ON c.id = j.company_id
          JOIN job_analysis ja
            ON ja.job_id = j.id
          WHERE
            j.active = TRUE
            AND (
              ja.sponsorship_model_version
              IS NULL
              OR
              ja.sponsorship_model_version
              <> 'lca-sponsorship-v1'
            )
          ORDER BY
            j.posted_at DESC NULLS LAST,
            j.created_at DESC
          LIMIT ${limit}
        `;

    const results = [];

    for (const job of jobs) {
      try {
        const analysis =
          await analyzeSponsorshipForJob(
            String(job.id)
          );

        results.push({
          jobId: job.id,
          title: job.title,
          company: job.company,
          status: "completed",
          probability:
            analysis.sponsorshipProbability,
          confidence:
            analysis.sponsorshipConfidence,
          lcaFilings:
            analysis.evidence.lcaFilings,
          similarTitleFilings:
            analysis.evidence
              .similarTitleFilings,
          sameStateFilings:
            analysis.evidence
              .sameStateFilings,
          postingSignal:
            analysis.evidence
              .postingSignal,
        });
      } catch (error) {
        results.push({
          jobId: job.id,
          title: job.title,
          company: job.company,
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      requestedLimit: limit,
      company,
      jobsFound: jobs.length,
      completed:
        results.filter(
          (r) =>
            r.status ===
            "completed"
        ).length,
      failed:
        results.filter(
          (r) =>
            r.status ===
            "failed"
        ).length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Batch sponsorship analysis failed",
      },
      {
        status: 500,
      }
    );
  }
}
