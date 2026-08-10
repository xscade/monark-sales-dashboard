/** 1st, 2nd, 3rd, 4th… including the 11–13 exceptions English needs. */
export function ordinal(value: number): string {
  const teens = value % 100;
  if (teens >= 11 && teens <= 13) return `${value}th`;
  const last = value % 10;
  return `${value}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

/**
 * Names the visit being booked by its position in the lead's history.
 *
 * "A 4th site visit" tells the person ticking the box something they would
 * otherwise have to go and look up, and it makes repeat-visit analysis fall out
 * of the visit rows for free rather than needing a counter of its own. The
 * first one is left unnumbered — "a 1st site visit" is not how anyone speaks.
 */
export function siteVisitLabel(previousVisits: number): string {
  const previous = Number.isFinite(previousVisits) ? Math.max(0, Math.trunc(previousVisits)) : 0;
  return previous === 0
    ? "They want to book a site visit"
    : `They want to book a ${ordinal(previous + 1)} site visit`;
}
