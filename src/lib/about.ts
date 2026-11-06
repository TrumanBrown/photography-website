/**
 * Everything the front door's Weekdays side says about me (src/pages/index.astro):
 * the resume, the three side projects and the links. The resume lines are
 * the ones on my PDF (public/Truman-Brown-Resume.pdf), with job titles in
 * sentence case to match the site. My phone number and personal email are
 * left out on purpose, here and in that PDF: the repo and the site are
 * public, so contact goes through "Write to me".
 */

export interface Job {
  org: string;
  where: string;
  role: string;
  /** What the team used to be called, shown after the place. */
  note?: string;
  /** "YYYY-MM". */
  from: string;
  /** "YYYY-MM", or null for the job I'm in now. */
  to: string | null;
  lines: string[];
}

export interface Project {
  name: string;
  /** The repository under github.com/TrumanBrown. */
  repo: string;
  lang: string;
  /** "YYYY-MM", when I started it. */
  since: string;
  blurb: string;
  /** Which live piece sits beside it on the page. */
  media: "site" | "video" | "radar";
}

/** The line under the Weekends tab, in my own words. */
export const WEEKENDS =
  "I try to keep the weekends busy and full of adventures. Typically, that's on a trail or the tides somewhere in the beautiful state of Washington. The other times, I'm building projects like this site.";

/** The line under the Weekdays tab, in my own words. */
export const WEEKDAYS =
  "During the week, I'm a product manager on Azure Local, Microsoft's distributed hybrid infrastructure solution. I own Azure Migrate for Azure Local, scaling the solution from near zero VM migrations in 2024 to over 47,000 VMs migrated today. I also own various features for Azure Local VM management.";

export const SUMMARY =
  "Product manager with 3+ years at Microsoft, owning migration and virtual machine features for Azure Local, its hybrid cloud platform. Scaled migration to 885 customers (57 Fortune 500 or Global 500) running 300,000+ cores.";

export const RESUME_PDF = "/Truman-Brown-Resume.pdf";

