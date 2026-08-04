export type RoleFamilyInput = {
  id: string;
  name: string;
  keywords: string[];
};

export type RoleMatch = {
  id: string;
  name: string;
  score: number;
  matchedKeywords: string[];
};

type RoleRule = {
  titleSignals: string[];
  jdSignals: string[];
};

const roleRules: Record<string, RoleRule> = {
  "IT Support & Technical Support": {
    titleSignals: [
      "it support",
      "technical support",
      "application support",
      "production support",
      "service desk",
      "help desk",
      "desktop support",
      "support engineer",
    ],
    jdSignals: [
      "troubleshooting",
      "ticket",
      "incident",
      "end user",
      "service desk",
      "help desk",
      "technical support",
      "application support",
      "production support",
      "root cause",
    ],
  },

  "Systems Administration & IT Operations": {
    titleSignals: [
      "systems administrator",
      "system administrator",
      "systems engineer",
      "it operations",
      "windows administrator",
      "linux administrator",
      "infrastructure engineer",
    ],
    jdSignals: [
      "active directory",
      "group policy",
      "windows server",
      "linux",
      "server administration",
      "system administration",
      "patching",
      "powershell",
      "vmware",
      "infrastructure operations",
    ],
  },

  "QA Testing & Validation": {
    titleSignals: [
      "qa analyst",
      "qa engineer",
      "quality assurance",
      "software tester",
      "test engineer",
      "test analyst",
      "validation analyst",
      "sdet",
    ],
    jdSignals: [
      "test case",
      "test cases",
      "regression testing",
      "defect",
      "bug tracking",
      "uat",
      "selenium",
      "cypress",
      "playwright",
      "test automation",
      "quality assurance",
    ],
  },

  "Database SQL & DBA": {
    titleSignals: [
      "database",
      "dba",
      "sql",
      "data management",
      "database management",
    ],
    jdSignals: [
      "sql",
      "database",
      "queries",
      "query",
      "stored procedure",
      "relational database",
      "schema",
      "database table",
      "data model",
      "database administration",
      "data migration",
      "etl",
      "data validation",
    ],
  },

  "Project Management PMO & Coordination": {
    titleSignals: [
      "project manager",
      "project coordinator",
      "program manager",
      "program coordinator",
      "pmo",
      "project analyst",
    ],
    jdSignals: [
      "project plan",
      "project schedule",
      "project budget",
      "project delivery",
      "milestones",
      "risk management",
      "status reporting",
      "vendor management",
      "cross-functional teams",
      "project stakeholders",
    ],
  },

  "Business Systems & Functional Analysis": {
    titleSignals: [
      "business analyst",
      "systems analyst",
      "business systems analyst",
      "application analyst",
      "functional analyst",
      "functional consultant",
    ],
    jdSignals: [
      "requirements gathering",
      "business requirements",
      "functional requirements",
      "business process",
      "process improvement",
      "workflow",
      "user stories",
      "gap analysis",
      "stakeholder requirements",
      "business systems",
    ],
  },

  "Data BI Analytics & Reporting": {
  titleSignals: [
    "data analyst",
    "bi analyst",
    "business intelligence",
    "reporting analyst",
    "analytics analyst",
    "data engineer",
    "machine learning engineer",
    "ml engineer",
  ],
  jdSignals: [
    "data analysis",
    "reporting",
    "reports",
    "dashboard",
    "power bi",
    "tableau",
    "analytics",
    "visualization",
    "metrics",
    "kpi",
    "excel",
    "business intelligence",
    "machine learning",
    "ml models",
    "model training",
    "feature engineering",
  ],
},
"Cloud DevOps & Platform": {
  titleSignals: [
    "cloud engineer",
    "cloud administrator",
    "devops",
    "platform engineer",
    "site reliability engineer",
    "site reliability operations analyst",
    "reliability engineer",
    "incident management engineer",
    "sre",
  ],
  jdSignals: [
    "aws",
    "azure",
    "kubernetes",
    "docker",
    "terraform",
    "ci/cd",
    "cloud infrastructure",
    "devops",
    "infrastructure as code",
    "containerization",
    "site reliability",
    "reliability engineering",
    "observability",
    "on-call",
    "incident management",
    "linux",
    "distributed systems",
  ],
},

  "Cybersecurity": {
  titleSignals: [
    "security analyst",
    "cybersecurity",
    "soc analyst",
    "iam analyst",
    "security engineer",
    "incident response engineer",
    "detection engineer",
    "detection & mitigation engineer",
    "mitigation engineer",
    "privacy engineer",
  ],
  jdSignals: [
    "siem",
    "identity and access",
    "iam",
    "vulnerability",
    "security operations",
    "incident response",
    "splunk",
    "sentinel",
    "crowdstrike",
    "security controls",
    "threat detection",
    "threat mitigation",
    "security incident",
    "phishing",
    "privacy engineering",
  ],
},
"Implementation & Technical Consulting": {
  titleSignals: [
    "implementation",
    "implementation engineer",
    "implementation consultant",
    "technical consultant",
    "technical consulting",
    "solutions consultant",
    "solution consultant",
    "application consultant",
    "customer engineer",
    "solutions engineer",
    "solution engineer",
    "solutions architect",
    "solution architect",
    "sales engineer",
    "professional services engineer",
    "technical account manager",
    "technical solutions engineer",
    "customer solutions engineer",
     "forward deployed engineer",
  "forward deployed enablement engineer",
  "forward deployed reliability engineer",
  "field engineer",
  ],
  jdSignals: [
    "implementation",
    "go-live",
    "go live",
    "configuration",
    "client onboarding",
    "customer onboarding",
    "deployment",
    "system integration",
    "solution design",
    "customer implementation",
    "technical discovery",
    "technical requirements",
    "proof of concept",
    "proof-of-concept",
    "customer architecture",
    "customer requirements",
    "technical presentation",
    "technical demonstration",
    "technical enablement",
    "professional services",
    "customer deployment",
    "solution architecture",
  ],
},

  "Networking & Infrastructure": {
    titleSignals: [
      "network engineer",
      "network administrator",
      "network analyst",
      "network operations",
      "network support",
      "noc",
    ],
    jdSignals: [
      "routing",
      "switching",
      "firewall",
      "vlan",
      "dns",
      "dhcp",
      "cisco",
      "fortinet",
      "tcp/ip",
      "bgp",
      "ospf",
      "network troubleshooting",
    ],
  },

  "Software Development": {
    titleSignals: [
      "software engineer",
      "software developer",
      "application developer",
      "backend developer",
      "frontend developer",
      "full stack developer",
    ],
    jdSignals: [
      "software development",
      "application development",
      "coding",
      "api development",
      "java",
      "javascript",
      "react",
      "node.js",
      "spring boot",
      "unit testing",
    ],
  },

  "Data Center Infrastructure Controls & Commissioning": {
    titleSignals: [
      "data center",
      "datacenter",
      "critical facilities",
      "critical operations",
      "controls engineer",
      "controls technician",
      "commissioning",
    ],
    jdSignals: [
      "data center",
      "critical facilities",
      "bms",
      "epms",
      "ups",
      "pdu",
      "automatic transfer switch",
      "bacnet",
      "modbus",
      "commissioning",
      "building automation",
      "hvac controls",
      "electrical distribution",
    ],
  },

  "Product Management & Product Operations": {
    titleSignals: [
      "product manager",
      "product owner",
      "product operations",
      "technical product manager",
      "technical product owner",
      "product analyst",
    ],
    jdSignals: [
      "product roadmap",
      "product strategy",
      "product requirements",
      "product backlog",
      "product lifecycle",
      "go-to-market",
      "user research",
      "product prioritization",
      "product owner",
      "product vision",
    ],
  },
};

