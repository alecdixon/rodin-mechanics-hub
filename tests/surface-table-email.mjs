import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import {
  buildSurfaceTableMail,
  buildSurfaceTablePdf,
  surfaceTableEmailSubject,
  surfaceTablePdfFilename,
} from "../lib/surfaceTablePdf.ts";

const submitted = {
  car_id: 1,
  car_name: "Car 1",
  driver: "Test Driver",
  circuit: "Silverstone GP",
  check_date: "2026-09-15",
  engineer_name: "Test Engineer",
  created_by: "mechanic@example.com",
  submitted_at: "2026-09-15T13:45:00.000Z",
  corner_weights: { fl: "132.4", fr: "133", rl: "141.6", rr: "142", total: "549" },
  camber_measurements: { fl: "-3.2", fr: "-3.1", rl: "-2.4", rr: "-2.5" },
  wing_shims: { main_lh: "2", main_rh: "2", spare_lh: "3", spare_rh: "3" },
  items: [
    {
      item_key: "floor-front",
      item_name: "Floor leading edge",
      item_side: "LH",
      item_position: "Front reference point",
      status: "legal",
      illegal_note: null,
      height_notation_enabled: true,
      height_notation: 4,
    },
    {
      item_key: "plank-rear",
      item_name: "Rear plank measurement",
      item_side: "RH",
      item_position: "Rear reference point",
      status: "illegal",
      illegal_note: "Below tolerance after running",
      height_notation_enabled: false,
      height_notation: null,
    },
  ],
};

const pdf = await buildSurfaceTablePdf(submitted, "2026-09-15T14:00:00.000Z");
assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-", "generator should return a PDF");
const parsedPdf = await PDFDocument.load(pdf);
assert.ok(parsedPdf.getPageCount() >= 2, "report should contain summary and measurement pages");
assert.equal(parsedPdf.getTitle(), "Surface Table Check - Car 1 - 15 Sep 2026");
assert.match(parsedPdf.getSubject() || "", /Silverstone GP/);
assert.match(parsedPdf.getSubject() || "", /2026-09-15T13:45:00\.000Z/);

assert.equal(surfaceTablePdfFilename(submitted), "Surface_Table_Car_1_2026-09-15.pdf");
assert.equal(surfaceTableEmailSubject(submitted), "Surface Table Check - Car 1 - 15 Sep 2026");

const mail = buildSurfaceTableMail({
  payload: submitted,
  recipient: "engineer@example.com",
  pdf,
  reportUrl: "https://hub.example.com/legality/report/saved-check-id",
});
assert.equal(mail.to, "engineer@example.com");
assert.equal(mail.attachments.length, 1);
assert.equal(mail.attachments[0].filename, "Surface_Table_Car_1_2026-09-15.pdf");
assert.equal(mail.attachments[0].contentType, "application/pdf");
assert.deepEqual(mail.attachments[0].content, pdf, "attachment must use the generated submitted-value PDF");
assert.match(mail.text, /Silverstone GP/);
assert.match(mail.text, /mechanic@example\.com/);
assert.match(mail.text, /15 Sep 2026/);
assert.match(mail.text, /View in Mechanics Hub/);

// PDF generation is a server-side structured-data operation and has no recipient/session dependency.
const secondPdf = await buildSurfaceTablePdf({
  ...submitted,
  engineer_name: "",
  created_by: "",
  corner_weights: { fl: "", fr: "", rl: "", rr: "", total: "" },
  items: [{ ...submitted.items[1], illegal_note: "Driver\u2019s note \u2014 checked again" }],
});
assert.equal(secondPdf.subarray(0, 5).toString("ascii"), "%PDF-");
const multiPagePdf = await buildSurfaceTablePdf({
  ...submitted,
  items: Array.from({ length: 70 }, (_, index) => ({
    ...submitted.items[index % submitted.items.length],
    item_key: `measurement-${index}`,
    item_name: `Measurement ${index + 1} with a long workshop description`,
    illegal_note: index % 2 ? "Long inspection note that must wrap cleanly within one measurement row" : null,
  })),
});
assert.ok((await PDFDocument.load(multiPagePdf)).getPageCount() > 2,
  "long measurement tables should paginate into additional A4 pages");

const [pageSource, routeSource] = await Promise.all([
  readFile(new URL("../app/legality/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/legality/route.ts", import.meta.url), "utf8"),
]);
const itemSave = pageSource.indexOf('.from("legality_check_items")');
const itemFailure = pageSource.indexOf("if (itemError)", itemSave);
const automaticEmail = pageSource.indexOf("sendLegalityPdf(savedCheckId, emailSnapshot)", itemFailure);
assert.ok(itemSave >= 0 && itemFailure > itemSave && automaticEmail > itemFailure,
  "database item save and failure check must occur before automatic email");
assert.match(pageSource, /const emailSnapshot = createEmailSnapshot\(itemPayload, now\)/,
  "email must use the immutable snapshot captured before asynchronous persistence");
assert.match(pageSource, /items: items\.map\(\(item\) => \(\{ \.\.\.item \}\)\)/,
  "snapshot must clone submitted check items");
assert.match(pageSource, /Surface table check saved, but the engineer PDF was not sent/,
  "email failure must report partial success without rolling back the saved record");
assert.match(routeSource, /authorization\?\.startsWith\("Bearer "\)/,
  "mail endpoint must require a Supabase bearer session");
assert.doesNotMatch(pageSource, /GMAIL_APP_PASSWORD|GMAIL_USER/,
  "mail credentials must not be referenced by the client page");

console.log("Surface Table PDF/email tests passed.");