export const LINKS = [
  { label: "GitHub", href: "https://github.com/TrumanBrown" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/trumanbrown/" },
  {
    label: "iNaturalist",
    href: "https://www.inaturalist.org/people/trumanbrown",
  },
] as const;

export const WORK: Job[] = [
  {
    org: "Microsoft",
    where: "Redmond, WA",
    role: "Product manager II, Azure Local",
    note: "formerly Azure Stack HCI",
    from: "2025-09",
    to: null,
    lines: [
      "Grew VMware and Hyper-V migrations to Azure Local from 114 virtual machines (VMs) in Feb 2024 to 47,000+, making migration the source of 3 in 10 new customer Azure Local VMs since 2025",
      "Launched general availability of Azure Migrate for VMware to Azure Local migrations in Oct 2025, writing the exit criteria and a three-option proposal that avoided a 6-month wait, with 32,000+ VMs migrated since",
      "Cut customer-reported incidents nearly 40%, from 6.9 to 4.2 per 1,000 migrated VMs in 2026, with new validation checks, safeguards and retry fixes, while holding a 97.5% migration success rate",
      "Ran 18 monthly releases since Mar 2025 with no release manager, using AI agents to mock up features from approved UX assets for engineering, without a designer, and to write or update 25 Learn articles",
      "Shipped SAN migration support, unblocking a dental insurer that has moved 1,900+ of a planned 5,500 VMs",
      "Proposed and shipped Azure Arc reuse during migration, so Arc-managed VMs keep their configuration, monitoring and extensions with no re-onboarding, unblocking enterprises with hundreds to 10,000 Arc VMs",
      "Shipped Secure Boot retention (9,300+ VMs, 377 customers), PowerShell, CLI and Terraform automation (PowerShell alone moved 2,000 VMs for 15 customers) and migration support for Trusted Launch VMs",
      "Partnered with five enterprises (17,000+ cores) before, during and after migration, unblocking hundreds of SQL Server VMs with fast analysis, proposed fixes and release coordination, and gave 4 executive briefings",
      "Delivered a private preview of a new VMware migration path to six large enterprises two months after a third-party licensing change halted new migrations, leading the impact analysis, options and execution",
      "Shipped VM Connect console access for Azure Local VMs and designed live migration of VMs across clusters",
    ],
  },
  {
    org: "Microsoft",
    where: "Redmond, WA",
    role: "Product manager, Azure Local migration",
    from: "2024-02",
    to: "2025-09",
    lines: [
      "Onboarded 40 private preview customers and launched public preview in Oct 2024, with 73 customers migrating 1,700+ VMs at a 97% success rate, winning an organization Impact Award",
      "Shipped static IP retention for Windows and Linux VMs, used on 19,000+ VMs by 422 customers since release",
      "Unblocked a grocery chain's VMware exit with custom disk sector size, critical for SQL Server (1,150+ VMs)",
    ],
  },
  {
    org: "Microsoft",
    where: "Redmond, WA",
    role: "Product manager, Windows IoT",
    from: "2023-03",
    to: "2024-02",
    lines: [
      "Led Microsoft's side of bringing Windows 11 IoT Enterprise to Qualcomm's QCS6490 edge AI chip, now offered on QCS6490 boards from Advantech, Avalue, Avnet, Coretronic and Thundercomm",
      "Proposed, designed and led 3 of Microsoft's 8 hands-on labs at Embedded World 2024 for customers and OEMs",
    ],
  },
  {
    org: "Microsoft",
    where: "Redmond, WA",
    role: "Product manager intern, Azure Edge",
    from: "2022-05",
    to: "2022-08",
    lines: [
      "Compared three ways to run Kubernetes workloads on industrial edge devices, built the Azure proof of concept, and wrote requirements for a new provider in an internal edge orchestration platform that shipped on time",
    ],
  },
  {
    org: "IBM",
    where: "Minneapolis, MN",
    role: "Cloud transformation development architect co-op",
    from: "2021-06",
    to: "2021-12",
    lines: [
      "Led instrumentation of Cloud Databases on IBM Cloud Satellite, published as an IBM Developer code pattern",
    ],
  },
];

export const SCHOOL = {
  name: "University of Minnesota, Twin Cities",
  degree: "Bachelor of computer engineering",
  when: "2022-12",
  lines: [
    "GPA 3.95, Honors Program, Dean's List all eight semesters, Presidential and three Roger Nordby scholarships",
    "Volunteer emergency medical technician (EMT), University of Minnesota EMS, 2018 to 2022",
  ],
};

export const SKILLS: Array<[label: string, list: string]> = [
  [
    "Product and data",
    "Product strategy, roadmaps, go-to-market, customer discovery, Kusto (KQL), Power BI, Python",
  ],
  [
    "Platform and AI",
    "Azure, hybrid cloud, Kubernetes, virtualization, on-premises hardware, AI agents, MCP",
  ],
];

/** The three side projects pinned on my GitHub, in the order shown. */
export const PROJECTS: Project[] = [
  {
    name: "trumanbrown.com",
    repo: "photography-website",
    lang: "TypeScript",
    since: "2026-06",
    media: "site",
    blurb:
      "This site. Under the photographs, a pipeline drafts every caption, checks the species against my iNaturalist and plans the Instagram posts. Astro on Azure Static Web Apps, with Blob Storage, Functions, Bicep and keyless GitHub Actions deploys.",
  },
  {
    name: "cozy-vibe-vids",
    repo: "cozy-vibe-vids-public",
    lang: "Python",
    since: "2026-10",
    media: "video",
    blurb:
      "Ten-hour cozy ambience videos for YouTube. Each scene starts as one key-art image, and everything that moves in it, from the rain to the steam off the soup, is animated in code.",
  },
  {
    name: "balcFlights-LED",
    repo: "balcFlights-LED",
    lang: "Python",
    since: "2026-08",
    media: "radar",
    blurb:
      "The planes flying over Seattle, on a 64×64 LED panel run by a Raspberry Pi 4. It pulls from a friend's flight API for Seattle and draws a radar with the nearest plane's callsign, type and altitude. The panel here is the same radar, drawn live in your browser.",
  },
];

/** The cozy-vibe-vids upload shown beside it, played only when pressed. */
export const COZY_VIDEO = {
  youtubeId: "wBFn90W5qh4",
  title: "welcome home, critter. PNW friends in the rain",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2025-09" → "Sep 2025". */
export function monthLabel(ym: string): string {
  const [year, month] = ym.split("-");
  const name = MONTHS[Number(month) - 1];
  if (!name || !/^\d{4}$/.test(year ?? "")) {
    throw new Error(`Not a YYYY-MM month: ${ym}`);
  }
  return `${name} ${year}`;
}

/** A job's dates as the page shows them: "Since Sep 2025", "Feb 2024 to Sep 2025". */
export function periodLabel(from: string, to: string | null): string {
  return to
    ? `${monthLabel(from)} to ${monthLabel(to)}`
    : `Since ${monthLabel(from)}`;
}

/** The first year on the resume, for "5 roles since 2021". */
export function firstYear(jobs: readonly Job[]): number {
  return Math.min(...jobs.map((job) => Number(job.from.slice(0, 4))));
}