const domainMap: Record<string, string[]> = {
  Healthcare: [
    "healthcare",
    "health care",
    "health plan",
    "clinical",
    "patient care",
    "medical",
    "hospital",
    "electronic health record",
    "ehr",
  ],

  Insurance: [
    "insurance",
    "underwriting",
    "policyholder",
    "insurance policy",
    "claims processing",
    "premium",
    "health insurance",
    "insurance carrier",
  ],

  "Actuarial & Pricing": [
    "actuarial",
    "actuary",
    "actuarial pricing",
    "rate table",
    "rating model",
    "premium pricing",
    "underwriting pricing",
  ],

  Banking: [
    "banking",
    "financial services",
    "payments infrastructure",
    "payment processing",
    "credit card",
    "consumer lending",
    "commercial lending",
    "mortgage",
    "fintech",
  ],

  Retail: [
    "retail",
    "point of sale",
    "pos system",
    "merchandising",
    "retail operations",
    "store operations",
  ],

  "Data Center": [
    "data center",
    "datacenter",
    "critical facilities",
    "critical environment",
    "building management system",
    "electrical power monitoring system",
    "bms",
    "epms",
  ],

  SaaS: [
    "saas",
    "software as a service",
    "cloud application",
    "cloud platform",
  ],

  Manufacturing: [
    "manufacturing",
    "manufacturing plant",
    "factory automation",
    "industrial automation",
    "production line",
  ],

  "Supply Chain": [
    "supply chain",
    "procurement",
    "logistics",
    "warehouse management",
    "distribution center",
  ],

  "Human Resources / HCM": [
    "human capital management",
    "hcm",
    "human resources information system",
    "hris",
    "hrms",
    "payroll system",
  ],
};

