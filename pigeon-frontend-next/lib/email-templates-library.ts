/**
 * Library of pre-built email templates from public/email-templates-main.
 * Each template has index.html (and index.mjml) under template{N}.
 */

export interface LibraryTemplateMeta {
  id: string;
  name: string;
}

export const LIBRARY_TEMPLATES: LibraryTemplateMeta[] = [
  { id: "template1", name: "Best Recipes" },
  { id: "template2", name: "Cheers to summer!" },
  { id: "template3", name: "Discover Our Artisanal Coffee Collection" },
  { id: "template4", name: "Discover Your Next Adventure" },
  { id: "template5", name: "Culinary Delights Weekly Newsletter" },
  { id: "template6", name: "Gaming Weekly: Level Up Your Experience!" },
  { id: "template7", name: "Tech Weekly Update" },
  { id: "template8", name: "Organic Living Newsletter" },
  { id: "template9", name: "Luxury Fashion Collection" },
  { id: "template10", name: "Kids Learning Adventure" },
  { id: "template11", name: "Fitness & Wellness Newsletter" },
  { id: "template12", name: "Tech Newsletter" },
  { id: "template13", name: "Welcome 2024 - New Year, New Beginnings!" },
  { id: "template14", name: "Love is in the Air - Valentine's Day Special" },
  { id: "template15", name: "Hop into Easter Joy!" },
  { id: "template16", name: "Thanksgiving Celebration" },
  { id: "template17", name: "Magical Christmas Sale" },
  { id: "template18", name: "Celebrate Dad - Father's Day Specials" },
  { id: "template19", name: "BLACK FRIDAY MEGA SALE" },
  { id: "template20", name: "BLACK FRIDAY LUXURY DEALS" },
  { id: "template21", name: "Cyber Monday - Biggest Online Deals" },
  { id: "template22", name: "BLACK FRIDAY EXCLUSIVE" },
  { id: "template23", name: "BLACK FRIDAY SPORTS DEALS" },
  { id: "template24", name: "BLACK FRIDAY SPORTS DEALS" },
  { id: "template25", name: "BLACK FRIDAY Z-PATTERN" },
  { id: "template26", name: "BLACK FRIDAY SPLIT DESIGN" },
  { id: "template27", name: "BLACK FRIDAY GALLERY" },
  { id: "template28", name: "BLACK FRIDAY MAGAZINE STYLE" },
  { id: "template29", name: "BLACK FRIDAY MINIMALIST" },
  { id: "template30", name: "BLACK FRIDAY VINTAGE" },
  { id: "template31", name: "BLACK FRIDAY ARTSY" },
  { id: "template32", name: "BLACK FRIDAY INDUSTRIAL" },
  { id: "template33", name: "Next Gen Tech Launch" },
  { id: "template34", name: "Spring Collection 2024" },
  { id: "template35", name: "Exclusive 24-Hour Sale" },
];

const LIBRARY_BASE = "/email-templates-main";

export function getLibraryTemplateHtmlUrl(id: string): string {
  return `${LIBRARY_BASE}/${id}/index.html`;
}

export function getLibraryTemplateById(id: string): LibraryTemplateMeta | undefined {
  return LIBRARY_TEMPLATES.find((t) => t.id === id);
}
