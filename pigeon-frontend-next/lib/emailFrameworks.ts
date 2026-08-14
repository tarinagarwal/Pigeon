/** Email copywriting frameworks — one is picked at random per template for variety */
export const EMAIL_FRAMEWORKS: [string, string][] = [
  ["PAS", "Problem → Agitate → Solution: Identify the prospect's problem, amplify the pain, then present your solution."],
  ["AIDA", "Attention → Interest → Desire → Action: Grab attention, build interest, create desire, end with a clear call-to-action."],
  ["QVC", "Question → Value → Call-to-action: Open with a compelling question, deliver value, then a soft CTA."],
  ["3S", "Short → Specific → Simple: Keep it brief, be specific to their situation, use simple language."],
];

export function getRandomFramework(): string {
  const [name, desc] = EMAIL_FRAMEWORKS[Math.floor(Math.random() * EMAIL_FRAMEWORKS.length)];
  return `\n\nSTRUCTURE: Use the ${name} copywriting framework (${desc}). Structure the email body to follow this framework.`;
}
