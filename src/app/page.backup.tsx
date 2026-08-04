const jobs = [
  {
    company: "Microsoft",
    role: "Data Engineer",
    location: "Remote / USA",
    match: 96,
    visa: "H-1B Friendly",
    type: "Full-Time",
    salary: "$120K - $155K",
  },
  {
    company: "Amazon",
    role: "Systems Engineer",
    location: "Atlanta, GA",
    match: 93,
    visa: "Sponsor History",
    type: "Full-Time",
    salary: "$110K - $145K",
  },
  {
    company: "Insight Global",
    role: "SQL / Data Analyst",
    location: "Dallas, TX",
    match: 91,
    visa: "Contract Eligible",
    type: "Contract",
    salary: "$55 - $70/hr",
  },
  {
    company: "Oracle",
    role: "Cloud Infrastructure Engineer",
    location: "Austin, TX",
    match: 89,
    visa: "H-1B Friendly",
    type: "Full-Time",
    salary: "$115K - $150K",
  },
];

export default function Home() {
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
              <div className="grid gap-3 md:grid-cols-4">
                <input
                  placeholder="Job title or skill"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
                />

                <input
                  placeholder="Location"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
                />

                <select className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-3">
                  <option>H-1B Sponsorship</option>
                  <option>STEM OPT</option>
                  <option>CPT</option>
                  <option>No Sponsorship Needed</option>
                </select>

                <select className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-3">
                  <option>All Employment Types</option>
                  <option>Full-Time</option>
                  <option>Contract</option>
                  <option>Contract-to-Hire</option>
                  <option>C2C</option>
                </select>
              </div>
            </div>

            {/* Stats */}
            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

              <Stat
                title="Jobs Found"
                value="1,248"
                subtitle="Across all sources"
              />

              <Stat
                title="H-1B Friendly"
                value="327"
                subtitle="Sponsor history found"
              />

              <Stat
                title="Contract Jobs"
                value="186"
                subtitle="W2 / C2C opportunities"
              />

              <Stat
                title="90%+ Matches"
                value="42"
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
                {jobs.map((job) => (
                  <div
                    key={`${job.company}-${job.role}`}
                    className="rounded-xl border border-slate-800 bg-slate-900 p-5 transition hover:border-blue-600"
                  >
                    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">

                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-400">
                            {job.visa}
                          </span>

                          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                            {job.type}
                          </span>
                        </div>

                        <h4 className="text-lg font-semibold">
                          {job.role}
                        </h4>

                        <p className="mt-1 text-slate-300">
                          {job.company}
                        </p>

                        <p className="mt-2 text-sm text-slate-400">
                          {job.location} • {job.salary}
                        </p>
                      </div>

                      <div className="flex items-center gap-5">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-400">
                            {job.match}%
                          </div>

                          <div className="text-xs text-slate-400">
                            AI Match
                          </div>
                        </div>

                        <button className="rounded-lg border border-slate-700 px-4 py-2 hover:bg-slate-800">
                          Save
                        </button>

                        <button className="rounded-lg bg-blue-600 px-5 py-2 font-medium hover:bg-blue-500">
                          View Job
                        </button>
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