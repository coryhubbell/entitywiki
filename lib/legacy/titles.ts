import type { LegacyDescriptor } from "./contracts.ts";

export class LegacyTitleError extends Error {
  readonly status = 400;
  constructor() { super("Invalid legacy title."); }
}

/** MediaWiki source identity: namespace aliases, underscores and the first letter are normalized. */
export function normalizeLegacyTitle(input: string, namespaces: LegacyDescriptor["namespaces"]): string {
  let title = input.normalize("NFC").replace(/_/g, " ").replace(/[\t\r\n ]+/g, " ").trim();
  if (!title || /[\u0000-\u001f\u007f#<>\[\]{}|]/u.test(title)) throw new LegacyTitleError();
  if (title.startsWith(":")) title = title.slice(1).trim();
  const colon = title.indexOf(":");
  let prefix = "";
  if (colon >= 0) {
    const candidate = title.slice(0, colon).trim().toLocaleLowerCase("en-US");
    const namespace = namespaces.find(entry => [entry.name, entry.canonical, ...(entry.aliases ?? [])]
      .some(name => typeof name === "string" && name.toLocaleLowerCase("en-US") === candidate));
    if (namespace) {
      prefix = namespace.id === 0 ? "" : `${namespace.name || namespace.canonical}:`;
      title = title.slice(colon + 1).trim();
    }
  }
  if (!title || title === "." || title === "..") throw new LegacyTitleError();
  const characters = Array.from(title);
  const pageTitle = `${characters[0].toLocaleUpperCase("en-US")}${characters.slice(1).join("")}`;
  // MediaWiki stores namespace separately; page_title's byte limit excludes a recognized prefix.
  if (new TextEncoder().encode(pageTitle).length > 255) throw new LegacyTitleError();
  return `${prefix}${pageTitle}`;
}
