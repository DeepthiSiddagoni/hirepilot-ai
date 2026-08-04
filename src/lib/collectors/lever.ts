export type LeverJob = {
  id: string;
  text: string;

  categories?: {
    location?: string;
    commitment?: string;
    team?: string;
    department?: string;
  };

  description?: string;
  descriptionPlain?: string;

  additional?: string;
  additionalPlain?: string;

  hostedUrl?: string;
  applyUrl?: string;

  workplaceType?: "remote" | "hybrid" | "onsite" | "unspecified";

  createdAt?: number;

  lists?: Array<{
    text?: string;
    content?: string;
  }>;

  salaryRange?: {
    min?: number;
    max?: number;
    currency?: string;
    interval?: string;
  };
};

export async function fetchLeverJobs(siteKey: string) {
  const url =
    `https://api.lever.co/v0/postings/${encodeURIComponent(siteKey)}?mode=json`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Lever request failed with status ${response.status}`
    );
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Lever returned an unexpected response");
  }

  return data as LeverJob[];
}