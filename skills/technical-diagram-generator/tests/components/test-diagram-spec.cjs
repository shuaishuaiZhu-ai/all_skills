"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadDiagramSpec, normalizeFormat, validateDiagramSpec, DiagramSpecError } = require("../../scripts/diagram-spec.cjs");

const fixture = (name) => path.join(__dirname, "fixtures", name);
assert.equal(normalizeFormat(undefined), "svg");
assert.equal(normalizeFormat("drawio"), "drawio");
assert.equal(normalizeFormat("both"), "both");
assert.throws(() => normalizeFormat("png"), (error) => error instanceof DiagramSpecError && error.code === "E_FORMAT_INVALID");
for (const invalidFormat of [["svg"], { toString: () => "drawio" }, 1, null]) {
  assert.throws(
    () => normalizeFormat(invalidFormat),
    (error) => error instanceof DiagramSpecError && error.code === "E_FORMAT_INVALID"
  );
}
assert.equal(loadDiagramSpec(fixture("valid-flow.json")).components.length, 2);
assert.equal(loadDiagramSpec(fixture("add1-regression.json")).components.length, 3);
assert.throws(() => loadDiagramSpec(fixture("invalid-missing-target.json")), (error) => error.code === "E_SPEC_REFERENCE");

const validSpec = () => ({ schemaVersion: 1, id: "valid", title: "有效规范", learningQuestion: "验证什么？", layout: { type: "flow-row" }, evidence: { status: "confirmed", sources: ["source"] }, components: [{ id: "card", type: "card", title: "组件" }], connectors: [] });

for (const invalidTitle of [undefined, "", 1]) {
  const spec = validSpec();
  spec.components[0].title = invalidTitle;
  assert.ok(validateDiagramSpec(spec).some((finding) => finding.code === "E_FIELD_REQUIRED" && finding.id === "card"));
}

for (const invalidSource of ["", 1]) {
  const spec = validSpec();
  spec.evidence.sources = [invalidSource];
  assert.ok(validateDiagramSpec(spec).some((finding) => finding.code === "E_EVIDENCE_INVALID" && finding.id === "valid"));
}

const findings = validateDiagramSpec({ schemaVersion: 1, id: "middle", title: "排序", learningQuestion: "findings 是否稳定排序？", layout: { type: "bad-layout" }, evidence: { status: "confirmed", sources: ["source"] }, components: [{ id: "a", type: "bad-component", title: "A" }, { id: "Z", type: "bad-component", title: "Z" }], connectors: [] });
assert.deepEqual(findings.map((finding) => finding.id), ["Z", "a", "middle"]);

const duplicateIdFindings = validateDiagramSpec({ schemaVersion: 1, id: "duplicate", title: "重复 ID", learningQuestion: "平面 ID 是否唯一？", layout: { type: "flow-row" }, evidence: { status: "confirmed", sources: [] }, components: [{ id: "shared", type: "card", title: "组件" }], connectors: [{ id: "shared", source: "shared", target: "shared" }] });
assert.ok(duplicateIdFindings.some((finding) => finding.code === "E_ID_DUPLICATE" && finding.id === "shared"));

const temporaryFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "diagram-spec-")), "invalid.json");
fs.writeFileSync(temporaryFile, "{", "utf8");
assert.throws(() => loadDiagramSpec(temporaryFile), (error) => error instanceof DiagramSpecError && error.code === "E_SPEC_JSON");
fs.rmSync(path.dirname(temporaryFile), { recursive: true, force: true });

console.log("PASS test-diagram-spec");
