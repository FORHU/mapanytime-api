import fs from "fs";
import path from "path";
import handlebars from "handlebars";

/**
 * Renders an HTML email from a Handlebars template file.
 *
 * Templates live in src/templates/emails/*.hbs
 *
 * Usage:
 *   const html = await renderEmailTemplate("welcome", {
 *     name: "John",
 *     confirmUrl: "https://...",
 *   });
 */
export const renderEmailTemplate = async (
  templateName: string,
  context: Record<string, unknown>,
): Promise<string> => {
  const templatePath = path.join(
    __dirname,
    "..",
    "templates",
    "emails",
    `${templateName}.hbs`,
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Email template not found: ${templateName}.hbs`);
  }

  const source = fs.readFileSync(templatePath, "utf-8");
  const template = handlebars.compile(source);
  return template(context);
};
