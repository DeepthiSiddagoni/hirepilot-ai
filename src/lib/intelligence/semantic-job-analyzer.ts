import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SemanticJobSchema = z.object({
  semanticSummary: z.string(),

  primaryRoleFamily: z.string(),

  relatedRoles: z.array(
    z.object({
      roleFamily: z.string(),
      score: z.number().min(0).max(100),
      reason: z.string(),
    })
  ),

  adjacentRoleTitles: z.array(z.string()),

  roleDomains: z.array(z.string()),

  responsibilities: z.array(z.string()),

  requiredSkills: z.array(z.string()),

  preferredSkills: z.array(z.string()),

  toolsAndTechnologies: z.array(z.string()),

  transferableSkills: z.array(z.string()),

  seniorityLevel: z.enum([
    "entry",
    "associate",
    "mid",
    "senior",
    "lead",
    "manager",
    "director",
    "executive",
    "unknown",
  ]),

  yearsExperienceMin: z.number().nullable(),

  yearsExperienceMax: z.number().nullable(),

  workArrangement: z.enum([
    "remote",
    "hybrid",
    "onsite",
    "unknown",
  ]),

  employmentTypes: z.array(
    z.enum([
      "full-time",
      "part-time",
      "contract",
      "w2-contract",
      "c2c",
      "contract-to-hire",
      "temporary",
      "internship",
      "unknown",
    ])
  ),

  trainingSignals: z.array(z.string()),

  trainingLikelihood: z.number().min(0).max(100),

  transitionFriendliness: z.number().min(0).max(100),

  visaLanguage: z.array(z.string()),

  sponsorshipPostingSignal: z.enum([
    "explicitly-supported",
    "explicitly-not-supported",
    "ambiguous",
    "not-mentioned",
  ]),

  requiredKeywords: z.array(z.string()),

  preferredKeywords: z.array(z.string()),

  confidence: z.number().min(0).max(100),
});

export type SemanticJobAnalysis =
  z.infer<typeof SemanticJobSchema>;

export async function analyzeJobSemantically(args: {
  title: string;
  company: string;
  description: string;
  location?: string | null;
  employmentType?: string | null;
  knownRoleFamilies: string[];
}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const description =
    args.description.length > 30000
      ? args.description.slice(0, 30000)
      : args.description;

  const roleFamilies = args.knownRoleFamilies.join("\n- ");

  const response = await client.responses.parse({
    model: "gpt-5-mini",

    reasoning: {
      effort: "low",
    },

    input: [
      {
        role: "system",
        content: `
You are HirePilot's job-intelligence engine.

Analyze the ACTUAL meaning of a job posting, not just its title.

Important rules:

1. Classify using title + responsibilities + tools + skills + business context.
2. A job may match multiple role families.
3. Do not force every job into a technical family.
4. Do not invent requirements that are absent from the posting.
5. Distinguish REQUIRED qualifications from PREFERRED qualifications.
6. Distinguish software/tools from generic acronyms.
7. Infer adjacent searchable job titles based on the actual work.
8. Training likelihood is only an estimate from evidence in the posting.
9. Career-transition friendliness means a candidate with related transferable
   skills could plausibly transition into the role.
10. Visa wording must represent ONLY what the posting actually says.
11. If sponsorship is not mentioned, use "not-mentioned". Do not infer
    company sponsorship probability here.
12. Employer sponsorship history will be analyzed separately later.
13. Do not treat company boilerplate as the role's primary business domain
    unless it materially relates to the job responsibilities.
14. Confidence must reflect the strength of evidence in the posting.

Known HirePilot role families:
- ${roleFamilies}
`,
      },

      {
        role: "user",
        content: `
COMPANY:
${args.company}

JOB TITLE:
${args.title}

LOCATION:
${args.location ?? "Not provided"}

EMPLOYMENT TYPE:
${args.employmentType ?? "Not provided"}

FULL JOB DESCRIPTION:
${description}
`,
      },
    ],

    text: {
      format: zodTextFormat(
        SemanticJobSchema,
        "hirepilot_job_analysis"
      ),
    },
  });

  if (!response.output_parsed) {
    throw new Error(
      "Semantic analyzer returned no structured result"
    );
  }

  return response.output_parsed;
}