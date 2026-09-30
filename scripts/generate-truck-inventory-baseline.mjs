import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";

const workbookPath = process.argv[2];
const outputPath = process.argv[3] ?? "supabase-truck-inventory-2025-baseline.sql";

if (!workbookPath) {
  throw new Error("Usage: node scripts/generate-truck-inventory-baseline.mjs <workbook.xlsx> [output.sql]");
}

const workbook = XLSX.readFile(workbookPath, { cellFormula: true });
const catalogueSheet = workbook.Sheets["Catalogue Pages"];
const fullTableSheet = workbook.Sheets["Full Table"];
const orderSheet = workbook.Sheets["Order form"];

if (!catalogueSheet || !fullTableSheet || !orderSheet) {
  throw new Error('Workbook must contain "Catalogue Pages", "Full Table" and "Order form" sheets.');
}

const clean = (value) => String(value ?? "").replace(/\u00a0/g, " ").trim();
const normalisePartNumber = (value) => clean(value).toUpperCase();
const sqlText = (value) => value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const sqlJson = (value) => `${sqlText(JSON.stringify(value))}::jsonb`;
const parseQuantity = (value) => {
  const text = clean(value);
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
};

const catalogueRows = XLSX.utils.sheet_to_json(catalogueSheet, {
  header: 1,
  defval: null,
  raw: false,
});
const catalogueByPart = new Map();
let currentCategory = null;

for (let index = 0; index < catalogueRows.length; index += 1) {
  const row = catalogueRows[index];
  const item = clean(row[1]);
  const partNumber = clean(row[2]);
  const description = clean(row[3]);

  if (/^\d{2}[A-Z]?\s*-\s*/.test(item) && !partNumber && !description) {
    currentCategory = item;
    continue;
  }

  if (!partNumber || partNumber === "Part Number" || !description || item === "Item") continue;

  const key = normalisePartNumber(partNumber);
  const occurrence = {
    sheet: "Catalogue Pages",
    row: index + 1,
    item: item || null,
    category: currentCategory,
    assembly_quantity: clean(row[4]) || null,
    type: clean(row[5]) || null,
    price: clean(row[6]) || null,
    description,
  };

  if (!catalogueByPart.has(key)) {
    catalogueByPart.set(key, {
      partNumber,
      description,
      categories: new Set(currentCategory ? [currentCategory] : []),
      occurrences: [],
    });
  }

  const entry = catalogueByPart.get(key);
  if (currentCategory) entry.categories.add(currentCategory);
  entry.occurrences.push(occurrence);
}

const orderRows = XLSX.utils.sheet_to_json(orderSheet, {
  header: 1,
  defval: null,
  raw: false,
});
const orderFormulaErrorsByRow = new Map();
for (const [address, cell] of Object.entries(orderSheet)) {
  if (address.startsWith("!") || cell?.t !== "e") continue;
  const rowNumber = XLSX.utils.decode_cell(address).r + 1;
  if (!orderFormulaErrorsByRow.has(rowNumber)) orderFormulaErrorsByRow.set(rowNumber, []);
  orderFormulaErrorsByRow.get(rowNumber).push({
    cell: address,
    formula: cell.f ?? null,
    excel_error_code: cell.v,
  });
}
const inventoryGroups = new Map();
const orderFormulaErrorCount = [...orderFormulaErrorsByRow.values()].reduce((sum, errors) => sum + errors.length, 0);

for (let index = 20; index < Math.min(orderRows.length, 266); index += 1) {
  const row = orderRows[index];
  const partNumber = clean(row[0]);
  const quantityText = clean(row[1]);
  const description = clean(row[2]);
  const note = clean(row[5]);
  if (!partNumber && !quantityText && !description && !note) continue;

  const rowNumber = index + 1;
  const key = partNumber ? `part:${normalisePartNumber(partNumber)}` : `row:${rowNumber}`;
  const sourceRow = {
    sheet: "Order form",
    row: rowNumber,
    part_number: partNumber || null,
    quantity: quantityText || null,
    description: description || null,
    note: note || null,
    formula_errors: orderFormulaErrorsByRow.get(rowNumber) ?? [],
  };

  if (!inventoryGroups.has(key)) {
    inventoryGroups.set(key, {
      key,
      partNumber: partNumber || null,
      quantity: parseQuantity(quantityText),
      description: description || null,
      sourceRows: [],
    });
  }
  inventoryGroups.get(key).sourceRows.push(sourceRow);
}

