import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { probeJobSource } from "@/lib/discovery/source-prober";

export async function POST() {
  try {
    const queue = await sql`
      SELECT
        q.id,
        q.careers_url,
        q.country_code,
        c.name AS company_name
      FROM source_discovery_queue q
      JOIN companies c
        ON c.id = q.company_id
      WHERE q.status = 'needs_probe'
      ORDER BY q.created_at ASC
      LIMIT 25
    `;

    const results: Array<Record<string, unknown>> = [];

    for (const row of queue) {
      const queueId =
        String(row.id);

      const company =
        String(row.company_name);

      try {
        const probe =
          await probeJobSource(
            String(
              row.careers_url
            )
          );

        const isKnownAts =
          probe.sourceType !==
            "custom_html" &&
          probe.sourceType !==
            "unknown";

        const nextStatus =
          isKnownAts
            ? "detected"
            : "needs_custom_collector";

        const evidenceJson =
          JSON.stringify(
            probe.evidence
          );

        await sql`
          UPDATE source_discovery_queue
          SET
            detected_source_type =
              ${probe.sourceType},

            detected_source_key =
              ${probe.sourceKey},

            detection_confidence =
              ${probe.confidence},

            detection_evidence =
              CAST(
                ${evidenceJson}
                AS jsonb
              ),

            detected_url =
              ${probe.detectedUrl},

            status =
              ${nextStatus},

            last_checked_at =
              NOW(),

            updated_at =
              NOW()

          WHERE id =
            ${queueId}
        `;

        results.push({
          company,
          country:
            row.country_code,

          sourceType:
            probe.sourceType,

          sourceKey:
            probe.sourceKey,

          confidence:
            probe.confidence,

          status:
            nextStatus,

          finalUrl:
            probe.finalUrl,

          httpStatus:
            probe.httpStatus,

          candidatesChecked:
            probe.candidatesChecked,

          evidence:
            probe.evidence,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Probe failed";

        await sql`
          UPDATE source_discovery_queue
          SET
            status =
              'probe_failed',

            detection_evidence =
              jsonb_build_array(
                ${message}
              ),

            last_checked_at =
              NOW(),

            updated_at =
              NOW()

          WHERE id =
            ${queueId}
        `;

        results.push({
          company,
          country:
            row.country_code,
          status:
            "probe_failed",
          error:
            message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      queueFound:
        queue.length,
      processed:
        results.length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Deep source probe failed",
      },
      {
        status: 500,
      }
    );
  }
}
