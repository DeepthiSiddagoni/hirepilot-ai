"use client";

import { useEffect, useState } from "react";

type Job = {
  id: string;
  title: string;
  company_name: string;
  location: string | null;

  remote_type: string | null;
  employment_type: string | null;
  contract_type: string | null;

  job_url: string | null;

  sponsorship_status: string | null;
  h1b_supported: boolean | null;
  opt_supported: boolean | null;
  stem_opt_supported: boolean | null;
  cpt_supported: boolean | null;

  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;

  match_score: number | null;

  primary_role_family: string | null;
  classification_confidence: number | null;
};

function formatSalary(job: Job) {
  if (!job.salary_min && !job.salary_max) {
    return "Salary not listed";
  }

  const currency = job.salary_currency ?? "USD";

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });

  if (job.salary_min && job.salary_max) {
    return `${formatter.format(job.salary_min)} - ${formatter.format(
      job.salary_max
    )}`;
  }

  if (job.salary_min) {
    return `From ${formatter.format(job.salary_min)}`;
  }

  return `Up to ${formatter.format(job.salary_max ?? 0)}`;
}

function getVisaLabel(job: Job) {
  if (job.h1b_supported) {
    return "H-1B Signal";
  }

  if (job.stem_opt_supported) {
    return "STEM OPT";
  }

  if (job.opt_supported) {
    return "OPT";
  }

  if (job.cpt_supported) {
    return "CPT";
  }

  if (job.sponsorship_status) {
    return job.sponsorship_status;
  }

  return "Visa Unknown";
}
export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [totalJobs, setTotalJobs] = useState(0);
  const [h1bJobs, setH1bJobs] = useState(0);
const [contractJobs, setContractJobs] = useState(0);
const [highMatches, setHighMatches] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [visaFilter, setVisaFilter] = useState("");
  const [employmentFilter, setEmploymentFilter] = useState("");
    async function loadJobs() {
  try {
    setLoading(true);
    setError("");

    const params = new URLSearchParams();

    params.set("limit", "50");

    if (keyword.trim()) {
      params.set("q", keyword.trim());
    }

    if (locationFilter.trim()) {
      params.set("location", locationFilter.trim());
    }

    if (visaFilter === "h1b") {
      params.set("h1b", "true");
    }

    if (visaFilter === "stemOpt") {
      params.set("stemOpt", "true");
    }

    if (visaFilter === "opt") {
      params.set("opt", "true");
    }

    if (visaFilter === "cpt") {
      params.set("cpt", "true");
    }

    if (employmentFilter === "full-time") {
      params.set("employmentType", "full-time");
    }

    if (employmentFilter === "contract") {
      params.set("employmentType", "contract");
    }

    if (employmentFilter === "contract-to-hire") {
      params.set("contractType", "contract-to-hire");
    }

    if (employmentFilter === "c2c") {
      params.set("c2c", "true");
    }

    const response = await fetch(
      `/api/jobs?${params.toString()}`
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        data.error ?? "Unable to load jobs"
      );
    }

    setJobs(data.jobs);

    setTotalJobs(
      data.pagination?.totalMatching ?? data.jobs.length
    );

    setH1bJobs(
      data.stats?.h1bFriendly ?? 0
    );

    setContractJobs(
      data.stats?.contractJobs ?? 0
    );

    setHighMatches(
      data.stats?.highMatches ?? 0
    );
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "Unable to load jobs"
    );
  } finally {
    setLoading(false);
  }
}

