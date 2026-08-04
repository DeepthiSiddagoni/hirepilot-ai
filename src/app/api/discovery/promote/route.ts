import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

const SUPPORTED_SOURCE_TYPES =
  new Set([
    "greenhouse",
    "lever",
    "workday",
    "vaco",
  ]);

function clean(value: unknown) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

function buildWorkdayConfig(
  detectedSourceKey: string,
  detectedUrl: string,
  countryCode: string
) {
  const host =
    clean(detectedSourceKey)
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "");

  if (!host) {
    return null;
  }

  const tenant =
    host.split(".")[0] ?? "";

  let site = "";

  if (detectedUrl) {
    try {
      const url =
        new URL(detectedUrl);

      const parts =
        url.pathname
          .split("/")
          .filter(Boolean);

      const localeIndex =
        parts.findIndex(
          (part) =>
            /^[a-z]{2}-[A-Z]{2}$/.test(
              part
            )
        );

      if (
        localeIndex >= 0 &&
        parts[localeIndex + 1]
      ) {
        site =
          parts[localeIndex + 1];
      }
    } catch {
      // Ignore invalid detected URL.
    }
  }

  if (!tenant || !site) {
    return null;
  }

  return {
    host,
    tenant,
    site,
    country:
      countryCode || undefined,

    // Safe initial defaults.
    maxJobs: 20,
    pageSize: 20,
  };
}

export async function POST(
  request: Request
) {
  try {
    const { searchParams } =
      new URL(request.url);

    const dryRun =
      searchParams.get("dryRun") ===
      "true";

    const rawConfidence =
      Number(
        searchParams.get(
          "minConfidence"
        ) ?? "90"
      );

    const minConfidence =
      Number.isFinite(rawConfidence)
        ? Math.min(
            100,
            Math.max(
              0,
              rawConfidence
            )
          )
        : 90;

    const queue =
      await sql`
        SELECT
          q.id,
          q.company_id,
          q.country_code,
          q.careers_url,
          q.status,
          q.detected_source_type,
          q.detected_source_key,
          q.detection_confidence,
          q.detected_url,
          c.name AS company_name
        FROM source_discovery_queue q
        JOIN companies c
          ON c.id = q.company_id
        WHERE
          q.status = 'detected'
          AND q.detection_confidence >= ${minConfidence}
        ORDER BY
          q.detection_confidence DESC,
          c.name
        LIMIT 100
      `;

    const results:
      Array<Record<string, unknown>> =
        [];

    let promoted = 0;
    let skipped = 0;

    for (const row of queue) {
      const queueId =
        String(row.id);

      const companyId =
        String(row.company_id);

      const company =
        clean(row.company_name);

      const countryCode =
        clean(row.country_code)
          .toUpperCase();

      const detectedType =
        clean(
          row.detected_source_type
        ).toLowerCase();

      const detectedKey =
        clean(
          row.detected_source_key
        );

      const detectedUrl =
        clean(row.detected_url);

      const careersUrl =
        detectedUrl ||
        clean(row.careers_url) ||
        null;

      const confidence =
        Number(
          row.detection_confidence ??
            0
        );

      if (
        !SUPPORTED_SOURCE_TYPES.has(
          detectedType
        )
      ) {
        skipped++;

        results.push({
          company,
          sourceType:
            detectedType,
          confidence,
          action: "skipped",
          reason:
            "Source type does not have a reusable collector yet",
        });

        continue;
      }

      let sourceKey =
        detectedKey;

      let sourceConfig:
        Record<string, unknown> |
        null = null;

      // ============================
      // WORKDAY
      // ============================
      if (
        detectedType ===
        "workday"
      ) {
        const config =
          buildWorkdayConfig(
            detectedKey,
            detectedUrl,
            countryCode
          );

        if (!config) {
          skipped++;

          results.push({
            company,
            sourceType:
              detectedType,
            confidence,
            action: "skipped",
            reason:
              "Could not safely build Workday configuration",
          });

          continue;
        }

        sourceConfig =
          config;

        // Use tenant as normal source key.
        sourceKey =
          config.tenant;
      }

      // ============================
      // VACO
      // ============================
      if (
        detectedType === "vaco"
      ) {
        sourceKey =
          countryCode ||
          detectedKey ||
          "US";

        sourceConfig = {
          country:
            countryCode ||
            sourceKey,
        };
      }

      if (!sourceKey) {
        skipped++;

        results.push({
          company,
          sourceType:
            detectedType,
          confidence,
          action: "skipped",
          reason:
            "Missing source key",
        });

        continue;
      }

      const existing =
        await sql`
          SELECT id
          FROM company_sources
          WHERE
            company_id = ${companyId}
            AND LOWER(source_type) =
              ${detectedType}
          LIMIT 1
        `;

      const action =
        existing.length > 0
          ? "update"
          : "create";

      if (dryRun) {
        results.push({
          company,
          sourceType:
            detectedType,
          sourceKey,
          confidence,
          action:
            `would_${action}`,
          sourceConfig,
        });

        continue;
      }

      const sourceConfigJson =
        sourceConfig
          ? JSON.stringify(
              sourceConfig
            )
          : null;

      if (existing.length > 0) {
        const sourceId =
          String(
            existing[0].id
          );

        await sql`
          UPDATE company_sources
          SET
            source_key =
              ${sourceKey},

            careers_url =
              COALESCE(
                ${careersUrl},
                careers_url
              ),

            source_config =
              COALESCE(
                CAST(
                  ${sourceConfigJson}
                  AS jsonb
                ),
                source_config
              ),

            active = TRUE,
            scan_error = NULL,
            updated_at = NOW()
          WHERE id = ${sourceId}
        `;
      } else {
        await sql`
          INSERT INTO company_sources (
            company_id,
            source_type,
            source_key,
            careers_url,
            source_config,
            active
          )
          VALUES (
            ${companyId},
            ${detectedType},
            ${sourceKey},
            ${careersUrl},
            CAST(
              ${sourceConfigJson}
              AS jsonb
            ),
            TRUE
          )
        `;
      }

      await sql`
        UPDATE source_discovery_queue
        SET
          status = 'promoted',
          last_checked_at = NOW(),
          updated_at = NOW()
        WHERE id = ${queueId}
      `;

      promoted++;

      results.push({
        company,
        sourceType:
          detectedType,
        sourceKey,
        confidence,
        action,
        status: "promoted",
      });
    }

    return NextResponse.json({
      success: true,
      dryRun,
      minConfidence,
      candidatesFound:
        queue.length,
      promoted,
      skipped,
      results,
    });
  } catch (error) {
    console.error(
      "Source promotion failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Source promotion failed",
      },
      {
        status: 500,
      }
    );
  }
}