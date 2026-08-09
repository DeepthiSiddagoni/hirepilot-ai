import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jobs = await sql`
      SELECT
        job_key,
        action,
        role,
        company,
        location,
        min_years,
        c2c,
        visa,
        source,
        job_url,
        first_seen_at,
        last_seen_at
      FROM c2c_apply_queue
      WHERE active = TRUE
      ORDER BY
        CASE
          WHEN UPPER(action) = 'FAST_APPLY' THEN 1
          WHEN UPPER(action) = 'RECRUITER_FIRST' THEN 2
          ELSE 3
        END,
        first_seen_at DESC,
        role ASC
      LIMIT 300
    `;

    return NextResponse.json(
      {
        success: true,
        count: jobs.length,
        refreshedAt: new Date().toISOString(),
        jobs,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("C2C queue error:", error);

    return NextResponse.json(
      {
        success: false,
        jobs: [],
      },
      { status: 500 }
    );
  }
}
