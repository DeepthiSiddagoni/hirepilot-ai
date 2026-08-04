export type GreenhouseJob = {
  id: number;
  title: string;
  updated_at: string;
  absolute_url: string;
  location?: {
    name?: string;
  };
  content?: string;
};

export async function fetchGreenhouseJobs(boardToken: string) {
  const url =
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
      boardToken
    )}/jobs?content=true`;

  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Greenhouse request failed with status ${response.status}`
    );
  }

  const data = await response.json();

  return (data.jobs ?? []) as GreenhouseJob[];
}