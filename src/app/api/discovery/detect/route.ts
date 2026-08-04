import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { detectJobSource } from "@/lib/discovery/source-detector";

export async function POST() {
  try {
    const queue = await sql`
      SELECT
        q.id,
        q.company_id,
        q.careers_url,
        q.expected_source_type,
        q.status,
        q.country_code,
        c.name AS company_name
      FROM source_discovery_queue q
      JOIN companies c
        ON c.id = q.company_id
      WHERE q.status IN (
        'pending',
        'needs_probe'
      )
      ORDER BY q.created_at ASC
      LIMIT 100
    `;

    const results: Array<{
      company: string;
      country: string | null;
      expectedSourceType: string | null;
      detectedSourceType: string;
      detectedSourceKey: string | null;
      confidence: number;
      status: string;
      evidence: string[];
    }> = [];

    for (const row of queue) {
      const queueId = String(row.id);
      const companyName = String(row.company_name);
      const careersUrl = String(row.careers_url);

      const detection =
        detectJobSource(careersUrl);

      const nextStatus =
        detection.sourceType === "unknown" ||
        detection.sourceType === "custom_html"
          ? "needs_probe"
          : "detected";

      const evidenceJson =
        JSON.stringify(detection.evidence);

      await sql`
        UPDATE source_discovery_queue
        SET
          detected_source_type =
            ${detection.sourceType},

          detected_source_key =
            ${detection.sourceKey},

          detection_confidence =
            ${detection.confidence},

          detection_evidence =
            CAST(${evidenceJson} AS jsonb),

          detected_url =
            ${detection.detectedUrl},

          status =
            ${nextStatus},

          last_checked_at = NOW(),

          updated_at = NOW()

        WHERE id = ${queueId}
      `;

      results.push({
        company: companyName,

        country:
          row.country_code
            ? String(row.country_code)
            : null,

        expectedSourceType:
          row.expected_source_type
            ? String(row.expected_source_type)
            : null,

        detectedSourceType:
          detection.sourceType,

        detectedSourceKey:
          detection.sourceKey,

        confidence:
          detection.confidence,

        status:
          nextStatus,

        evidence:
          detection.evidence,
      });
    }

    return NextResponse.json({
      success: true,
      queueFound: queue.length,
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error(
      "Source discovery detection failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Source detection failed",
      },
      { status: 500 }
    );
  }
}
