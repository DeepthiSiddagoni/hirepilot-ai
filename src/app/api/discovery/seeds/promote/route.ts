import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

function clean(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(value: unknown) {
  const raw = clean(value);

  if (!raw) {
    return "";
  }

  try {
    const prepared =
      /^https?:\/\//i.test(raw)
        ? raw
        : `https://${raw}`;

    const url = new URL(prepared);

    return url.hostname
      .replace(/^www\./i, "")
      .toLowerCase();
  } catch {
    return raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .toLowerCase();
  }
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

    const rawLimit =
      Number(
        searchParams.get("limit") ??
          "50"
      );

    const limit =
      Number.isFinite(rawLimit)
        ? Math.min(
            500,
            Math.max(
              1,
              Math.floor(rawLimit)
            )
          )
        : 50;

    const seeds =
      await sql`
        SELECT
          id,
          company_name,
          domain,
          country_code,
          state_region,
          city,
          metro_area,
          source_name,
          source_url,
          source_type,
          confidence,
          status
        FROM employer_seed_queue
        WHERE status = 'pending'
        ORDER BY
          confidence DESC,
          created_at ASC
        LIMIT ${limit}
      `;

    const results:
      Array<Record<string, unknown>> =
        [];

    let promoted = 0;
    let companiesCreated = 0;
    let companiesMatched = 0;
    let locationsCreated = 0;
    let locationsMatched = 0;
    let skipped = 0;

    for (const seed of seeds) {
      const seedId =
        String(seed.id);

      const companyName =
        clean(seed.company_name);

      const domain =
        normalizeDomain(seed.domain);

      const countryCode =
        clean(seed.country_code)
          .toUpperCase();

      const stateRegion =
        clean(seed.state_region) ||
        null;

      const city =
        clean(seed.city) ||
        null;

      const metroArea =
        clean(seed.metro_area) ||
        null;

      const sourceUrl =
        clean(seed.source_url) ||
        null;

      const confidence =
        Number(seed.confidence ?? 0);

      if (
        !companyName ||
        !countryCode
      ) {
        skipped++;

        results.push({
          companyName,
          countryCode,
          action: "skipped",
          reason:
            "Company name or country is missing",
        });

        continue;
      }

      // ============================
      // FIND EXISTING COMPANY
      // Prefer domain, then name.
      // ============================

      let company:
        Array<Record<string, unknown>> =
        [];

      if (domain) {
        company = await sql`
          SELECT id, name, domain
          FROM companies
          WHERE LOWER(domain) =
            LOWER(${domain})
          LIMIT 1
        `;
      }

      if (company.length === 0) {
        company = await sql`
          SELECT id, name, domain
          FROM companies
          WHERE LOWER(name) =
            LOWER(${companyName})
          LIMIT 1
        `;
      }

      let companyId: string;
      let companyAction:
        "create" | "match";

      if (company.length > 0) {
        companyId =
          String(company[0].id);

        companyAction = "match";
        companiesMatched++;
      } else {
        companyAction = "create";

        if (dryRun) {
          companyId =
            `dry-run-${seedId}`;
        } else {
          const inserted =
            await sql`
              INSERT INTO companies (
                name,
                domain
              )
              VALUES (
                ${companyName},
                ${domain || null}
              )
              RETURNING id
            `;

          companyId =
            String(inserted[0].id);
        }

        companiesCreated++;
      }

      // If company exists but domain
      // is empty, safely fill it.
      if (
        !dryRun &&
        domain &&
        company.length > 0 &&
        !clean(company[0].domain)
      ) {
        await sql`
          UPDATE companies
          SET
            domain = ${domain},
            updated_at = NOW()
          WHERE id = ${companyId}
        `;
      }

      // ============================
      // COMPANY LOCATION
      // Use IS NOT DISTINCT FROM so
      // NULL city/state are handled.
      // ============================

      let existingLocation:
        Array<Record<string, unknown>> =
        [];

      if (!companyId.startsWith(
        "dry-run-"
      )) {
        existingLocation =
          await sql`
            SELECT id
            FROM company_locations
            WHERE
              company_id =
                ${companyId}

              AND country_code =
                ${countryCode}

              AND state_region
                IS NOT DISTINCT FROM
                ${stateRegion}

              AND city
                IS NOT DISTINCT FROM
                ${city}
            LIMIT 1
          `;
      }

      let locationAction:
        "create" | "match";

      if (
        existingLocation.length > 0
      ) {
        locationAction = "match";
        locationsMatched++;
      } else {
        locationAction = "create";
        locationsCreated++;

        if (
          !dryRun &&
          !companyId.startsWith(
            "dry-run-"
          )
        ) {
          await sql`
            INSERT INTO company_locations (
              company_id,
              country_code,
              state_region,
              city,
              metro_area,
              location_type,
              verified,
              source_url
            )
            VALUES (
              ${companyId},
              ${countryCode},
              ${stateRegion},
              ${city},
              ${metroArea},
              'employer_presence',
              FALSE,
              ${sourceUrl}
            )
          `;
        }
      }

      if (!dryRun) {
        await sql`
          UPDATE employer_seed_queue
          SET
            company_id =
              ${companyId},

            status = 'promoted',

            updated_at = NOW()
          WHERE id = ${seedId}
        `;
      }
// ============================
// SOURCE DISCOVERY QUEUE
// ============================

let discoveryAction:
  "create" | "match" | "skip" =
  "skip";

if (
  sourceUrl &&
  !companyId.startsWith(
    "dry-run-"
  )
) {
  const existingDiscovery =
    await sql`
      SELECT id
      FROM source_discovery_queue
      WHERE
        company_id = ${companyId}
        AND country_code =
          ${countryCode}
        AND careers_url =
          ${sourceUrl}
      LIMIT 1
    `;

  if (
    existingDiscovery.length > 0
  ) {
    discoveryAction = "match";
  } else {
    discoveryAction = "create";

    if (!dryRun) {
      await sql`
        INSERT INTO source_discovery_queue (
          company_id,
          careers_url,
          expected_source_type,
          status,
          country_code,
          state_region,
          city,
          notes
        )
        VALUES (
          ${companyId},
          ${sourceUrl},
          'unknown',
          'pending',
          ${countryCode},
          ${stateRegion},
          ${city},
          'Automatically created from employer seed promotion'
        )
      `;
    }
  }
}
      promoted++;

      results.push({
        companyName,
        domain:
          domain || null,
        countryCode,
        stateRegion,
        city,
        metroArea,
        confidence,
        companyAction,
        locationAction,
        discoveryAction,
        action:
          dryRun
            ? "would_promote"
            : "promoted",
      });
    }

    return NextResponse.json({
      success: true,
      dryRun,
      seedsFound:
        seeds.length,
      promoted,
      skipped,
      companiesCreated,
      companiesMatched,
      locationsCreated,
      locationsMatched,
      results,
    });
  } catch (error) {
    console.error(
      "Employer seed promotion failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Employer seed promotion failed",
      },
      {
        status: 500,
      }
    );
  }
}