const toolMap: Record<string, string[]> = {
  SQL: ["sql"],
  "SQL Server": ["sql server"],
  PostgreSQL: ["postgresql", "postgres"],
  MySQL: ["mysql"],
  Oracle: ["oracle database", "oracle db"],
  Snowflake: ["snowflake"],
  "Power BI": ["power bi"],
  Tableau: ["tableau"],
  Excel: ["microsoft excel", "excel"],
  Python: ["python"],
  Java: ["java"],
  Azure: ["microsoft azure", "azure"],
  AWS: ["amazon web services", "aws"],
  ServiceNow: ["servicenow"],
  Jira: ["jira"],
  Selenium: ["selenium"],
  Cypress: ["cypress"],
  Playwright: ["playwright"],
  "Active Directory": ["active directory"],
  "Windows Server": ["windows server"],
  Linux: ["linux"],
  SSIS: ["ssis"],
  SSRS: ["ssrs"],
  ETL: ["etl"],
  Git: ["git"],
  Docker: ["docker"],
  Kubernetes: ["kubernetes"],
  BACnet: ["bacnet"],
  Modbus: ["modbus"],
  BMS: ["bms", "building management system"],
  EPMS: ["epms", "electrical power monitoring system"],
  PLC: ["plc"],
  SCADA: ["scada"],
};

const trainingSignals = [
  "training provided",
  "on the job training",
  "on-the-job training",
  "structured training",
  "mentorship",
  "onboarding program",
  "rotational program",
  "career development",
  "willing to train",
  "entry level",
  "early career",
  "junior",
  "level i",
  "level 1",
  "equivalent experience",
  "transferable skills",
];

const transitionSignals = [
  "junior",
  "entry level",
  "early career",
  "equivalent experience",
  "transferable skills",
  "willing to learn",
  "willing to train",
  "preferred but not required",
  "nice to have",
  "mentorship",
];

