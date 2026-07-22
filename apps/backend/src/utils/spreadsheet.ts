import ExcelJS from 'exceljs';
import { z } from 'zod';
import { AppError, type AppErrorDetail } from './AppError';

/**
 * Generic spreadsheet (.xlsx) parsing + row-validation engine shared by every
 * Excel import feature (services, products, ...). Module-specific knowledge
 * (columns, business rules, persistence) stays in the owning module; this file
 * only understands workbooks, headers, and Zod row validation.
 */

export interface ParsedSheet {
  /** Normalized header keys in column order (empty headers are skipped). */
  headers: string[];
  /** One entry per non-empty data row, keyed by normalized header. */
  rows: { rowNumber: number; values: Record<string, unknown> }[];
}

export interface ImportRowResult<T> {
  /** 1-based Excel row number (header row is 1). */
  rowNumber: number;
  /** Parsed + validated payload, or null when the row is invalid. */
  data: T | null;
  /** Raw cell values as read from the sheet (for previews). */
  raw: Record<string, unknown>;
  errors: AppErrorDetail[];
}

export interface ImportPreview<T> {
  rows: ImportRowResult<T>[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
  };
}

/** Lowercase and strip spaces/underscores/dashes so "Image URL" == imageUrl. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[\s_-]+/g, '');
}

/** Convert an ExcelJS cell value into a plain scalar (string/number/boolean/Date/null). */
function cellToScalar(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    // Hyperlink cells: prefer the target URL (image URLs are often pasted as links).
    if ('hyperlink' in value && typeof value.hyperlink === 'string') {
      return value.hyperlink;
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    // Formula cells expose their computed result.
    if ('result' in value) {
      return cellToScalar(value.result as ExcelJS.CellValue);
    }
    if (value instanceof Date) return value;
    if ('text' in value && typeof value.text === 'string') return value.text;
    return null;
  }
  return value;
}

/**
 * Parse the first worksheet of an .xlsx buffer. Row 1 must be the header row;
 * completely empty data rows are skipped.
 */
export async function parseSpreadsheet(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw AppError.badRequest(
      'The uploaded file could not be read as an Excel (.xlsx) workbook',
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw AppError.badRequest('The workbook contains no worksheets');
  }

  const headers: string[] = [];
  const headerByColumn = new Map<number, string>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const scalar = cellToScalar(cell.value);
    const header = typeof scalar === 'string' ? normalizeHeader(scalar) : '';
    if (header) {
      headers.push(header);
      headerByColumn.set(col, header);
    }
  });

  if (headers.length === 0) {
    throw AppError.badRequest(
      'The first row of the sheet must contain column headers',
    );
  }

  const rows: ParsedSheet['rows'] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const values: Record<string, unknown> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const header = headerByColumn.get(col);
      if (!header) return;
      const scalar = cellToScalar(cell.value);
      if (scalar !== null && scalar !== '') hasValue = true;
      values[header] = scalar;
    });

    if (hasValue) rows.push({ rowNumber, values });
  });

  return { headers, rows };
}

/**
 * Validate every parsed row against a Zod schema and flag duplicate values of
 * `uniqueField` within the file (the first occurrence wins).
 */
export function buildImportPreview<T>(
  parsed: ParsedSheet,
  rowSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options: { uniqueField?: keyof T & string } = {},
): ImportPreview<T> {
  const seen = new Set<string>();

  const rows = parsed.rows.map<ImportRowResult<T>>(({ rowNumber, values }) => {
    const result = rowSchema.safeParse(values);
    if (!result.success) {
      return {
        rowNumber,
        data: null,
        raw: values,
        errors: result.error.issues.map((i) => ({
          field: i.path.join('.') || undefined,
          message: i.message,
        })),
      };
    }

    if (options.uniqueField) {
      const value = result.data[options.uniqueField];
      const key = typeof value === 'string' ? value.toLowerCase() : null;
      if (key) {
        if (seen.has(key)) {
          return {
            rowNumber,
            data: null,
            raw: values,
            errors: [
              {
                field: options.uniqueField,
                message: `Duplicate ${options.uniqueField} "${String(value)}" — already used by an earlier row`,
              },
            ],
          };
        }
        seen.add(key);
      }
    }

    return { rowNumber, data: result.data, raw: values, errors: [] };
  });

  const validRows = rows.filter((r) => r.data !== null).length;
  return {
    rows,
    summary: {
      totalRows: rows.length,
      validRows,
      invalidRows: rows.length - validRows,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared cell-coercion preprocessors for import row schemas.
// Use as: z.preprocess(cellString, z.string().max(120))            (required)
//         z.preprocess(cellNumber, z.number().int().optional())    (optional)
// Empty/whitespace cells normalize to undefined so `.optional()` inner schemas
// treat them as absent.
// ---------------------------------------------------------------------------

/** Trimmed string from any scalar cell (numbers become their string form). */
export function cellString(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

/** Numeric cell — accepts numbers or numeric strings. */
export function cellNumber(v: unknown): unknown {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? v : n;
}

/** Boolean-ish cell: true/false, yes/no, 1/0 (case-insensitive). */
export function cellBoolean(v: unknown): unknown {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === '') return undefined;
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return v;
}

/** Reusable http(s) URL schema for image-link cells. */
export const urlCellSchema = z
  .string()
  .max(2048, 'URL is too long')
  .url('Must be a valid URL')
  .refine((u) => /^https?:\/\//i.test(u), {
    message: 'URL must start with http:// or https://',
  });
