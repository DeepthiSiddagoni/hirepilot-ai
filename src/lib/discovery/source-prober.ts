import * as cheerio from "cheerio";
import {
  detectJobSource,
  type SourceDetectionResult,
} from "@/lib/discovery/source-detector";

export type SourceProbeResult = SourceDetectionResult & {
  originalUrl: string;
  finalUrl: string;
  httpStatus: number;
  candidatesChecked: number;
};

function absoluteUrl(
  value: string,
  baseUrl: string
) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function extractUrlsFromText(
  text: string
) {
  const matches =
    text.match(
      /https?:\/\/[^\s"'<>\\)]+/gi
    ) ?? [];

  return matches;
}

function isUsefulDetection(
  detection: SourceDetectionResult
) {
  return (
    detection.sourceType !== "unknown" &&
    detection.sourceType !== "custom_html"
  );
}

export async function probeJobSource(
  careersUrl: string
): Promise<SourceProbeResult> {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    const response = await fetch(
      careersUrl,
      {
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept:
            "text/html,application/xhtml+xml",
          "User-Agent":
            "HirePilot/0.1 source-discovery",
        },
      }
    );

    const finalUrl =
      response.url || careersUrl;

    const httpStatus =
      response.status;

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText}`
      );
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) ?? "";

    const baseline =
      detectJobSource(finalUrl);

    if (
      isUsefulDetection(baseline)
    ) {
      return {
        ...baseline,
        originalUrl: careersUrl,
        finalUrl,
        httpStatus,
        candidatesChecked: 1,
        evidence: [
          ...baseline.evidence,
          "Detected after following page redirects",
        ],
      };
    }

    if (
      !contentType
        .toLowerCase()
        .includes("text/html")
    ) {
      return {
        ...baseline,
        originalUrl: careersUrl,
        finalUrl,
        httpStatus,
        candidatesChecked: 1,
        evidence: [
          ...baseline.evidence,
          `Non-HTML response: ${contentType}`,
        ],
      };
    }

    const html =
      await response.text();

    const $ =
      cheerio.load(html);

    const candidates: string[] = [
      finalUrl,
    ];

    $("a[href]").each(
      (_, element) => {
        const href =
          $(element).attr("href");

        if (!href) {
          return;
        }

        const resolved =
          absoluteUrl(
            href,
            finalUrl
          );

        if (resolved) {
          candidates.push(
            resolved
          );
        }
      }
    );

    $("script[src]").each(
      (_, element) => {
        const src =
          $(element).attr("src");

        if (!src) {
          return;
        }

        const resolved =
          absoluteUrl(
            src,
            finalUrl
          );

        if (resolved) {
          candidates.push(
            resolved
          );
        }
      }
    );

    $("iframe[src]").each(
      (_, element) => {
        const src =
          $(element).attr("src");

        if (!src) {
          return;
        }

        const resolved =
          absoluteUrl(
            src,
            finalUrl
          );

        if (resolved) {
          candidates.push(
            resolved
          );
        }
      }
    );

    $("form[action]").each(
      (_, element) => {
        const action =
          $(element).attr(
            "action"
          );

        if (!action) {
          return;
        }

        const resolved =
          absoluteUrl(
            action,
            finalUrl
          );

        if (resolved) {
          candidates.push(
            resolved
          );
        }
      }
    );

    for (
      const extracted of
      extractUrlsFromText(html)
    ) {
      candidates.push(
        extracted
      );
    }

    const candidateUrls =
      unique(candidates)
        .slice(0, 1000);

    let best:
      | SourceDetectionResult
      | null = null;

    for (
      const candidate of
      candidateUrls
    ) {
      const detection =
        detectJobSource(
          candidate
        );

      if (
        !isUsefulDetection(
          detection
        )
      ) {
        continue;
      }

      if (
        !best ||
        detection.confidence >
          best.confidence
      ) {
        best = detection;
      }

      if (
        detection.confidence ===
        100
      ) {
        break;
      }
    }

    if (best) {
      return {
        ...best,
        originalUrl: careersUrl,
        finalUrl,
        httpStatus,
        candidatesChecked:
          candidateUrls.length,

        evidence: [
          ...best.evidence,
          `ATS reference discovered inside ${finalUrl}`,
        ],
      };
    }

    return {
      sourceType:
        "custom_html",

      sourceKey:
        new URL(finalUrl)
          .hostname,

      confidence: 50,

      detectedUrl:
        finalUrl,

      evidence: [
        "Careers page fetched successfully",
        "No supported external ATS reference found",
        "Candidate for custom collector or JavaScript/API inspection",
      ],

      originalUrl:
        careersUrl,

      finalUrl,

      httpStatus,

      candidatesChecked:
        candidateUrls.length,
    };
  } finally {
    clearTimeout(timeout);
  }
}
