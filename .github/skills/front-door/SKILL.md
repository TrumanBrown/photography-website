---
name: front-door
description: 'The front door at / and About me: the Weekends and Weekdays switch (src/pages/index.astro), my rail with the Everest photo (src/components/about/MeRail.astro), the resume (src/lib/about.ts, Resume.astro, public/Truman-Brown-Resume.pdf), the three side projects and their live pieces (Projects.astro, the LED flight radar in src/lib/radar.ts and led-radar.ts, the cozy-vibe-vids video), the page change into /photographs/ with the lead photo handed over, and "Write to me". Use when: updating the resume, a job, the summary or the PDF; adding, removing or reordering a side project; changing the Weekends or Weekdays lines; the switch is missed or misbehaves; the radar is blank, says NO DATA or draws wrong; changing the portrait; links to About me or /#weekdays break; or moving between the front door and the archive looks wrong.'
---

# The front door and About me

`/` is the front door. It has the archive's frame (a 212px rail and a main column) with me in the rail instead of the sessions, and one switch at the top between **Weekends** (the lead photo, then rows into Photographs and Things to try) and **Weekdays** (the resume and the side projects). The archive itself is `/photographs/`. The full write-up is in [docs/product-experience.md](../../../docs/product-experience.md#a-front-door-with-me-in-it-november-2026). The mocks it came from are `mocks/portfolio/` ([design-mocks](../design-mocks/SKILL.md)).