const catalogueItems = [...catalogueByPart.values()].sort((a, b) =>
  a.partNumber.localeCompare(b.partNumber, "en", { sensitivity: "base" }),
);
const unresolvedCatalogueRows = XLSX.utils.sheet_to_json(fullTableSheet, {
  header: 1,
  defval: null,
  raw: false,
}).slice(1).map((row, index) => ({
  sheet: "Full Table",
  row: index + 2,
  item: clean(row[0]) || null,
  part_number: clean(row[1]) || null,
  description: clean(row[2]) || null,
  assembly_quantity: clean(row[3]) || null,
  type: clean(row[4]) || null,
  price: clean(row[5]) || null,
})).filter((row) => {
  const hasAnyValue = Object.entries(row).some(([key, value]) =>
    key !== "sheet" && key !== "row" && value != null,
  );
  return hasAnyValue && (!row.part_number || !row.description);
}).map((row) => ({
  ...row,
  needs_review: true,
  review_reason: "Missing a proper part number or description in the 2025 catalogue source",
}));
const inventoryItems = [...inventoryGroups.values()];

const catalogueValues = catalogueItems.map((item) => {
  const categories = [...item.categories];
  const sourceData = {
    source_year: 2025,
    source_file: path.basename(workbookPath),
    categories,
    occurrences: item.occurrences,
  };
  return `    (${sqlText(item.partNumber)}, ${sqlText(item.description)}, ${sqlText(categories[0] ?? null)}, ${sqlJson(sourceData)})`;
});

let reviewCount = 0;
let duplicateGroupCount = 0;
let unmatchedCount = 0;
let missingPartNumberCount = 0;
const inventoryValues = inventoryItems.map((item) => {
  const catalogue = item.partNumber ? catalogueByPart.get(normalisePartNumber(item.partNumber)) : null;
  const notes = item.sourceRows.map((row) => row.note).filter(Boolean);
  const problems = [];
  if (!item.partNumber) {
    problems.push("Missing part number in 2025 source");
    missingPartNumberCount += 1;
  }
  if (!item.description) problems.push("Missing description in 2025 source");
  if (item.quantity == null) problems.push("Missing or invalid quantity in 2025 source");
  if (item.sourceRows.length > 1) {
    problems.push(`Duplicate part number across source rows ${item.sourceRows.map((row) => row.row).join(", ")}; first quantity retained`);
    duplicateGroupCount += 1;
  }
  if (notes.length) problems.push(`Source notes: ${[...new Set(notes)].join("; ")}`);
  const formulaErrorCells = item.sourceRows.flatMap((row) => row.formula_errors.map((error) => error.cell));
  if (formulaErrorCells.length) problems.push(`Formula error in source cells: ${formulaErrorCells.join(", ")}`);
  if (item.partNumber && !catalogue) {
    problems.push("Part number was not matched to the 2025 catalogue");
    unmatchedCount += 1;
  }
  const status = problems.length ? "NEEDS_REVIEW" : "TRACKED";
  if (status === "NEEDS_REVIEW") reviewCount += 1;
  const category = catalogue ? [...catalogue.categories][0] ?? null : null;
  const sourceData = {
    source_year: 2025,
    source_file: path.basename(workbookPath),
    source_rows: item.sourceRows,
    review_reasons: problems,
  };
  return `    (${sqlText(item.key)}, ${sqlText(item.partNumber)}, ${sqlText(item.description)}, ${item.quantity ?? "null"}, ${sqlText(category)}, ${sqlText(status)}, ${sqlText(problems.join("\n") || null)}, ${sqlJson(sourceData)})`;
});

const batches = (values, size) => {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
};

