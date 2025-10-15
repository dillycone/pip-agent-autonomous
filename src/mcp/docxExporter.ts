import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { sanitizeError, sanitizePath } from "../utils/sanitize.js";
import { mcpError } from "../utils/safe-stringify.js";
import { mcpSuccess } from "../utils/mcp-helpers.js";
import { validateFilePath, validateOutputPath } from "../utils/validation.js";
import { DocumentExportError } from "../errors/index.js";
import { createChildLogger } from "../utils/logger.js";
import { isDocxImport, type DocxImport } from "../types/index.js";
import { PROJECT_ROOT } from "../utils/paths.js";
import {
  IFileSystemService,
  createFileSystemService
} from "../services/index.js";

const logger = createChildLogger("docx-exporter");

// Create filesystem service once at module level for reuse
const fsService: IFileSystemService = createFileSystemService();

export const docxExporter = createSdkMcpServer({
  name: "docx-exporter",
  version: "0.1.0",
  tools: [
    tool(
      "render_docx",
      "Render a PIP text body into a DOCX using a template with {pip_body}. If template is missing, generate a fallback DOCX.",
      {
        templatePath: z.string(),
        outputPath: z.string(),
        body: z.string(),
        language: z.string().default("en"),
        title: z.string().default("Performance Improvement Plan")
      },
      async ({ templatePath, outputPath, body, language, title }) => {
        let safeOutputPath: string = outputPath; // Default fallback for error reporting
        try {
          const validationResult = validateOutputPath(outputPath, {
            extensions: [".docx"],
            allowOverwrite: true,
            baseDir: PROJECT_ROOT,
            allowAbsolute: true
          });
          if (!validationResult.valid || !validationResult.sanitizedPath) {
            throw new DocumentExportError(`Invalid output path: ${validationResult.error || 'Path validation failed'}`);
          }
          safeOutputPath = validationResult.sanitizedPath;

          const templateCheck = validateFilePath(templatePath, {
            mustExist: false,
            mustBeFile: true,
            extensions: [".docx"],
            allowAbsolute: true,
            baseDir: PROJECT_ROOT
          });

          if (!templateCheck.valid || !templateCheck.sanitizedPath) {
            throw new DocumentExportError(`Invalid template path: ${templateCheck.error || "Path validation failed"}`);
          }

          const safeTemplate = templateCheck.sanitizedPath;
          if (fsService.existsSync(safeTemplate)) {
            const content = await fsService.readFile(safeTemplate) as Buffer;
            const zip = new PizZip(content);
            const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
            doc.render({ pip_body: body, language, title, date: new Date().toISOString().slice(0,10) });
            const buf = doc.getZip().generate({ type: "nodebuffer" });

            // Parallelize directory creation and file writing preparation
            const outputDir = path.dirname(safeOutputPath);
            await fsService.mkdir(outputDir, { recursive: true });

            logger.info({ outputPath: safeOutputPath, templatePath: safeTemplate, usingTemplate: true }, `[docx-exporter] writing template-based docx to ${safeOutputPath}`);
            await fsService.writeFile(safeOutputPath, buf);
            return mcpSuccess({ outputPath: safeOutputPath });
          } else {
            // Fallback: generate a docx without a template
            const importedDocx = await import("docx");
            if (!isDocxImport(importedDocx)) {
              throw new DocumentExportError("docx module did not expose expected API");
            }
            const { Document, Packer, Paragraph, HeadingLevel, TextRun } = importedDocx;
            const paragraphs: InstanceType<DocxImport["Paragraph"]>[] = [];
            paragraphs.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }));
            paragraphs.push(new Paragraph({ text: `Language: ${language}    Date: ${new Date().toISOString().slice(0,10)}` }));
            paragraphs.push(new Paragraph({ text: "" }));
            for (const line of body.split(/\r?\n/)) {
              if (!line.trim()) { paragraphs.push(new Paragraph({ text: "" })); continue; }
              paragraphs.push(new Paragraph({ children: [ new TextRun({ text: line }) ] }));
            }
            const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });

            // Parallelize buffer generation and directory creation
            const outputDir = path.dirname(safeOutputPath);
            const [buf] = await Promise.all([
              Packer.toBuffer(doc),
              fsService.mkdir(outputDir, { recursive: true })
            ]);

            logger.info({ outputPath: safeOutputPath, usingTemplate: false }, `[docx-exporter] writing fallback docx to ${safeOutputPath}`);
            await fsService.writeFile(safeOutputPath, buf);
            return mcpSuccess({ outputPath: safeOutputPath, note: "Generated fallback (no template found)" });
          }
        } catch (error: unknown) {
          // Check for custom errors first
          if (error instanceof DocumentExportError) {
            return mcpError(error.message, error.metadata);
          }

          // Wrap other errors in DocumentExportError
          const sanitized = sanitizeError(error);
          const message = sanitizePath(sanitized.message);
          return mcpError(message, { ...sanitized, message, templatePath, outputPath: safeOutputPath });
        }
      }
    )
  ]
});
