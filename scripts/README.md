# Template Management Scripts

This directory contains utility scripts for managing DOCX templates.

## Scripts

### `create-template.ts`
Creates a professional PIP template with all required placeholders.

**Usage:**
```bash
npx tsx scripts/create-template.ts
```

**Output:** `templates/pip-template.docx`

**Placeholders included:**
- `{title}` - Document title (e.g., "Performance Improvement Plan")
- `{date}` - Current date in YYYY-MM-DD format
- `{pip_body}` - **REQUIRED** - Main PIP content
- `{language}` - Output language (e.g., "en", "fr")

### `test-template.ts`
Tests the template with docxtemplater to verify it works correctly.

**Usage:**
```bash
npx tsx scripts/test-template.ts
```

**Output:** `exports/template-test.docx`

This script renders the template with test data to verify:
1. All placeholders are correctly formatted
2. Content replacement works
3. The output DOCX is valid

## Template Requirements

For docxtemplater to work properly, templates must:

1. Include `{pip_body}` placeholder (required)
2. Use plain text placeholders (not formatted as fields)
3. Be valid DOCX files created by Word or the docx npm package

## Troubleshooting

**Issue:** Template outputs "Test" or other placeholder text

**Solution:** Run `create-template.ts` to regenerate the template with proper placeholders.

**Issue:** Docxtemplater errors about missing tags

**Solution:** Verify placeholders are present:
```bash
unzip -p templates/pip-template.docx word/document.xml | grep -o '{[^}]*}'
```

Should output:
```
{date}
{language}
{pip_body}
{title}
```