| Path                                                          | What's there                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/pages/index.astro`                                       | the switch, both sides, the person structured data, the script that reads `#weekdays`                                                                                    |
| `src/components/about/MeRail.astro`                           | the rail: name, nav, the portrait, where I live, links, "Write to me", Resume (PDF). A block above the page under 900px                                                  |
| `src/lib/about.ts`                                            | every word on the Weekdays side: my two lines, the summary, jobs, school, skills, the three projects, the video                                                          |
| `src/components/about/Resume.astro`                           | work, school and skills as ruled rows, every line showing (no "N more")                                                                                                  |
| `src/components/about/Projects.astro`                         | each project beside its live piece                                                                                                                                       |
| `src/lib/radar.ts`, `src/lib/led-radar.ts`                    | the balcFlights-LED radar: maths, text, font and layout (tested), then the canvas driver                                                                                 |
| `src/assets/about/`                                           | `me-everest.jpg` (the portrait), `cozy-critter.jpg` (the video's poster)                                                                                                 |
| `public/Truman-Brown-Resume.pdf`                              | the public resume, without my phone number or personal email                                                                                                             |
| `src/lib/open.ts` `openPage`, `LeadPhoto.astro`, `global.css` | the page change between the front door, the archive, About me and Things to try (`data-open="page"`); the rows' prints and drawings landing on their cards (`data-land`) |
| `src/components/ContactForm.astro`, `api/contact/notify.js`   | "Write to me" and the email copy of each message ([azure-ops](../azure-ops/SKILL.md))                                                                                    |

## Rules

- **His words stay his.** The Weekends and Weekdays lines are what he wrote, with only typos fixed. Don't polish them. Resume lines are the PDF's, with job titles in sentence case.
- **No phone number or personal email** anywhere on the site, in `about.ts`, in the PDF or in the repo. `about.test.ts` checks the text. Contact is "Write to me", LinkedIn and GitHub.
- **Side projects are the three pinned on his GitHub**: this site, cozy-vibe-vids, balcFlights-LED. Each has a photo or a live element, never a link to something already on the site.
- **The switch can't be missed.** Heading-size words, a tracked line under each saying what's behind it, a 2px bar.
- **Every "About me" goes to `/#weekdays`.** It works without script through `:target`, and `/about/` redirects there.
- **Don't link seattlebalc.com.** It's a friend's site that the radar reads from, not his work. The radar's link goes to the balcFlights-LED README, where a video shows the real panel. The privacy page still names the site in words, because visitors' browsers talk to it.
- **Photos he picked, not the first one.** The site project shows the newest session's header photo, chosen the way the session page chooses its banner (`banner`, then a wide cover, then the widest).
- **The resume is on the page, not only in the rail.** Resume (PDF) is the Weekdays side's one filled button, first in the row under his line. The rail lists it as a plain link with the others. Never two Resume buttons in different styles.
- **Every resume line shows.** No collapsing a job behind "N more": he found the button easy to miss.
- **The icon is Mount Baker on the LED panel** (`public/favicon.svg`), picked from round 2 of the icon mocks (`mocks/portfolio/brand2.html`). Rules for it are in site-design.instructions.md.
- **Tabs say his name first:** "Truman Brown", "Truman Brown | Work" while Weekdays shows, and "Truman Brown | <page>" everywhere else. He picked this over page-first, which reads better in a crowded tab strip.
- **Today's layout, sized up.** Round 2's three-column, two-page and projects-first layouts all crowded the page. What fixed the blank space was a wider rail (248px, the archive's stays 212px), one centered column the footer's width, bigger resume type (15px lines, 18px titles) and smaller project pictures (a 320px column, the radar 240px). The work should always take more room than the projects.
- **Same photo, never a different one,** when moving between pages. The lead photo is handed over by its URL and moves to its place. Nothing else carries over.

## Update the resume

1. Edit `WORK`, `SUMMARY`, `SCHOOL` or `SKILLS` in `src/lib/about.ts`, newest job first, months as `YYYY-MM`.
2. Replace the PDF. Open his new PDF with PyMuPDF (`pip install --target` a scratch folder) and read the contact line with `page.get_text()`. Since 2026-11-05 his own copy has no phone or email (`Seattle, WA | linkedin.com/in/trumanbrown | trumanbrown.com`). If one ever comes back, redact those spans and write the line back in the PDF's own embedded Cambria (`doc.extract_font`), keeping the links. Either way, clear `creator` and `producer`, drop the XMP block (`del_xml_metadata`), check with `get_text()` and `strings` that no number or email is left, and save it as `public/Truman-Brown-Resume.pdf`. If the text didn't change, `about.ts` doesn't need to: check each line is in the PDF word for word.
3. `npx vitest run src/lib/about.test.ts`, then look at `/#weekdays` at 1440×900 and 390×844.

## Add or change a side project

1. Edit `PROJECTS` in `src/lib/about.ts` and keep `about.test.ts`'s list in step.
2. A new `media` kind needs its own block in `Projects.astro`. Prefer something live and cheap: a build-time read of the site's own data, a third-party embed that loads only on a press, or a public API read only while on screen. A new host goes in the narrowest CSP directive in `staticwebapp.config.json` and on the privacy page.

## The radar

The panel draws what the real one does (`balc_flights_led/display.py` and `presentation.py` in his balcFlights-LED repo): the callsign as big as fits, type and altitude, speed and climb in the trend colour, compass point and distance on the right, dashed rings, a sweep at 85°/s, contacts brightest as the sweep passes, and the nearest with a trail and a blinking marker. The data is `https://seattlebalc.com/api/v1/flights` (no key, CORS `*`, cached 20 s, asks not to be polled harder). It's fetched only while the panel is on screen and the tab visible, every 20 s, with planes moved along their headings in between. Pause stops it, and reduced motion draws it still. `connect-src` allows `https://seattlebalc.com`.

If it says NO DATA, `curl -s https://seattlebalc.com/api/v1/flights | head` first. A `degraded` status draws the callsign in amber.

## Truman's verdicts

- 2026-11-05: of the portfolio mocks, "A weekends is good." Side projects: "only highlight these three - and I suggest using a photo or live elemtn for each. live site under the website project seems not useful since they are already on the site." The switch: "mak esure the weekends and weekdays tab isn't too hard to miss. it's good, but just want to make sure it isn' tmissed." The portrait: "use whichever looks better and more fiting for the section" of Everest and a boat in Ninh Binh. Everest won, since his own Everest session is in the archive and the photo links to it. "Write to me" should "mention the about me section first and then the print or photo", and every message should reach his email.

- 2026-11-05, on the live page: "a lot of blank space on this page" on the Weekdays side; the newest session should use "either the cover or the header images considering I selected those"; "don't highlight seattlebalc.com with a link to it. I didn't make that so it isn't really impressive. my friend made it"; "maybe the side bar could be a bit bigger?"; "why is one resume button off color while the other isn't". The two Resume buttons were the rail's outlined `.btn` and the Weekdays row's filled `.btn-ink`, two of the same action in two styles. Round 2 mocks (`mocks/portfolio/r2-*.html`) for the space and the rail width.

- 2026-11-05, on round 2: "i think fixed is still better, just make the side bar a bit bigger, and maybe center or make the experience section bigger too. I think anything else overcrowds the page too much." And "the side projects are just a bit too big, the images are quite large. takes up more space than the actual experience imo."

- 2026-11-05, on the live Weekdays side: "I would put a resume button on this page directly. its kind of hidden in bottom left. and if users are going to about me, they expect to see a resume somewhere clearly." And "name first tab looks best." Of the first icon mocks: "i dont really understand them. what is a trig point" (round 2 at `mocks/portfolio/brand.html`, described in plain words).

- 2026-11-05: "mt baker led panel is the winner." And "don't shorten the experience sections by default. keep it full length. it's easy to miss that expand button, just get rid of it."

- 2026-11-05, on the page-change mocks: "lands on their cards for both looks best." The rows' prints and drawings now land on their cards (site-motion).

## Hard-won lessons

1. **The Windows `az` under WSL crashes printing Bicep** that has a `→` in it (`'charmap' codec can't encode`). Build with `--outfile` and a `wslpath -w` path instead of `--stdout`.
2. **A hidden VS Code browser panel skips view transitions** (`document.visibilityState` is `hidden`), and headless Chromium in WSL never paints after one. Check the handover by reading `.lead[data-current]` on both pages, and see the change in Windows Edge headless (site-motion lesson 13) or a visible browser.
3. **Local sessions have no `showcase` picks or captions,** so the lead photo is empty and the site project has no caption on a local build. Copy `src/content/sessions/*.json` aside, add picks for a look, and put them back.
4. **The first deploy failed on a duplicate route.** `/about` and `/about/` were both redirects, and Static Web Apps treats them as one route and refuses the whole config, which nothing local checked. One rule, `/about`, covers both, and `scripts/swa-config.test.mjs` fails on a repeat.
5. **The resume went missing by fixing a style.** Two Resume buttons in two styles drew "why is one off color", so the page's one was removed and only the rail's bottom-corner button stayed, which he then couldn't find. Fix a mismatch by matching the styles or demoting the duplicate to a link, not by removing the one in the obvious place.