const lines = [
  "-- Generated from 2025 truck stock.xlsx by scripts/generate-truck-inventory-baseline.mjs.",
  "-- Apply after supabase-truck-inventory.sql. Safe to repeat:",
  "-- catalogue source rows refresh; existing inventory records and Chief edits are never overwritten.",
  "begin;",
  "",
  "insert into public.parts_catalogue_versions (source_key, year, name, source_metadata)",
  `values ('gb3-parts-manual-2025-issue-2', 2025, 'GB3 Parts Manual / Order Form - Issue 2 2025', ${sqlJson({ source_file: path.basename(workbookPath), historical_baseline: true, unresolved_catalogue_rows: unresolvedCatalogueRows })})`,
  "on conflict (source_key) do update set",
  "  year = excluded.year,",
  "  name = excluded.name,",
  "  source_metadata = excluded.source_metadata;",
  "",
];

for (const batch of batches(catalogueValues, 200)) {
  lines.push(
    "with version as (",
    "  select id from public.parts_catalogue_versions where source_key = 'gb3-parts-manual-2025-issue-2'",
    ")",
    "insert into public.parts_catalogue_items",
    "  (catalogue_version_id, part_number, description, category, source_data)",
    "select version.id, imported.part_number, imported.description, imported.category, imported.source_data",
    "from version cross join (values",
    batch.join(",\n"),
    ") as imported(part_number, description, category, source_data)",
    "on conflict (catalogue_version_id, part_number_normalized) do update set",
    "  part_number = excluded.part_number,",
    "  description = excluded.description,",
    "  category = excluded.category,",
    "  source_data = excluded.source_data;",
    "",
  );
}

for (const batch of batches(inventoryValues, 100)) {
  lines.push(
    "with version as (",
    "  select id from public.parts_catalogue_versions where source_key = 'gb3-parts-manual-2025-issue-2'",
    "), imported(baseline_source_key, part_number, description, quantity, category, tracking_status, notes, source_data) as (",
    "  values",
    batch.join(",\n"),
    ")",
    "insert into public.truck_inventory_items",
    "  (catalogue_part_id, part_number, description, target_quantity, baseline_quantity_2025, category, tracking_status, notes, baseline_source_key, source_data)",
    "select catalogue.id, imported.part_number, imported.description, imported.quantity, imported.quantity,",
    "  imported.category, imported.tracking_status, imported.notes, imported.baseline_source_key, imported.source_data",
    "from imported",
    "cross join version",
    "left join public.parts_catalogue_items catalogue",
    "  on catalogue.catalogue_version_id = version.id",
    " and catalogue.part_number_normalized = upper(btrim(imported.part_number))",
    "on conflict do nothing;",
    "",
  );
}

lines.push(
  "commit;",
  "",
  `-- Catalogue: ${catalogueItems.length} unique parts from ${catalogueItems.reduce((sum, item) => sum + item.occurrences.length, 0)} source occurrences.`,
  `-- Catalogue problems: ${unresolvedCatalogueRows.length} non-empty rows without a proper part number or description retained in version metadata.`,
  `-- Inventory: ${inventoryItems.length} records; ${reviewCount} NEEDS_REVIEW.`,
  `-- Problem summary: ${duplicateGroupCount} repeated part-number groups, ${missingPartNumberCount} missing part numbers, ${unmatchedCount} unmatched catalogue part numbers, ${orderFormulaErrorCount} formula-error cells.`,
  "",
);

fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log(JSON.stringify({
  catalogue_items: catalogueItems.length,
  catalogue_occurrences: catalogueItems.reduce((sum, item) => sum + item.occurrences.length, 0),
  unresolved_catalogue_rows: unresolvedCatalogueRows.length,
  inventory_items: inventoryItems.length,
  needs_review: reviewCount,
  duplicate_groups: duplicateGroupCount,
  missing_part_numbers: missingPartNumberCount,
  unmatched_catalogue_parts: unmatchedCount,
  formula_error_cells: orderFormulaErrorCount,
  output: outputPath,
}, null, 2));
