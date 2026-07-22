import ExcelJS from 'exceljs';

/**
 * Build an in-memory .xlsx buffer for import tests: one sheet, `headers` as
 * row 1, then one row per entry (values in header order).
 */
export async function makeXlsxBuffer(
  headers: string[],
  rows: (string | number | boolean | null)[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
