/**
 * Quick test to verify the template works with docxtemplater
 * Run with: npx tsx scripts/test-template.ts
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

testTemplate().catch((error) => {
  console.error("\n❌ Template test failed:", error);
  if (error.properties) {
    console.error("Error details:", JSON.stringify(error.properties, null, 2));
  }
  process.exit(1);
});