useEffect(() => {
  loadJobs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen">

        {/* Sidebar */}
        <aside className="hidden w-64 border-r border-slate-800 bg-slate-900 p-6 md:block">
          <div className="mb-10">
            <h1 className="text-2xl font-bold text-blue-400">
              HirePilot AI
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              Visa-aware job search agent
            </p>
          </div>

          <nav className="space-y-3">
            <button className="w-full rounded-lg bg-blue-600 px-4 py-3 text-left">
              Dashboard
            </button>

            <button className="w-full rounded-lg px-4 py-3 text-left text-slate-300 hover:bg-slate-800">
              Find Jobs
            </button>

            <button className="w-full rounded-lg px-4 py-3 text-left text-slate-300 hover:bg-slate-800">
              H-1B Sponsors
            </button>

            <button className="w-full rounded-lg px-4 py-3 text-left text-slate-300 hover:bg-slate-800">
              Contract / C2C
            </button>

            <button className="w-full rounded-lg px-4 py-3 text-left text-slate-300 hover:bg-slate-800">
              Saved Jobs
            </button>

            <button className="w-full rounded-lg px-4 py-3 text-left text-slate-300 hover:bg-slate-800">
              Applications
            </button>

            <button className="w-full rounded-lg px-4 py-3 text-left text-slate-300 hover:bg-slate-800">
              My Resume
            </button>
          </nav>
        </aside>

        {/* Main Dashboard */}
        <section className="flex-1 p-6 md:p-10">
          <div className="mx-auto max-w-7xl">

            {/* Header */}
            <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-sm text-blue-400">
                  AI JOB SEARCH AGENT
                </p>

                <h2 className="mt-1 text-3xl font-bold">
                  Find jobs that actually fit your visa
                </h2>

                <p className="mt-2 text-slate-400">
                  Search jobs, analyze sponsorship, detect contract
                  opportunities and rank your best matches.
                </p>
              </div>

              <button className="rounded-lg bg-blue-600 px-6 py-3 font-semibold hover:bg-blue-500">
                Search New Jobs
              </button>
            </div>

         {/* Search */}
<div className="mb-8 rounded-xl border border-slate-800 bg-slate-900 p-5">
  <div className="grid gap-3 md:grid-cols-5">

    <input
      value={keyword}
      onChange={(e) => setKeyword(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          loadJobs();
        }
      }}
      placeholder="Job title or skill"
      className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
    />

    <input
      value={locationFilter}
      onChange={(e) => setLocationFilter(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          loadJobs();
        }
      }}
      placeholder="Location"
      className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
    />

    <select
      value={visaFilter}
      onChange={(e) => setVisaFilter(e.target.value)}
      className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-3"
    >
      <option value="">All Visa Options</option>
      <option value="h1b">H-1B Sponsorship</option>
      <option value="stemOpt">STEM OPT</option>
      <option value="opt">OPT</option>
      <option value="cpt">CPT</option>
    </select>

    <select
      value={employmentFilter}
      onChange={(e) => setEmploymentFilter(e.target.value)}
      className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-3"
    >
      <option value="">All Employment Types</option>
      <option value="full-time">Full-Time</option>
      <option value="contract">Contract</option>
      <option value="contract-to-hire">
        Contract-to-Hire
      </option>
      <option value="c2c">C2C</option>
    </select>

    <button
      onClick={loadJobs}
      disabled={loading}
      className="rounded-lg bg-blue-600 px-5 py-3 font-medium hover:bg-blue-500 disabled:opacity-50"
    >
      {loading ? "Searching..." : "Search Jobs"}
    </button>

  </div>
</div>

            {/* Stats */}
            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

              <Stat
                title="Jobs Found"
                value={totalJobs.toLocaleString()}
                subtitle="Across all sources"
              />

              <Stat
                title="H-1B Friendly"
                value={h1bJobs.toLocaleString()}
                subtitle="Sponsor history found"
              />

              <Stat
                title="Contract Jobs"
                value={contractJobs.toLocaleString()}
                subtitle="W2 / C2C opportunities"
              />

              <Stat
                title="90%+ Matches"
                value={highMatches.toLocaleString()}
                subtitle="High resume match"
              />

            </div>

            {/* Jobs */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold">
                    Best Opportunities
                  </h3>

                  <p className="text-sm text-slate-400">
                    Ranked by resume match, sponsorship and job quality
                  </p>
                </div>

                <button className="text-sm text-blue-400">
                  View all →
                </button>
              </div>

              <div className="space-y-4">
              
                  {loading && (
  <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-400">
    Loading real jobs...
  </div>
)}

{error && (
  <div className="rounded-xl border border-red-900 bg-red-950/30 p-6 text-red-300">
    {error}
  </div>
)}

{!loading && !error && jobs.length === 0 && (
  <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-400">
    No jobs found.
  </div>
)}

{jobs.map((job) => (
  <div
    key={job.id}
    className="rounded-xl border border-slate-800 bg-slate-900 p-5 transition hover:border-blue-600"
  >
    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">

          <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-400">
            {getVisaLabel(job)}
          </span>

          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
            {job.employment_type ?? "Employment type unknown"}
          </span>

          {job.remote_type && (
            <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
              {job.remote_type}
            </span>
          )}

        </div>

        <h4 className="text-lg font-semibold">
          {job.title}
        </h4>

        <p className="mt-1 text-slate-300">
          {job.company_name}
        </p>

        <p className="mt-2 text-sm text-slate-400">
          {job.location ?? "Location not listed"} • {formatSalary(job)}
        </p>

        {job.primary_role_family && (
          <p className="mt-2 text-xs text-slate-500">
            {job.primary_role_family}
          </p>
        )}
      </div>

      <div className="flex items-center gap-5">

        <div className="text-center">
          <div className="text-2xl font-bold text-green-400">
            {job.match_score ?? 0}%
          </div>

          <div className="text-xs text-slate-400">
            HirePilot Match
          </div>
        </div>

        <button className="rounded-lg border border-slate-700 px-4 py-2 hover:bg-slate-800">
          Save
        </button>

        {job.job_url ? (
          <a
            href={job.job_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-blue-600 px-5 py-2 font-medium hover:bg-blue-500"
          >
            View Job
          </a>
        ) : (
          <button
            disabled
            className="cursor-not-allowed rounded-lg bg-slate-700 px-5 py-2 font-medium text-slate-400"
          >
            View Job
          </button>
        )}

      </div>
    </div>
  </div>
))}
              </div>
            </div>

          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}