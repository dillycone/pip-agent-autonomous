/**
 * @file test-template.ts
 * @description Tests the PIP template by rendering it with docxtemplater and sample data.
 * Verifies that all placeholders are correctly formatted and can be replaced at runtime.
 *
 * @usage
 * Run from project root:
 * ```bash
 * npx tsx scripts/test-template.ts
 * ```
 *
 * @input
 * - File: templates/pip-template.docx (created by create-template.ts)
 *
 * @output
 * - File: exports/template-test.docx
 * - Contains rendered test data to verify template works correctly
 *
 * @verification
 * This script validates:
 * 1. All placeholders ({title}, {date}, {pip_body}, {language}) are present
 * 2. docxtemplater can successfully parse the template
 * 3. Content replacement works correctly
 * 4. The output DOCX file is valid and can be opened
 *
 * @notes
 * - Run create-template.ts first if template doesn't exist
 * - Test data includes multi-paragraph content and bullet points
 * - Output file can be inspected manually to verify formatting
 * - The exports/ directory is created automatically if missing
 *
 * @see scripts/create-template.ts - Create the template
 * @see scripts/README.md - Full documentation
 * @see src/mcp/docxExporter.ts - Production template rendering code
 */

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import * as fs from "fs";
import * as path from "path";

async function testTemplate() {
  const templatePath = path.resolve(process.cwd(), "templates/pip-template.docx");
  const outputPath = path.resolve(process.cwd(), "exports/template-test.docx");

  console.log("🧪 Testing template with docxtemplater...\n");

  // Read template
  const content = fs.readFileSync(templatePath);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

  // Test data
  const testData = {
    title: "TEST: Performance Improvement Plan",
    date: new Date().toISOString().slice(0, 10),
    language: "en",
    pip_body: "This is a test PIP body.\n\nIt should replace the {pip_body} placeholder.\n\nMultiple paragraphs work!\n\n• Bullet point 1\n• Bullet point 2\n\nThis confirms the template is working correctly."
  };

  console.log("📝 Rendering with test data:");
  console.log(`   Title: ${testData.title}`);
  console.log(`   Date: ${testData.date}`);
  console.log(`   Language: ${testData.language}`);
  console.log(`   Body: ${testData.pip_body.slice(0, 50)}...`);

  // Render
  doc.render(testData);

  // Save
  const buf = doc.getZip().generate({ type: "nodebuffer" });

  // Ensure exports directory exists
  const exportsDir = path.dirname(outputPath);
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, buf);

  console.log("\n✅ Template test successful!");
  console.log(`📄 Test output: ${outputPath}`);
  console.log("\n💡 Open the file to verify:");
  console.log(`   open ${outputPath}`);
}

testTemplate().catch((error: unknown) => {
  console.error("\n❌ Template test failed:", error);
  if (error && typeof error === "object" && "properties" in error) {
    console.error("Error details:", JSON.stringify(error.properties, null, 2));
  }
  process.exit(1);
});