function cleanText(value?: string | null) {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contains(text: string, keyword: string) {
  const normalizedKeyword = keyword.toLowerCase().trim();

  if (!normalizedKeyword) return false;

  if (
    normalizedKeyword.includes(" ") ||
    normalizedKeyword.includes("-") ||
    normalizedKeyword.includes("/") ||
    normalizedKeyword.includes(".")
  ) {
    return text.toLowerCase().includes(normalizedKeyword);
  }

  const pattern = new RegExp(
    `\\b${escapeRegex(normalizedKeyword)}\\b`,
    "i"
  );

  return pattern.test(text);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function detectDomains(text: string) {
  const matches: string[] = [];

  for (const [domain, keywords] of Object.entries(domainMap)) {
    if (keywords.some((keyword) => contains(text, keyword))) {
      matches.push(domain);
    }
  }

  return matches;
}

function detectTools(text: string) {
  const tools: string[] = [];

  for (const [tool, aliases] of Object.entries(toolMap)) {
    if (aliases.some((alias) => contains(text, alias))) {
      tools.push(tool);
    }
  }

  return unique(tools);
}

function detectContextualProprietaryTerms(text: string) {
  const ignored = new Set([
    "USA",
    "EEO",
    "EEOC",
    "USD",
    "HR",
    "IT",
    "QA",
    "SQL",
    "AWS",
    "API",
    "CEO",
    "CTO",
    "LLC",
    "B2B",
    "B2C",
    "NYC",
    "PTO",
    "CAC",
    "ROI",
    "SMS",
    "NOT",
  ]);

  const results: string[] = [];
  const regex = /\b[A-Z][A-Z0-9_-]{2,11}\b/g;

  for (const match of text.matchAll(regex)) {
    const token = match[0];

    if (ignored.has(token)) continue;

    const index = match.index ?? 0;

    const context = text
      .slice(
        Math.max(0, index - 70),
        Math.min(text.length, index + token.length + 70)
      )
      .toLowerCase();

    const hasToolContext =
      /\b(tool|platform|system|application|software|using|used|experience with|proficiency in|knowledge of)\b/.test(
        context
      );

    if (hasToolContext) {
      results.push(token);
    }
  }

  return unique(results);
}

function detectWorkArrangement(
  text: string,
  existing?: string | null
) {
  const value = `${existing ?? ""} ${text}`.toLowerCase();

  if (value.includes("hybrid")) {
    return "hybrid";
  }

  if (
    value.includes("remote") ||
    value.includes("work from home") ||
    value.includes("work-from-home") ||
    value.includes("wfh")
  ) {
    return "remote";
  }

  if (
    value.includes("on-site") ||
    value.includes("onsite") ||
    value.includes("in office") ||
    value.includes("office-based")
  ) {
    return "onsite";
  }

  return "unknown";
}

function calculateTrainingScore(text: string) {
  let score = 0;

  for (const signal of trainingSignals) {
    if (contains(text, signal)) {
      score += 15;
    }
  }

  if (
    /\b0\s*[-–]\s*2\s+years?\b/i.test(text) ||
    /\b1\s*[-–]\s*2\s+years?\b/i.test(text)
  ) {
    score += 20;
  }

  return Math.min(score, 100);
}

function calculateTransitionScore(text: string) {
  let score = 0;

  for (const signal of transitionSignals) {
    if (contains(text, signal)) {
      score += 15;
    }
  }

  if (
    /\b0\s*[-–]\s*2\s+years?\b/i.test(text) ||
    /\b1\s*[-–]\s*2\s+years?\b/i.test(text)
  ) {
    score += 20;
  }

  return Math.min(score, 100);
}

function freshnessScore(date?: string | Date | null) {
  if (!date) return 50;

  const posted = new Date(date);

  if (Number.isNaN(posted.getTime())) {
    return 50;
  }

  const days =
    (Date.now() - posted.getTime()) /
    (1000 * 60 * 60 * 24);

  if (days <= 1) return 100;
  if (days <= 3) return 95;
  if (days <= 7) return 85;
  if (days <= 14) return 70;
  if (days <= 30) return 55;

  return 35;
}

export function classifyJob(args: {
  title: string;
  description?: string | null;
  remoteType?: string | null;
  postedAt?: string | Date | null;
  discoveredAt?: string | Date | null;
  roleFamilies: RoleFamilyInput[];
}) {
  const title = cleanText(args.title);
  const description = cleanText(args.description);
  const fullText = `${title} ${description}`;

  const roleMatches: RoleMatch[] = [];

  for (const family of args.roleFamilies) {
    if (family.name === "Career Transition & Training Friendly") {
      continue;
    }

    const rule = roleRules[family.name];

    let points = 0;
    let titleEvidence = 0;

    const titleMatches: string[] = [];
    const jdMatches: string[] = [];

    for (const keyword of family.keywords ?? []) {
      if (contains(title, keyword)) {
        points += 40;
        titleEvidence++;
        titleMatches.push(keyword);
      } else if (contains(description, keyword)) {
        points += 7;
        jdMatches.push(keyword);
      }
    }

    if (rule) {
      for (const signal of rule.titleSignals) {
        if (contains(title, signal)) {
          points += 30;
          titleEvidence++;
          titleMatches.push(signal);
        }
      }

      for (const signal of rule.jdSignals) {
        if (contains(description, signal)) {
          points += 7;
          jdMatches.push(signal);
        }
      }
    }

    const uniqueTitleMatches = unique(titleMatches);
    const uniqueJdMatches = unique(jdMatches);

    const enoughEvidence =
      titleEvidence > 0 ||
      uniqueJdMatches.length >= 3;

    if (enoughEvidence && points >= 20) {
      roleMatches.push({
        id: family.id,
        name: family.name,
        score: Math.min(points, 100),
        matchedKeywords: unique([
          ...uniqueTitleMatches,
          ...uniqueJdMatches,
        ]),
      });
    }
  }

  roleMatches.sort((a, b) => b.score - a.score);

  const primaryRoleFamily =
    roleMatches[0]?.name ?? "Unclassified";

  const classificationConfidence =
    roleMatches[0]?.score ?? 0;

  const domainTags = detectDomains(fullText);

  const knownTools = detectTools(fullText);

  const proprietaryTools =
    detectContextualProprietaryTerms(fullText);

  const extractedTools = unique([
    ...knownTools,
    ...proprietaryTools,
  ]);

  const workArrangement = detectWorkArrangement(
    fullText,
    args.remoteType
  );

  const remoteScore =
    workArrangement === "remote"
      ? 100
      : workArrangement === "hybrid"
        ? 60
        : workArrangement === "onsite"
          ? 0
          : 30;

  const trainingLikelihood =
    calculateTrainingScore(fullText);

  const transitionFriendliness =
    calculateTransitionScore(fullText);

  const trainingEvidence = trainingSignals.filter(
    (signal) => contains(fullText, signal)
  );

  const transitionEvidence = transitionSignals.filter(
    (signal) => contains(fullText, signal)
  );

  const jobFreshnessScore = freshnessScore(
    args.postedAt ?? args.discoveredAt
  );

  return {
    primaryRoleFamily,
    classificationConfidence,
    roleMatches,

    domainTags,
    extractedTools,

    workArrangement,
    remoteScore,

    trainingLikelihood,
    transitionFriendliness,

    trainingEvidence,
    transitionEvidence,

    jobFreshnessScore,
  };
}
