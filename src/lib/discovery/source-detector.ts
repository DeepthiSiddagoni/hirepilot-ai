export type DetectedSourceType =
  | "greenhouse"
  | "lever"
  | "workday"
  | "ashby"
  | "smartrecruiters"
  | "icims"
  | "taleo"
  | "vaco"
  | "eightfold"
  | "custom_html"
  | "unknown";

export type SourceDetectionResult = {
  sourceType: DetectedSourceType;
  sourceKey: string | null;
  confidence: number;
  detectedUrl: string;
  evidence: string[];
};

function cleanUrl(value: string) {
  return value.trim();
}

function hostnameOf(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function pathParts(value: string) {
  try {
    return new URL(value).pathname
      .split("/")
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function detectJobSource(
  careersUrl: string
): SourceDetectionResult {
  const url = cleanUrl(careersUrl);
  const lower = url.toLowerCase();
  const hostname = hostnameOf(url);
  const parts = pathParts(url);

  // ==========================================
  // GREENHOUSE
  // ==========================================

  if (
    hostname.includes("greenhouse.io") ||
    hostname.includes("greenhouse.com")
  ) {
    let sourceKey: string | null = null;

    const boardsIndex = parts.findIndex(
      (part) =>
        part.toLowerCase() === "boards" ||
        part.toLowerCase() === "job-boards"
    );

    if (
      boardsIndex >= 0 &&
      parts[boardsIndex + 1]
    ) {
      sourceKey = parts[boardsIndex + 1];
    } else if (parts.length > 0) {
      sourceKey = parts[0];
    }

    return {
      sourceType: "greenhouse",
      sourceKey,
      confidence: 100,
      detectedUrl: url,
      evidence: [
        "Greenhouse hostname detected",
      ],
    };
  }

  // ==========================================
  // LEVER
  // ==========================================

  if (
    hostname === "jobs.lever.co" ||
    hostname.endsWith(".lever.co")
  ) {
    return {
      sourceType: "lever",
      sourceKey: parts[0] ?? null,
      confidence: 100,
      detectedUrl: url,
      evidence: [
        "Lever careers hostname detected",
      ],
    };
  }

  // ==========================================
  // WORKDAY
  // ==========================================

  if (
    hostname.includes("myworkdayjobs.com") ||
    hostname.includes("workday.com")
  ) {
    return {
      sourceType: "workday",
      sourceKey: hostname,
      confidence: 100,
      detectedUrl: url,
      evidence: [
        "Workday careers hostname detected",
      ],
    };
  }

  // ==========================================
  // ASHBY
  // ==========================================

  if (
    hostname === "jobs.ashbyhq.com" ||
    hostname.endsWith(".ashbyhq.com")
  ) {
    return {
      sourceType: "ashby",
      sourceKey: parts[0] ?? null,
      confidence: 100,
      detectedUrl: url,
      evidence: [
        "Ashby careers hostname detected",
      ],
    };
  }

  // ==========================================
  // SMARTRECRUITERS
  // ==========================================

  if (
    hostname.includes("smartrecruiters.com")
  ) {
    return {
      sourceType: "smartrecruiters",
      sourceKey:
        parts[0] ?? null,
      confidence: 100,
      detectedUrl: url,
      evidence: [
        "SmartRecruiters hostname detected",
      ],
    };
  }

  // ==========================================
  // ICIMS
  // ==========================================

  if (
    hostname.includes("icims.com") ||
    lower.includes("/jobs/search")
  ) {
    return {
      sourceType: "icims",
      sourceKey: hostname || null,
      confidence:
        hostname.includes("icims.com")
          ? 100
          : 65,
      detectedUrl: url,
      evidence: [
        hostname.includes("icims.com")
          ? "iCIMS hostname detected"
          : "Common iCIMS job-search path detected",
      ],
    };
  }

  // ==========================================
  // TALEO
  // ==========================================

  if (
    hostname.includes("taleo.net") ||
    lower.includes("careersection")
  ) {
    return {
      sourceType: "taleo",
      sourceKey: hostname || null,
      confidence: 95,
      detectedUrl: url,
      evidence: [
        "Oracle Taleo pattern detected",
      ],
    };
  }

  // ==========================================
  // VACO CUSTOM COLLECTOR
  // ==========================================

  if (
    hostname === "jobs.vaco.com" ||
    hostname.endsWith(".vaco.com")
  ) {
    return {
      sourceType: "vaco",
      sourceKey: "US",
      confidence: 100,
      detectedUrl: url,
      evidence: [
        "Known Vaco public job board detected",
      ],
    };
  }
  // =====================================
  // EIGHTFOLD / PCSX
  // =====================================

  if (
    hostname.includes("eightfold") ||
    lower.includes("/pcsx/") ||
    hostname === "apply.careers.microsoft.com"
  ) {
    return {
      sourceType: "eightfold",
      sourceKey: hostname || null,
      confidence: 100,
      detectedUrl: url,
      evidence: [
        "Eightfold / PCSX careers platform detected",
      ],
    };
  }

  // =====================================
  // GENERIC CAREERS PAGE
  // =====================================
  // ==========================================
  // GENERIC CAREERS PAGE
  // ==========================================

  if (
    lower.includes("career") ||
    lower.includes("/jobs") ||
    lower.includes("job-search") ||
    lower.includes("search-jobs")
  ) {
    return {
      sourceType: "custom_html",
      sourceKey: hostname || null,
      confidence: 40,
      detectedUrl: url,
      evidence: [
        "Generic careers/jobs URL detected",
      ],
    };
  }

  return {
    sourceType: "unknown",
    sourceKey: hostname || null,
    confidence: 0,
    detectedUrl: url,
    evidence: [
      "No supported ATS pattern detected",
    ],
  };
}
