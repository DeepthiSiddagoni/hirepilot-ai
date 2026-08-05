export type EmploymentModel =
  | "direct-hire"
  | "w2-contract"
  | "c2c"
  | "contract-to-hire"
  | "temporary"
  | "internship"
  | "mixed-contract"
  | "unknown";

export type EmploymentAnalysis = {
  employmentModel: EmploymentModel;

  c2cProbability: number;
  c2cConfidence: number;
  c2cEvidence: string[];

  w2Probability: number;
  contractProbability: number;
  contractToHireProbability: number;

  staffingVendorSignal: boolean;

  evidence: string[];
};

function normalize(
  value: string | null | undefined
) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(
  text: string,
  patterns: string[]
) {
  return patterns.some(
    (pattern) =>
      text.includes(pattern)
  );
}

export function analyzeEmploymentModel(args: {
  title?: string | null;
  company?: string | null;
  description?: string | null;
  employmentType?: string | null;
}) : EmploymentAnalysis {

  const title =
    normalize(args.title);

  const company =
    normalize(args.company);

  const description =
    normalize(args.description);

  const employmentType =
    normalize(
      args.employmentType
    );

  const text =
    `${title} ${description} ${employmentType}`;

  const evidence: string[] = [];
  const c2cEvidence: string[] = [];

  const noC2CSignals = [
    "no c2c",
    "no corp-to-corp",
    "no corp to corp",
    "c2c not accepted",
    "c2c not available",
    "c2c candidates will not be considered",
    "no 1099",
    "w2 only",
    "w-2 only",
    "must be on our w2",
    "must be on our w-2",
  ];

  const explicitC2CSignals = [
    "corp-to-corp",
    "corp to corp",
    "c2c",
    "c2c contract",
    "1099 contractor",
    "1099 contract",
  ];

  const explicitW2Signals = [
    "w2 only",
    "w-2 only",
    "w2 contract",
    "w-2 contract",
    "on our w2",
    "on our w-2",
    "must be on our w2",
    "must be on our w-2",
  ];

  const contractToHireSignals = [
    "contract-to-hire",
    "contract to hire",
    "contract-to-perm",
    "contract to perm",
    "temp-to-hire",
    "temp to hire",
  ];

  const contractSignals = [
    "contract position",
    "contract role",
    "contract opportunity",
    "contract assignment",
    "contractor position",
    "contractor role",
    "consulting assignment",
    "consulting engagement",
    "6 month contract",
    "12 month contract",
    "six month contract",
    "twelve month contract",
  ];

  const temporarySignals = [
    "temporary position",
    "temporary role",
    "temporary assignment",
    "temp position",
    "seasonal position",
  ];

  const internshipSignals = [
    "internship",
    "intern position",
    "intern opportunity",
  ];

  const directHireSignals = [
    "direct hire",
    "permanent position",
    "permanent role",
    "full-time employee",
    "full time employee",
  ];

  const staffingSignals = [
    "our client",
    "end client",
    "client is seeking",
    "client is looking",
    "staffing firm",
    "staffing agency",
    "recruiting firm",
    "recruitment firm",
    "talent solutions",
    "consulting firm",
  ];

  const hasNoC2C =
    hasAny(
      text,
      noC2CSignals
    );

  const hasExplicitC2C =
    hasAny(
      text,
      explicitC2CSignals
    );

  const hasExplicitW2 =
    hasAny(
      text,
      explicitW2Signals
    );

  const hasContractToHire =
    hasAny(
      text,
      contractToHireSignals
    );

  const hasContract =
    hasAny(
      text,
      contractSignals
    ) ||
    employmentType.includes(
      "contract"
    );

  const hasTemporary =
    hasAny(
      text,
      temporarySignals
    ) ||
    employmentType.includes(
      "temporary"
    );

  const hasInternship =
    hasAny(
      text,
      internshipSignals
    ) ||
    employmentType.includes(
      "intern"
    );

  const hasDirectHire =
    hasAny(
      text,
      directHireSignals
    ) ||
    employmentType.includes(
      "full-time"
    ) ||
    employmentType.includes(
      "full time"
    );

  const staffingVendorSignal =
    hasAny(
      text,
      staffingSignals
    ) ||
    company === "vaco";

  if (hasNoC2C) {
    c2cEvidence.push(
      "Posting explicitly restricts C2C/1099 or requires W2."
    );
  }

  if (hasExplicitC2C) {
    c2cEvidence.push(
      "Posting explicitly mentions C2C/corp-to-corp/1099."
    );
  }

  if (
    hasContract &&
    staffingVendorSignal
  ) {
    c2cEvidence.push(
      "Contract role appears to be handled through a staffing/vendor relationship."
    );
  }

  if (hasExplicitW2) {
    evidence.push(
      "Posting explicitly mentions W2 employment."
    );
  }

  if (hasContract) {
    evidence.push(
      "Contract language detected."
    );
  }

  if (hasContractToHire) {
    evidence.push(
      "Contract-to-hire language detected."
    );
  }

  if (staffingVendorSignal) {
    evidence.push(
      "Staffing/vendor/client language detected."
    );
  }

  let c2cProbability = 20;
  let c2cConfidence = 20;

  if (hasNoC2C) {
    c2cProbability = 0;
    c2cConfidence = 95;
  } else if (hasExplicitC2C) {
    c2cProbability = 95;
    c2cConfidence = 95;
  } else if (
    hasContract &&
    staffingVendorSignal
  ) {
    c2cProbability = 55;
    c2cConfidence = 55;
  } else if (hasContract) {
    c2cProbability = 35;
    c2cConfidence = 40;
  } else if (hasDirectHire) {
    c2cProbability = 5;
    c2cConfidence = 70;
  }

  let w2Probability = 30;

  if (hasExplicitW2) {
    w2Probability = 98;
  } else if (
    hasContract &&
    staffingVendorSignal
  ) {
    w2Probability = 75;
  } else if (hasDirectHire) {
    w2Probability = 95;
  } else if (hasContract) {
    w2Probability = 60;
  }

  let contractProbability = 10;

  if (hasContractToHire) {
    contractProbability = 100;
  } else if (hasContract) {
    contractProbability = 95;
  } else if (hasTemporary) {
    contractProbability = 85;
  } else if (hasDirectHire) {
    contractProbability = 5;
  }

  const contractToHireProbability =
    hasContractToHire
      ? 100
      : hasContract
        ? 20
        : 5;

  let employmentModel:
    EmploymentModel =
      "unknown";

  if (hasInternship) {
    employmentModel =
      "internship";
  } else if (
    hasContractToHire
  ) {
    employmentModel =
      "contract-to-hire";
  } else if (
    hasNoC2C &&
    hasExplicitW2 &&
    hasContract
  ) {
    employmentModel =
      "w2-contract";
  } else if (
    hasExplicitC2C
  ) {
    employmentModel =
      "c2c";
  } else if (
    hasTemporary
  ) {
    employmentModel =
      "temporary";
  } else if (
    hasContract
  ) {
    employmentModel =
      "mixed-contract";
  } else if (
    hasDirectHire
  ) {
    employmentModel =
      "direct-hire";
  }

  if (
    c2cEvidence.length === 0
  ) {
    c2cEvidence.push(
      "C2C is not explicitly addressed in the posting."
    );
  }

  return {
    employmentModel,

    c2cProbability,
    c2cConfidence,
    c2cEvidence,

    w2Probability,
    contractProbability,
    contractToHireProbability,

    staffingVendorSignal,

    evidence,
  };
}
