/**
 * Spelling checks for the place words in folder names. A session's folder name
 * becomes its web address and the first place name the caption writer is
 * given, and it's the one place name nobody proofreads:
 * "crater-lake-oreogn-sep-2025" went live as "Crater Lake Oreogn".
 *
 * Only two neighbouring letters swapped are corrected ("oreogn", "kauia"), the
 * typo fast typing makes, and only into the name of a state, province,
 * country or island. Nothing else is close enough to guess at, and a real
 * word is never turned into a place.
 */
const NAMES = [
  // US states
  "alabama alaska arizona arkansas california colorado connecticut delaware florida georgia",
  "hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts",
  "michigan minnesota mississippi missouri montana nebraska nevada hampshire jersey mexico york",
  "carolina dakota ohio oklahoma oregon pennsylvania rhode tennessee texas utah vermont virginia",
  "washington wisconsin wyoming",
  // Canada
  "alberta british columbia manitoba brunswick newfoundland labrador scotia ontario prince edward",
  "quebec saskatchewan yukon nunavut territories",
  // Hawaiian islands
  "kauai oahu maui molokai lanai niihau kahoolawe",
  // Countries and the UK's nations
  "afghanistan albania algeria andorra angola antigua barbuda argentina armenia australia austria",
  "azerbaijan bahamas bahrain bangladesh barbados belarus belgium belize benin bhutan bolivia",
  "bosnia herzegovina botswana brazil brunei bulgaria burkina burundi cambodia cameroon canada",
  "central african chile china colombia comoros congo costa croatia cuba cyprus czechia czech",
  "denmark djibouti dominica dominican ecuador egypt salvador england equatorial guinea eritrea",
  "estonia eswatini ethiopia fiji finland france gabon gambia germany ghana greece greenland",
  "grenada guatemala guyana haiti honduras hungary iceland india indonesia iran iraq ireland",
  "israel italy jamaica japan jordan kazakhstan kenya kiribati korea kosovo kuwait kyrgyzstan",
  "laos latvia lebanon lesotho liberia libya liechtenstein lithuania luxembourg madagascar",
  "malawi malaysia maldives mali malta marshall mauritania mauritius micronesia moldova monaco",
  "mongolia montenegro morocco mozambique myanmar namibia nauru nepal netherlands zealand",
  "nicaragua niger nigeria macedonia norway oman pakistan palau palestine panama papua paraguay",
  "peru philippines poland portugal qatar romania russia rwanda samoa marino arabia scotland",
  "senegal serbia seychelles sierra leone singapore slovakia slovenia solomon somalia africa",
  "spain lanka sudan suriname sweden switzerland syria taiwan tajikistan tanzania thailand tibet",
  "togo tonga trinidad tobago tunisia turkey turkmenistan tuvalu uganda ukraine emirates kingdom",
  "uruguay uzbekistan vanuatu vatican venezuela vietnam wales yemen zambia zimbabwe",
  // Continents
  "europe asia america antarctica oceania",
];

const PLACE_WORDS = new Set(NAMES.join(" ").split(/\s+/).filter(Boolean));
// Real words one swap away from a place: "amine" (Maine), "benni" (Benin), "chiel" (Chile).
const REAL_WORDS = new Set(["amine", "benni", "chiel"]);

/** "oreogn" -> "oregon"; null when the word is fine or isn't a near miss. */
export function fixPlaceWord(word) {
  const w = String(word ?? "").toLowerCase();
  if (w.length < 5 || PLACE_WORDS.has(w) || REAL_WORDS.has(w)) return null;
  for (let i = 0; i < w.length - 1; i++) {
    if (w[i] === w[i + 1]) continue;
    const swapped = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
    if (PLACE_WORDS.has(swapped)) return swapped;
  }
  return null;
}

/** The likely typos in a folder name: [{ word: "oreogn", fix: "oregon" }]. */
export function slugTypos(slug) {
  return String(slug ?? "")
    .split(/[-_.\s]+/)
    .map((word) => ({ word: word.toLowerCase(), fix: fixPlaceWord(word) }))
    .filter((t) => t.fix);
}

/** The folder name with its typos fixed: "crater-lake-oregon-sep-2025". */
export function fixSlug(slug) {
  let out = String(slug ?? "");
  for (const { word, fix } of slugTypos(out))
    out = out.replace(
      new RegExp(`(^|[-_.\\s])${word}(?=$|[-_.\\s])`, "i"),
      `$1${fix}`,
    );
  return out;
}
