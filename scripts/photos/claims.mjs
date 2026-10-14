/**
 * What text in Truman's voice may claim, shared by the Instagram openings
 * (voice.mjs) and the session descriptions (website.mjs).
 *
 * His best lines say what he was doing ("Pulled over on the side of the
 * road..."), and only he knows that. So anything about what he was doing,
 * who he was with, the weather or the time of day has to be backed by the
 * trip's name, the photo's own record or his notes; anything about waiting,
 * company or a first sighting needs his notes. Phrases a model reaches for
 * to sound human, and time words that would be wrong months later, are out.
 */

// Phrases a model reaches for on every photo, or to sound like a person,
// including the forced-casual ones it swaps in to avoid repeating "I love"
// ("I dig", "I'm a fan of", "got a kick out of"). He'd just say "I love" again.
export const STOCK =
  /\b(?:stands? out against|catch(?:es)? my eye|caught my eye|hard to look past|can't stop looking|worth a closer look|funny little detail|thoroughly|wins? me over|nature never disappoints|nature at its finest|mother nature|living (?:its|his|her|their) best life|stopped me in my tracks|what a sight|feast for the eyes|in all (?:its|their) glory|never gets old|hidden gem|true gem|picture[- ]perfect|magical|paradise|simply|truly|came upon|happened upon|took in|gaz(?:e|ed|ing) (?:at|out|over)|beheld|marvel(?:l?ed)? at|got a glimpse|i (?:really )?dig|i'm (?:a |a big |such a )?fan of|(?:i'm|i was) (?:really |pretty |so )?into|(?:got|get|getting) a kick out of|soft spot|(?:i was |was )?struck by|there's something about)\b/i;

// Said as if it happened just now; posts and pages are read months later.
export const WHEN =
  /\b(?:today|tonight|yesterday|this (?:morning|afternoon|evening|week|weekend|year)|last (?:night|week|weekend|month|year)|earlier this|just now|right now)\b/i;

// Things only his notes can say.
export const NOTES_ONLY = [
  /\b(?:waited|waiting|wait for|hours|minutes|finally|patience|patient)\b/i,
  /\b(?:we|we're|we've|we'd|our|ours|us)\b/i,
  /\bmy (?:wife|girlfriend|boyfriend|husband|partner|friends?|buddy|dad|mom|mum|brother|sister|family|kids?|son|daughter)\b/i,
  /\b(?:first time|first ever|lifer|never seen)\b/i,
  /\bguides?\b/i,
];

// What he was doing, and when: [what the text says, what has to back it up].
export const CIRCUMSTANCES = [
  [
    /\b(?:hik(?:e|es|ed|ing)|trails?|trek\w*|backpack\w*)\b/i,
    /\b(?:hik\w*|trails?|trek\w*|backpack\w*|butte|peaks?|summit|ridge|pass|lookout)\b/i,
  ],
  [/\bcamp(?:ing|ed|site|ground)?\b/i, /\bcamp\w*/i],
  [
    /\b(?:boats?|canoe\w*|kayak\w*|paddl\w*|cruise|tours?)\b/i,
    /\b(?:boats?|canoe\w*|kayak\w*|paddl\w*|cruise|tours?|canals?)\b/i,
  ],
  [
    /\b(?:drive|driving|drove|pulled over|road ?trip|roadside|side of the road|car)\b/i,
    /\b(?:drive|driving|drove|road\w*|car|highway)\b/i,
  ],
  [
    /\b(?:night\w*|after dark|headlamps?|flashlights?|torch)\b/i,
    /\b(?:night\w*|after dark|headlamps?|flashlights?|nocturnal)\b/i,
  ],
  [/\b(?:sunrise|dawn|morning)\b/i, /\b(?:sunrise|dawn|morning)\b/i],
  [
    /\b(?:sunset|dusk|evening|golden hour)\b/i,
    /\b(?:sunset|dusk|evening|golden)\b/i,
  ],
  [
    /\b(?:rain\w*|drizzl\w*|storm\w*|snow\w*|fog\w*|mist\w*|hail)\b/i,
    /\b(?:rain\w*|drizzl\w*|storm\w*|snow\w*|fog\w*|mist\w*|hail|wet)\b/i,
  ],
  [
    /\b(?:snorkel\w*|scuba|diving)\b/i,
    /\b(?:snorkel\w*|scuba|div\w*|underwater)\b/i,
  ],
];

// What makes it his take rather than a description: an opinion, a hedge, a joke.
export const OPINION =
  /\b(?:i|i'm|i've|i'd|my|me|love|loved|like|such|so|pretty|really|cool|crazy|wild|unique|interesting|incredible|amazing|lol|can't|couldn't|almost|fun|favou?rite|neat|weird|funny|wish|never|always|hard to|kind of|kinda|wow)\b/i;

/** The first stock phrase or time word in `text`, or null. */
export function stockIn(text) {
  const t = String(text ?? "");
  return STOCK.exec(t)?.[0] ?? WHEN.exec(t)?.[0] ?? null;
}

/**
 * The first thing `text` claims that nothing backs up, as the words it used,
 * or null. `grounding` is what the trip and the photos say; `notes` is what
 * Truman wrote himself.
 */
export function unbackedClaim(text, { grounding = "", notes = "" } = {}) {
  const t = String(text ?? "");
  const unsaid = NOTES_ONLY.find((re) => re.test(t) && !re.test(notes));
  if (unsaid) return unsaid.exec(t)[0];
  const backing = `${grounding} ${notes}`;
  const made = CIRCUMSTANCES.find(
    ([says, backs]) => says.test(t) && !backs.test(backing),
  );
  return made ? made[0].exec(t)[0] : null;
}
