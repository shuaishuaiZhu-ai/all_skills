"use strict";

const fs = require("node:fs");

const FORMATS = new Set(["svg", "drawio", "both"]);
const LAYOUTS = new Set(["flow-row", "timeline-row", "panel-grid"]);
const COMPONENTS = new Set(["canvas", "section", "panel", "card", "badge", "text-stack", "divider", "status", "note", "table", "connector", "legend"]);
const EVIDENCE = new Set(["confirmed", "inferred", "unverified"]);

class DiagramSpecError extends Error {
  constructor(code, id, message) {
    super(message);
    this.name = "DiagramSpecError";
    this.code = code;
    this.id = id;
  }
}

function normalizeFormat(value) {
  const normalized = value === undefined ? "svg" : typeof value === "string" ? value.toLowerCase() : "";
  if (!FORMATS.has(normalized)) throw new DiagramSpecError("E_FORMAT_INVALID", normalized, `unsupported format: ${normalized}`);
  return normalized;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateDiagramSpec(value) {
  const findings = [];
  const add = (code, id, message) => findings.push({ code, id, message });
  const spec = value && typeof value === "object" && !Array.isArray(value) ? value : null;

  if (!spec) {
    add("E_SPEC_INVALID", "spec", "spec must be an object");
    return findings;
  }

  const specId = isNonEmptyString(spec.id) ? spec.id : "spec";
  if (spec.schemaVersion !== 1) add("E_SCHEMA_VERSION", specId, "schemaVersion must be 1");
  if (!isNonEmptyString(spec.id)) add("E_ID_INVALID", "spec", "id must be a non-empty string");
  if (!isNonEmptyString(spec.title)) add("E_FIELD_REQUIRED", specId, "title must be a non-empty string");
  if (!isNonEmptyString(spec.learningQuestion)) add("E_FIELD_REQUIRED", specId, "learningQuestion must be a non-empty string");

  if (!spec.evidence || typeof spec.evidence !== "object" || !EVIDENCE.has(spec.evidence.status)) {
    add("E_EVIDENCE_INVALID", specId, "evidence.status must be confirmed, inferred, or unverified");
  }
  if (!spec.evidence || !Array.isArray(spec.evidence.sources)) {
    add("E_EVIDENCE_INVALID", specId, "evidence.sources must be an array");
  } else if (!spec.evidence.sources.every(isNonEmptyString)) {
    add("E_EVIDENCE_INVALID", specId, "evidence.sources entries must be non-empty strings");
  }
  if (!spec.layout || typeof spec.layout !== "object" || !LAYOUTS.has(spec.layout.type)) {
    add("E_LAYOUT_INVALID", specId, "layout.type is invalid");
  }

  const components = Array.isArray(spec.components) ? spec.components : [];
  if (!Array.isArray(spec.components)) add("E_COMPONENTS_INVALID", specId, "components must be an array");
  const connectors = Array.isArray(spec.connectors) ? spec.connectors : [];
  if (!Array.isArray(spec.connectors)) add("E_CONNECTORS_INVALID", specId, "connectors must be an array");

  const componentIds = new Set();
  const connectorIds = new Set();
  for (const component of components) {
    const id = component && isNonEmptyString(component.id) ? component.id : specId;
    if (!component || typeof component !== "object" || !isNonEmptyString(component.id)) {
      add("E_ID_INVALID", id, "component id must be a non-empty string");
      continue;
    }
    if (componentIds.has(component.id)) add("E_ID_DUPLICATE", component.id, "component id must be unique");
    componentIds.add(component.id);
    if (!COMPONENTS.has(component.type)) add("E_COMPONENT_INVALID", component.id, "component type is invalid");
    if (!isNonEmptyString(component.title)) add("E_FIELD_REQUIRED", component.id, "component title must be a non-empty string");
  }
  for (const component of components) {
    if (!component || !isNonEmptyString(component.id) || !isNonEmptyString(component.parentId)) continue;
    if (!componentIds.has(component.parentId)) add("E_SPEC_REFERENCE", component.id, `parentId references unknown component: ${component.parentId}`);
  }
  for (const connector of connectors) {
    const id = connector && isNonEmptyString(connector.id) ? connector.id : specId;
    if (!connector || typeof connector !== "object" || !isNonEmptyString(connector.id)) {
      add("E_ID_INVALID", id, "connector id must be a non-empty string");
      continue;
    }
    if (connectorIds.has(connector.id) || componentIds.has(connector.id)) add("E_ID_DUPLICATE", connector.id, "component and connector IDs must be unique");
    connectorIds.add(connector.id);
    if (!componentIds.has(connector.source)) add("E_SPEC_REFERENCE", connector.id, `source references unknown component: ${connector.source}`);
    if (!componentIds.has(connector.target)) add("E_SPEC_REFERENCE", connector.id, `target references unknown component: ${connector.target}`);
  }

  return findings.sort((left, right) =>
    compareCodeUnits(left.id, right.id) ||
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(left.message, right.message)
  );
}

function loadDiagramSpec(filePath) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new DiagramSpecError("E_SPEC_JSON", filePath, `invalid JSON: ${filePath}`);
    throw new DiagramSpecError("E_SPEC_READ", filePath, `unable to read spec: ${filePath}`);
  }
  const findings = validateDiagramSpec(value);
  if (findings.length > 0) {
    const finding = findings[0];
    throw new DiagramSpecError(finding.code, finding.id, finding.message);
  }
  return value;
}

module.exports = { DiagramSpecError, loadDiagramSpec, normalizeFormat, validateDiagramSpec };
